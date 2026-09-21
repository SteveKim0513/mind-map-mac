import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ClientIpResolver } from './clientIp.js';
import type { RelayLimits } from './limits.js';
import { describeError, type Logger } from './logger.js';
import { BackoffGate, WindowLimiter } from './rateLimit.js';
import type { Participant, Store } from './store.js';
import { isRoomId, parseBearer, parseDisplayName, parseFolderName } from './validate.js';

const MAX_BODY_BYTES = 8 * 1024;
const JOIN_MAX_FAILURES = 10;
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const ROOM_CREATE_MAX = 30;
const ROOM_CREATE_WINDOW_MS = 60 * 60 * 1000;
// 전역 /join 실패 게이트: 코드 공간은 32^8 = 2^40(≈1.1e12)이라 분당 60회(하루 약 8.6만 회) 추측의 성공 확률은
// 열린 초대가 수천 개여도 하루 1e-4 미만이다. 정상 사용자의 오타(수 회/분)는 절대 걸리지 않는 값이고,
// 걸리면 30초에서 시작해 반복할 때마다 2배(최대 10분)로 백오프한다.
const JOIN_GLOBAL_WINDOW_MS = 60 * 1000;
const JOIN_GLOBAL_BACKOFF_BASE_MS = 30 * 1000;
const JOIN_GLOBAL_BACKOFF_CAP_MS = 10 * 60 * 1000;
const JOIN_GLOBAL_BACKOFF_DECAY_MS = 60 * 60 * 1000;

export interface HttpDeps {
  store: Store;
  log: Logger;
  now: () => number;
  limits: RelayLimits;
  clientIp: ClientIpResolver;
  isOnline: (participantId: string) => boolean;
  disconnectParticipant: (participantId: string) => void;
  /** 방을 삭제한 직후 그 방의 라이브 소켓을 모두 끊는다. */
  disconnectRoom: (roomId: string) => void;
}

/**
 * 요청 경로 → 로그용 route 이름. URL 패턴만으로 정해 핸들러가 성공하든 `HttpError`로 끝나든 같은 이름이 찍힌다.
 * roomId·participantId 같은 값은 이름에 넣지 않고 `:roomId` 같은 패턴 이름으로 바꾼다(로그에 방 식별자가 route로 새지 않게).
 * 어느 패턴에도 안 맞는 경로만 `unmatched`(스캐너·오타).
 */
export function classifyRoute(parts: readonly string[]): string {
  const [a, , c] = parts;
  if (parts.length === 1 && a === 'health') return '/health';
  if (parts.length === 1 && a === 'rooms') return '/rooms';
  if (parts.length === 1 && a === 'join') return '/join';
  if (a === 'rooms' && parts.length === 2) return '/rooms/:roomId';
  if (a === 'rooms' && c === 'invites' && parts.length === 3) return '/rooms/:roomId/invites';
  if (a === 'rooms' && c === 'participants' && parts.length === 3) return '/rooms/:roomId/participants';
  if (a === 'rooms' && c === 'participants' && parts.length === 4) return '/rooms/:roomId/participants/:participantId';
  return 'unmatched';
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }
}

