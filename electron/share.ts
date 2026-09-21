/**
 * 공유 폴더(ADR 0021)의 main 프로세스 로직.
 *
 * `electron` 런타임을 import하지 않는다(타입만) — 의존성(fs 경계·safeStorage·fetch 등)을 주입받아
 * 단위 테스트가 가능하다. `ipcMain.handle` 등록은 규칙대로 electron/main.ts에서만 한다.
 *
 * 보안 규칙:
 *  - 렌더러가 넘기는 모든 인자(경로·id·문자열)는 신뢰하지 않는다. 경로는 워크스페이스 경계
 *    (realpath 포함) 안의 비숨김 하위 폴더여야 하고, id는 정규식 화이트리스트를 통과해야 한다.
 *  - 릴레이 REST는 여기서만, **설정된 릴레이 origin으로만** 호출한다. 리다이렉트는 따라가지 않는다
 *    (토큰이 다른 origin으로 새는 것을 막음).
 *  - 토큰은 safeStorage로만 저장하고 렌더러에는 `tokenGet`으로만 내준다. 평문 저장·로그 금지.
 *  - 로그에는 이벤트 이름·HTTP 상태만. 초대 코드·토큰·표시 이름·문서 내용은 절대 기록하지 않는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SafeStorage } from 'electron';
import type { ShareMarker, ShareParticipant } from '../src/types';
import { SHARE_MAX_FOLDER_DEPTH, SHARE_MAX_SCAN_DIRS, SIDECAR_ID_RE } from '../src/io/shareLimits';
import {
  isParticipantId,
  isRelayToken,
  isRoomId,
  normalizeRelayUrl,
  parseCreateRoomResult,
  parseDisplayName,
  parseInviteCodeInput,
  parseShareFolderName,
  parseInviteResult,
  parseJoinResult,
  parseParticipants,
  parseShareMarker,
  relayWsUrl,
  serializeShareMarker,
  type ShareCreateRoomInfo,
  type ShareErrorCode,
  type ShareInviteInfo,
  type ShareJoinInfo,
  type ShareRelayInfo,
  type ShareResult,
} from '../src/io/shareFormat';

export const MARKER_DIR = '.mindshare';
export const MARKER_FILE = 'room.json';
export const MAX_SIDECAR_BYTES = 16 * 1024 * 1024;
const MAX_MARKER_BYTES = 8 * 1024;
const MAX_PATH_LENGTH = 4096;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
/** 표식 스캔 한계 — 렌더러의 공유 가능 검사(`shareBlockReason`)와 같은 값을 쓴다(`src/io/shareLimits.ts`). */
export const LIST_MAX_DEPTH = SHARE_MAX_FOLDER_DEPTH;
export const LIST_MAX_DIRS = SHARE_MAX_SCAN_DIRS;
const LIST_SKIP_DIRS = new Set(['node_modules', '.trash']);

// ── 릴레이 설정 · CSP (순수) ──────────────────────────────────────────────────

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * 릴레이 URL 결정: 환경변수(MINDMAP_RELAY_URL) > 기본값(shareConfig.DEFAULT_RELAY_URL).
 * **패키지된 앱(`isPackaged`)에서는 환경변수를 무시하고 기본값만 쓴다** — 배포본이 사용자 셸의 환경변수 하나로 다른 서버에
 * 토큰을 보내지 않게(개발·E2E는 비패키지라 영향 없음).
 * 평문 http는 loopback(로컬 개발·E2E)에서만 허용 — 토큰이 평문으로 나가는 것을 막는다.
 */
export function resolveRelayConfig(
  envUrl: string | undefined,
  defaultUrl: string,
  isPackaged = false,
): ShareResult<{ info: ShareRelayInfo }> {
  const raw = (isPackaged ? '' : (envUrl ?? '').trim()) || defaultUrl.trim();
  if (!raw) return { ok: false, error: 'relay_not_configured' };
  const url = normalizeRelayUrl(raw);
  if (!url) return { ok: false, error: 'relay_invalid' };
  const u = new URL(url);
  if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) return { ok: false, error: 'relay_invalid' };
  const wsUrl = relayWsUrl(url);
  if (!wsUrl) return { ok: false, error: 'relay_invalid' };
  return { ok: true, info: { url, wsUrl } };
}

/**
 * 렌더러 CSP의 `connect-src` 디렉티브 문자열. 다른 디렉티브는 넣지 않는다(기존 동작 보존).
 * 릴레이는 origin 하나(+ws 변형)만, 로컬 서버(localhost)는 비패키지(dev/E2E)에서만 허용한다.
 */
export function buildConnectSrc(relay: ShareRelayInfo | null, allowLocalhost: boolean): string {
  const sources = ["'self'", 'data:', 'blob:'];
  if (relay) {
    sources.push(new URL(relay.url).origin, new URL(relay.wsUrl).origin);
  }
  if (allowLocalhost) {
    sources.push('http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*');
  }
  return `connect-src ${sources.join(' ')}`;
}

/** 응답 헤더에 CSP를 추가한다. 이미 CSP가 있으면 정책을 덧붙인다(여러 정책은 모두 적용됨). */
export function addCspHeader(
  headers: Record<string, string[]> | undefined,
  csp: string,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...(headers ?? {}) };
  const existing = Object.keys(out).find((k) => k.toLowerCase() === 'content-security-policy');
  if (existing) out[existing] = [...out[existing], csp];
  else out['Content-Security-Policy'] = [csp];
  return out;
}

// ── 경로 경계 (순수) ──────────────────────────────────────────────────────────

/**
 * 공유 폴더 후보 경로 검증(문자열 수준): 워크스페이스의 **엄격한 하위** 폴더여야 하고,
 * 어떤 세그먼트도 '.'으로 시작하면 안 된다(.trash/.history/.mindshare 등 시스템 폴더 배제).
 * 통과하면 정규화된 절대 경로, 아니면 null.
 */
export function resolveShareFolder(workspace: string, p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 1 || p.length > MAX_PATH_LENGTH || p.includes('\0')) return null;
  const ws = path.resolve(workspace);
  const resolved = path.resolve(p);
  if (!resolved.startsWith(ws + path.sep)) return null;
  const rel = path.relative(ws, resolved);
  if (rel.split(path.sep).some((seg) => seg.startsWith('.'))) return null;
  return resolved;
}

/**
 * 사이드카 파일 id 검증 — 렌더러가 만드는 이름(`src/share/docKeys.ts`의 `sidecarIdForDocKey`)과 같은 화이트리스트
 * (`_manifest` · `_comments` · `n_<소문자 hex>` · `_file_<소문자 hex>`). 소문자 hex만 허용하므로 대소문자 무시 파일시스템에서도
 * 서로 다른 문서가 같은 파일이 되지 않고, 경로 구분자·점·선행 '.'이 끼어들 여지가 없다.
 */
export function isSidecarId(v: unknown): v is string {
  return typeof v === 'string' && SIDECAR_ID_RE.test(v);
}

// ── 핸들러 ────────────────────────────────────────────────────────────────────

export interface ShareDeps {
  /** userData 디렉터리(토큰 저장). */
  userDataDir: () => string;
  getWorkspace: () => Promise<string>;
  /** main.ts의 원자적 쓰기(tmp+fsync+rename). */
  atomicWrite: (target: string, data: string | Buffer) => Promise<void>;
  safeStorage: Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;
  fetch: typeof fetch;
  /** process.env.MINDMAP_RELAY_URL */
  envRelayUrl: string | undefined;
  defaultRelayUrl: string;
  /** `app.isPackaged` — true면 `envRelayUrl`을 무시한다(생략하면 비패키지로 본다: 개발·테스트). */
  isPackaged?: boolean;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  timeoutMs?: number;
}