export function createHttpHandler(deps: HttpDeps) {
  const joinFailures = new WindowLimiter(JOIN_MAX_FAILURES, JOIN_WINDOW_MS, deps.now);
  const roomCreations = new WindowLimiter(ROOM_CREATE_MAX, ROOM_CREATE_WINDOW_MS, deps.now);
  const roomCreationsGlobal = new WindowLimiter(deps.limits.roomCreateGlobalPerHour, ROOM_CREATE_WINDOW_MS, deps.now);
  const joinGlobal = new BackoffGate(
    deps.limits.joinGlobalFailuresPerMin,
    JOIN_GLOBAL_WINDOW_MS,
    JOIN_GLOBAL_BACKOFF_BASE_MS,
    JOIN_GLOBAL_BACKOFF_CAP_MS,
    JOIN_GLOBAL_BACKOFF_DECAY_MS,
    deps.now,
  );
  const GLOBAL_KEY = '*';

  function requireParticipant(req: IncomingMessage): Participant {
    const token = parseBearer(req.headers.authorization);
    const participant = token ? deps.store.authenticate(token) : null;
    if (!participant) throw new HttpError(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' });
    return participant;
  }

  function requireMember(req: IncomingMessage, roomId: string): Participant {
    const participant = requireParticipant(req);
    if (!isRoomId(roomId) || participant.roomId !== roomId) throw new HttpError(403, 'forbidden');
    deps.store.touchRoom(roomId);
    return participant;
  }

  function requireOwner(req: IncomingMessage, roomId: string): Participant {
    const participant = requireMember(req, roomId);
    if (participant.role !== 'owner') throw new HttpError(403, 'forbidden');
    return participant;
  }

  async function route(req: IncomingMessage, parts: string[]): Promise<{ status: number; body?: unknown }> {
    const method = req.method ?? 'GET';

    if (parts.length === 1 && parts[0] === 'health') {
      if (method !== 'GET') throw new HttpError(405, 'method_not_allowed');
      return { status: 200, body: { ok: true } };
    }

    if (parts.length === 1 && parts[0] === 'rooms') {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const ip = deps.clientIp(req);
      if (roomCreations.isBlocked(ip)) throw rateLimited(roomCreations.retryAfterSec(ip));
      if (roomCreationsGlobal.isBlocked(GLOBAL_KEY)) throw rateLimited(roomCreationsGlobal.retryAfterSec(GLOBAL_KEY));
      if (deps.store.countRooms() >= deps.limits.maxRooms) throw new HttpError(503, 'capacity_reached', { 'Retry-After': '3600' });
      const body = await readJsonObject(req);
      const ownerName = parseDisplayName(body.ownerName);
      if (!ownerName) throw new HttpError(400, 'invalid_owner_name');
      // folderName은 선택 — 없거나 null이면 저장하지 않는다. 있으면 형식이 맞아야 한다.
      let folderName: string | null = null;
      if (body.folderName !== undefined && body.folderName !== null) {
        folderName = parseFolderName(body.folderName);
        if (!folderName) throw new HttpError(400, 'invalid_folder_name');
      }
      roomCreations.record(ip);
      roomCreationsGlobal.record(GLOBAL_KEY);
      const room = deps.store.createRoom(ownerName, folderName);
      deps.log('room.created', { roomId: room.roomId, participantId: room.ownerId });
      return {
        status: 200,
        body: {
          roomId: room.roomId,
          ownerId: room.ownerId,
          ownerToken: room.ownerToken,
          inviteCode: room.inviteCode,
          inviteExpiresAt: room.inviteExpiresAt,
        },
      };
    }

    if (parts.length === 1 && parts[0] === 'join') {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const body = await readJsonObject(req);
      const displayName = parseDisplayName(body.displayName);
      if (typeof body.code !== 'string' || body.code.length > 64) throw new HttpError(400, 'invalid_code_format');
      if (!displayName) throw new HttpError(400, 'invalid_display_name');
      const ip = deps.clientIp(req);
      if (joinFailures.isBlocked(ip)) throw rateLimited(joinFailures.retryAfterSec(ip));
      if (joinGlobal.isBlocked()) throw rateLimited(joinGlobal.retryAfterSec());
      const joined = deps.store.redeemInvite(body.code, displayName);
      if (!joined) {
        joinFailures.record(ip);
        joinGlobal.recordFailure();
        deps.log('join.rejected', { reason: 'invalid_code' });
        throw new HttpError(404, 'invalid_code');
      }
      deps.log('join.accepted', { roomId: joined.participant.roomId, participantId: joined.participant.participantId });
      return {
        status: 200,
        body: {
          roomId: joined.participant.roomId,
          participantId: joined.participant.participantId,
          token: joined.token,
          role: 'participant',
          folderName: deps.store.getFolderName(joined.participant.roomId),
        },
      };
    }

    if (parts[0] === 'rooms' && parts.length === 2) {
      if (method !== 'DELETE') throw new HttpError(405, 'method_not_allowed');
      const roomId = parts[1] ?? '';
      const owner = requireOwner(req, roomId);
      // 저장소에서 먼저 지워 이후 재접속·REST가 즉시 인증 실패하게 한 뒤, 라이브 소켓을 끊는다.
      deps.store.deleteRoom(roomId);
      deps.disconnectRoom(roomId);
      deps.log('room.deleted', { roomId, participantId: owner.participantId });
      return { status: 204 };
    }

    if (parts[0] === 'rooms' && parts[2] === 'invites' && parts.length === 3) {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const roomId = parts[1] ?? '';
      const owner = requireOwner(req, roomId);
      const invite = deps.store.createInvite(roomId, owner.participantId);
      if (!invite) throw new HttpError(429, 'too_many_open_invites');
      deps.log('invite.created', { roomId, participantId: owner.participantId });
      return { status: 200, body: invite };
    }

    if (parts[0] === 'rooms' && parts[2] === 'participants' && parts.length === 3) {
      if (method !== 'GET') throw new HttpError(405, 'method_not_allowed');
      const roomId = parts[1] ?? '';
      requireMember(req, roomId);
      const list = deps.store
        .listParticipants(roomId)
        .map((p) => ({ ...p, online: deps.isOnline(p.participantId) }));
      return { status: 200, body: list };
    }

    if (parts[0] === 'rooms' && parts[2] === 'participants' && parts.length === 4) {
      if (method !== 'DELETE') throw new HttpError(405, 'method_not_allowed');
      const roomId = parts[1] ?? '';
      const targetId = parts[3] ?? '';
      const owner = requireOwner(req, roomId);
      if (targetId === owner.participantId) throw new HttpError(400, 'cannot_remove_owner');
      const result = deps.store.revokeParticipant(roomId, targetId);
      if (result === 'not_found') throw new HttpError(404, 'not_found');
      if (result === 'is_owner') throw new HttpError(400, 'cannot_remove_owner');
      deps.disconnectParticipant(targetId);
      deps.log('participant.revoked', { roomId, participantId: targetId });
      return { status: 204 };
    }

    throw new HttpError(404, 'not_found');
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let status = 500;
    let routeName = 'unmatched';
    let reason: string | undefined;
    let body: unknown;
    let extraHeaders: Record<string, string> = {};
    try {
      // 경로를 먼저 분류한다 — 핸들러가 던져도(HttpError·예기치 못한 오류) route 이름이 정확히 남는다.
      const url = parseRequestUrl(req);
      const parts = url.pathname.split('/').filter(Boolean).map(safeDecode);
      routeName = classifyRoute(parts);
      if (req.method === 'OPTIONS') {
        status = 204;
      } else {
        const result = await route(req, parts);
        status = result.status;
        body = result.body;
      }
    } catch (error) {
      if (error instanceof HttpError) {
        status = error.status;
        reason = error.code;
        body = { error: error.code };
        extraHeaders = error.headers;
        if (status === 413) {
          extraHeaders = { ...extraHeaders, Connection: 'close' };
          res.once('finish', () => req.destroy());
        }
      } else {
        status = 500;
        reason = 'internal';
        body = { error: 'internal' };
        // 오류 원인은 이름 + 다듬은 메시지(200자, 비밀처럼 보이는 조각은 가림)만 남긴다 — 요청 본문·헤더는 넣지 않는다.
        deps.log('http.error', { route: routeName, ...describeError(error) }, 'error');
      }
    }
    if (routeName !== '/health') {
      deps.log('http', { method: req.method, route: routeName, status, ...(reason ? { reason } : {}) }, status >= 500 ? 'error' : 'info');
    }
    respond(res, status, body, extraHeaders);
  };
}

/** 요청 URL 파싱. 깨진 URL(`//` 등)은 서버 오류(500)가 아니라 클라이언트 오류(400)다 — 스캐너 트래픽이 error 로그를 채우지 않게. */
function parseRequestUrl(req: IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://relay.invalid');
  } catch {
    throw new HttpError(400, 'invalid_url');
  }
}

function respond(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string>): void {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function rateLimited(retryAfterSec: number): HttpError {
  return new HttpError(429, 'rate_limited', { 'Retry-After': String(retryAfterSec) });
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return '';
  }
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large');
    chunks.push(buf);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, 'invalid_json');
  return parsed as Record<string, unknown>;
}