export interface ShareHandlers {
  relayUrl(): Promise<ShareResult<{ info: ShareRelayInfo }>>;
  readMarker(folderPath: unknown): Promise<ShareMarker | null>;
  writeMarker(folderPath: unknown, marker: unknown): Promise<ShareResult>;
  removeMarker(folderPath: unknown): Promise<ShareResult>;
  listMarkers(): Promise<{ folderPath: string; marker: ShareMarker }[]>;
  tokenGet(roomId: unknown): Promise<string | null>;
  tokenSet(roomId: unknown, token: unknown): Promise<ShareResult>;
  tokenDelete(roomId: unknown): Promise<void>;
  createRoom(args: unknown): Promise<ShareResult<{ room: ShareCreateRoomInfo }>>;
  join(args: unknown): Promise<ShareResult<{ joined: ShareJoinInfo }>>;
  invite(roomId: unknown): Promise<ShareResult<{ invite: ShareInviteInfo }>>;
  participants(roomId: unknown): Promise<ShareResult<{ participants: ShareParticipant[] }>>;
  revoke(roomId: unknown, participantId: unknown): Promise<ShareResult>;
  /** (소유자) 서버의 방을 지운다 — 방·참가자·미사용 초대·폴더 이름이 삭제되고 연결된 소켓이 끊긴다. 성공 204. */
  deleteRoom(roomId: unknown): Promise<ShareResult>;
  sidecarRead(folderPath: unknown, id: unknown): Promise<Uint8Array | null>;
  sidecarWrite(folderPath: unknown, id: unknown, data: unknown): Promise<ShareResult>;
}

/** 릴레이 오류 응답(HTTP 상태 + 서버 오류 코드) → 사용자에게 보여줄 수 있는 코드. */
export function mapRelayError(status: number, serverCode: string | undefined): ShareErrorCode {
  if (status === 400 || status === 413) return 'invalid_input';
  if (status === 401 || status === 403) return 'denied';
  if (status === 404) {
    if (serverCode === 'invalid_code') return 'invalid_code';
    if (serverCode === 'expired' || serverCode === 'invite_expired') return 'expired';
    return 'not_found';
  }
  if (status === 410) return 'expired';
  if (status === 429) return serverCode === 'too_many_open_invites' ? 'too_many_invites' : 'rate_limited';
  // 서버의 방 총량 상한 — 재시도해도 한동안 소용없다(Retry-After 1시간). 일반 서버 오류와 구분해 안내한다.
  if (status === 503 && serverCode === 'capacity_reached') return 'capacity_reached';
  return 'server';
}

/**
 * 응답 본문을 최대 `maxBytes`까지만 읽는다. 상한을 넘기는 순간 스트림을 취소하고 `{ ok:false }`.
 * (`Response.body`가 없는 환경 — 일부 테스트 대역 — 에서는 `text()`로 읽고 길이를 확인한다.)
 */
export async function readBoundedText(
  res: Pick<Response, 'body' | 'text'>,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await res.text();
    return new TextEncoder().encode(text).byteLength > maxBytes ? { ok: false } : { ok: true, text };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(all) };
}

export function createShareHandlers(deps: ShareDeps): ShareHandlers {
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;

  // ─ 릴레이 ─
  function relayConfig() {
    return resolveRelayConfig(deps.envRelayUrl, deps.defaultRelayUrl, deps.isPackaged === true);
  }

  type RelayReply = { ok: true; status: number; body: unknown } | { ok: false; error: ShareErrorCode };

  /** 설정된 릴레이로만 요청한다. `route`는 로그용 고정 문자열(경로 변수 없음). */
  async function relayRequest(args: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    route: string;
    body?: unknown;
    roomId?: string; // 있으면 저장된 토큰을 Bearer로 첨부
  }): Promise<RelayReply> {
    const cfg = relayConfig();
    if (!cfg.ok) return { ok: false, error: cfg.error };
    const base = new URL(cfg.info.url);
    const url = new URL(cfg.info.url + args.path);
    if (url.origin !== base.origin) return { ok: false, error: 'invalid_input' }; // 방어: 경로 주입 시도

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (args.body !== undefined) headers['Content-Type'] = 'application/json';
    if (args.roomId) {
      const token = await readToken(args.roomId);
      if (!token) return { ok: false, error: 'no_token' };
      headers.Authorization = `Bearer ${token}`;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await deps.fetch(url.toString(), {
        method: args.method,
        headers,
        body: args.body === undefined ? undefined : JSON.stringify(args.body),
        signal: ctrl.signal,
        redirect: 'error', // 리다이렉트 금지 — Authorization이 다른 origin으로 가지 않게
      });
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        deps.log('warn', `${args.route} -> oversized response`);
        return { ok: false, error: 'bad_response' };
      }
      // 본문은 스트림으로 읽어 상한(1MB)에서 끊는다 — Content-Length를 속이거나 아예 안 주는(chunked) 응답도 메모리를 못 채운다.
      const read = res.status === 204 ? { ok: true as const, text: '' } : await readBoundedText(res, MAX_RESPONSE_BYTES);
      if (!read.ok) {
        deps.log('warn', `${args.route} -> oversized response`);
        ctrl.abort();
        return { ok: false, error: 'bad_response' };
      }
      const text = read.text;
      deps.log('info', `${args.method} ${args.route} -> ${res.status}`);

      let json: unknown;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, body: json };
      const code =
        json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
          ? ((json as { error: string }).error as string)
          : undefined;
      return { ok: false, error: mapRelayError(res.status, code) };
    } catch (err) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      deps.log('warn', `${args.method} ${args.route} failed: ${aborted ? 'timeout' : 'network'}`);
      return { ok: false, error: aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ─ 토큰 (safeStorage) ─
  function tokenFile(roomId: string): string {
    return path.join(deps.userDataDir(), 'share-tokens', `${roomId}.bin`);
  }

  async function readToken(roomId: string): Promise<string | null> {
    if (!isRoomId(roomId)) return null;
    try {
      const buf = await fs.readFile(tokenFile(roomId));
      const token = deps.safeStorage.decryptString(buf);
      return isRelayToken(token) ? token : null;
    } catch {
      return null;
    }
  }

  async function storeToken(roomId: string, token: string): Promise<ShareResult> {
    if (!isRoomId(roomId) || !isRelayToken(token)) return { ok: false, error: 'invalid_input' };
    if (!deps.safeStorage.isEncryptionAvailable()) return { ok: false, error: 'secure_storage_unavailable' };
    try {
      await fs.mkdir(path.dirname(tokenFile(roomId)), { recursive: true });
      await deps.atomicWrite(tokenFile(roomId), deps.safeStorage.encryptString(token));
      return { ok: true };
    } catch {
      deps.log('error', 'token store failed');
      return { ok: false, error: 'io' };
    }
  }

  // ─ 폴더 경계 ─
  /** 문자열 검증 + realpath 기준으로도 워크스페이스 안(심볼릭 링크 탈출 차단)인 폴더면 절대 경로. */
  async function shareFolder(p: unknown): Promise<string | null> {
    const ws = await deps.getWorkspace();
    const resolved = resolveShareFolder(ws, p);
    if (!resolved) return null;
    try {
      const [realFolder, realWs] = await Promise.all([fs.realpath(resolved), fs.realpath(ws)]);
      if (!realFolder.startsWith(realWs + path.sep)) return null;
      const st = await fs.stat(realFolder);
      return st.isDirectory() ? resolved : null;
    } catch {
      return null;
    }
  }

  /** `.mindshare` 디렉터리 경로. 있으면 반드시 "진짜 디렉터리"(심볼릭 링크 아님)여야 한다. */
  async function markerDirOf(folder: string, create: boolean): Promise<string | null> {
    const dir = path.join(folder, MARKER_DIR);
    try {
      const st = await fs.lstat(dir);
      return st.isDirectory() && !st.isSymbolicLink() ? dir : null;
    } catch {
      if (!create) return null;
    }
    try {
      await fs.mkdir(dir);
      return dir;
    } catch {
      return null;
    }
  }

  /** 일반 파일(심볼릭 링크 아님)이고 상한 이하일 때만 읽는다. */
  async function readRegularFile(file: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const st = await fs.lstat(file);
      if (!st.isFile() || st.isSymbolicLink() || st.size > maxBytes) return null;
      return await fs.readFile(file);
    } catch {
      return null;
    }
  }

  async function readMarkerAt(folder: string): Promise<ShareMarker | null> {
    const dir = await markerDirOf(folder, false);
    if (!dir) return null;
    const buf = await readRegularFile(path.join(dir, MARKER_FILE), MAX_MARKER_BYTES);
    if (!buf) return null;
    try {
      return parseShareMarker(JSON.parse(buf.toString('utf-8')));
    } catch {
      return null;
    }
  }

  return {
    async relayUrl() {
      return relayConfig();
    },

    async readMarker(folderPath) {
      const folder = await shareFolder(folderPath);
      if (!folder) return null;
      return readMarkerAt(folder);
    },

    async writeMarker(folderPath, marker) {
      const parsed = parseShareMarker(marker);
      if (!parsed) return { ok: false, error: 'invalid_input' };
      const folder = await shareFolder(folderPath);
      if (!folder) return { ok: false, error: 'invalid_input' };
      const dir = await markerDirOf(folder, true);
      if (!dir) return { ok: false, error: 'io' };
      try {
        await deps.atomicWrite(path.join(dir, MARKER_FILE), serializeShareMarker(parsed));
        deps.log('info', 'marker written');
        return { ok: true };
      } catch {
        deps.log('error', 'marker write failed');
        return { ok: false, error: 'io' };
      }
    },

    async removeMarker(folderPath) {
      const folder = await shareFolder(folderPath);
      if (!folder) return { ok: false, error: 'invalid_input' };
      const dir = await markerDirOf(folder, false);
      if (!dir) return { ok: true }; // 이미 없음(또는 심볼릭 링크라 건드리지 않음)
      try {
        await fs.rm(dir, { recursive: true, force: true });
        deps.log('info', 'marker removed');
        return { ok: true };
      } catch {
        return { ok: false, error: 'io' };
      }
    },

    async listMarkers() {
      const ws = await deps.getWorkspace();
      const found: { folderPath: string; marker: ShareMarker }[] = [];
      let visited = 0;
      async function scan(dir: string, depth: number): Promise<void> {
        if (depth > LIST_MAX_DEPTH || visited >= LIST_MAX_DIRS) return;
        visited++;
        if (depth >= 1) {
          const marker = await readMarkerAt(dir);
          if (marker) found.push({ folderPath: dir, marker });
        }
        if (depth === LIST_MAX_DEPTH) return;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ent of entries) {
          // Dirent.isDirectory()는 심볼릭 링크에 false → 링크는 따라가지 않는다.
          if (!ent.isDirectory()) continue;
          if (ent.name.startsWith('.') || ent.name.endsWith('.assets') || LIST_SKIP_DIRS.has(ent.name)) continue;
          await scan(path.join(dir, ent.name), depth + 1);
        }
      }
      await scan(ws, 0);
      found.sort((a, b) => a.folderPath.localeCompare(b.folderPath));
      return found;
    },

    tokenGet: (roomId) => readToken(roomId as string),
    async tokenSet(roomId, token) {
      return storeToken(roomId as string, token as string);
    },
    async tokenDelete(roomId) {
      if (!isRoomId(roomId)) return;
      await fs.unlink(tokenFile(roomId)).catch(() => {});
    },

    async createRoom(args) {
      const a = (args ?? {}) as { ownerName?: unknown; folderName?: unknown };
      const ownerName = parseDisplayName(a.ownerName);
      if (!ownerName) return { ok: false, error: 'invalid_input' };
      // folderName은 선택 — 넘겼다면 형식이 맞아야 한다(참가자의 로컬 폴더 이름이 되므로).
      let folderName: string | undefined;
      if (a.folderName !== undefined && a.folderName !== null) {
        const parsed = parseShareFolderName(a.folderName);
        if (!parsed) return { ok: false, error: 'invalid_input' };
        folderName = parsed;
      }
      const reply = await relayRequest({
        method: 'POST',
        path: '/rooms',
        route: '/rooms',
        body: folderName === undefined ? { ownerName } : { ownerName, folderName },
      });
      if (!reply.ok) return reply;
      const parsed = parseCreateRoomResult(reply.body);
      if (!parsed) return { ok: false, error: 'bad_response' };
      const stored = await storeToken(parsed.roomId, parsed.ownerToken);
      if (!stored.ok) return stored;
      return {
        ok: true,
        room: {
          roomId: parsed.roomId,
          participantId: parsed.ownerId,
          inviteCode: parsed.inviteCode,
          inviteExpiresAt: parsed.inviteExpiresAt,
        },
      };
    },

    async join(args) {
      const a = (args ?? {}) as { code?: unknown; displayName?: unknown };
      const code = parseInviteCodeInput(a.code);
      if (!code) return { ok: false, error: 'invalid_code' };
      const displayName = parseDisplayName(a.displayName);
      if (!displayName) return { ok: false, error: 'invalid_input' };
      const reply = await relayRequest({ method: 'POST', path: '/join', route: '/join', body: { code, displayName } });
      if (!reply.ok) return reply;
      const parsed = parseJoinResult(reply.body);
      if (!parsed) return { ok: false, error: 'bad_response' };
      const stored = await storeToken(parsed.roomId, parsed.token);
      if (!stored.ok) return stored;
      return {
        ok: true,
        joined: {
          roomId: parsed.roomId,
          participantId: parsed.participantId,
          role: parsed.role,
          folderName: parsed.folderName,
        },
      };
    },

    async invite(roomId) {
      if (!isRoomId(roomId)) return { ok: false, error: 'invalid_input' };
      const reply = await relayRequest({
        method: 'POST',
        path: `/rooms/${encodeURIComponent(roomId)}/invites`,
        route: '/rooms/:roomId/invites',
        body: {},
        roomId,
      });
      if (!reply.ok) return reply;
      const parsed = parseInviteResult(reply.body);
      return parsed ? { ok: true, invite: parsed } : { ok: false, error: 'bad_response' };
    },

    async participants(roomId) {
      if (!isRoomId(roomId)) return { ok: false, error: 'invalid_input' };
      const reply = await relayRequest({
        method: 'GET',
        path: `/rooms/${encodeURIComponent(roomId)}/participants`,
        route: '/rooms/:roomId/participants',
        roomId,
      });
      if (!reply.ok) return reply;
      const parsed = parseParticipants(reply.body);
      return parsed ? { ok: true, participants: parsed } : { ok: false, error: 'bad_response' };
    },

    async revoke(roomId, participantId) {
      if (!isRoomId(roomId) || !isParticipantId(participantId)) return { ok: false, error: 'invalid_input' };
      const reply = await relayRequest({
        method: 'DELETE',
        path: `/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}`,
        route: '/rooms/:roomId/participants/:participantId',
        roomId,
      });
      return reply.ok ? { ok: true } : reply;
    },

    async deleteRoom(roomId) {
      if (!isRoomId(roomId)) return { ok: false, error: 'invalid_input' };
      const reply = await relayRequest({
        method: 'DELETE',
        path: `/rooms/${encodeURIComponent(roomId)}`,
        route: '/rooms/:roomId',
        roomId,
      });
      return reply.ok ? { ok: true } : reply;
    },

    async sidecarRead(folderPath, id) {
      if (!isSidecarId(id)) return null;
      const folder = await shareFolder(folderPath);
      if (!folder) return null;
      const dir = await markerDirOf(folder, false);
      if (!dir) return null;
      const buf = await readRegularFile(path.join(dir, `${id}.yjs`), MAX_SIDECAR_BYTES);
      return buf ? new Uint8Array(buf) : null;
    },

    async sidecarWrite(folderPath, id, data) {
      if (!isSidecarId(id)) return { ok: false, error: 'invalid_input' };
      if (!(data instanceof Uint8Array) || data.byteLength > MAX_SIDECAR_BYTES) {
        return { ok: false, error: 'invalid_input' };
      }
      const folder = await shareFolder(folderPath);
      if (!folder) return { ok: false, error: 'invalid_input' };
      // 공유 폴더(표식이 있는 폴더)에만 쓴다 — 표식 없는 폴더에 .mindshare를 만들지 않는다.
      if (!(await readMarkerAt(folder))) return { ok: false, error: 'not_shared' };
      const dir = await markerDirOf(folder, false);
      if (!dir) return { ok: false, error: 'not_shared' };
      try {
        await deps.atomicWrite(path.join(dir, `${id}.yjs`), Buffer.from(data.buffer, data.byteOffset, data.byteLength));
        return { ok: true };
      } catch {
        deps.log('error', 'sidecar write failed');
        return { ok: false, error: 'io' };
      }
    },
  };
}
