import { Server } from '@hocuspocus/server';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import * as Y from 'yjs';
import { createClientIpResolver } from './clientIp.js';
import { createHttpHandler } from './http.js';
import { DAY, type RelayLimits, postAuthMaxPayloadBytes, resolveLimits } from './limits.js';
import { type LogLevel, type Logger, createLogger } from './logger.js';
import { type Role, Store } from './store.js';
import { parseDocumentName } from './validate.js';

export interface RelayOptions {
  port?: number;
  dbPath?: string;
  silent?: boolean;
  /** 이 수준 미만의 로그는 버린다(기본 `info` — 정상 종료 같은 debug 소음은 숨긴다). 운영은 환경변수 `LOG_LEVEL`. */
  logLevel?: LogLevel;
  inviteTtlMs?: number;
  trustProxyHops?: number;
  clock?: () => number;
  /** 자원 한도 일부 덮어쓰기(운영 튜닝·테스트). 기본값은 `DEFAULT_LIMITS`. */
  limits?: Partial<RelayLimits>;
  /** 테스트 전용: 경합 재현용 지연 주입. 운영 코드는 사용하지 않는다. */
  testHooks?: {
    /** onAuthenticate가 인증에 성공한 직후(컨텍스트 반환 전)에 await된다. */
    afterAuthenticate?: () => Promise<void>;
  };
}

export interface RelayHandle {
  port: number;
  url: string;
  wsUrl: string;
  stats(): { documents: number; connections: number };
  /** 마지막 활동 후 `ROOM_TTL_DAYS`가 지난 방을 삭제한다(접속자가 있는 방은 건너뛰고 활동으로 갱신). 삭제한 방 수. */
  sweepStaleRooms(): number;
  close(): Promise<void>;
}

interface RelayContext {
  participantId?: string;
  roomId?: string;
  role?: Role;
  revoked?: boolean;
}

interface WsLike {
  close(code?: number, reason?: string): void;
  terminate(): void;
  once(event: 'close', listener: (code: number, reason: Buffer) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  readyState: number;
}

const DEFAULT_INVITE_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 256;
/** 문서 크기 측정(Y.encodeStateAsUpdate) 최소 간격 — 대신 이 바이트 이상 쌓이면 즉시 측정한다. */
const MEASURE_INTERVAL_MS = 1000;
const MEASURE_PENDING_BYTES = 256 * 1024;
const WS_OPEN = 1;
const PERMISSION_DENIED = { reason: 'permission-denied' };
const ROOM_FULL = { reason: 'room_full' };
const REVOKED = { code: 4403, reason: 'revoked' };
const ROOM_DELETED = { code: 4403, reason: 'room_deleted' };
const AUTH_TIMEOUT = { code: 4408, reason: 'auth_timeout' };
const DOC_TOO_LARGE = { code: 4413, reason: 'doc_too_large' };
const ROOM_OVER_BUDGET = { code: 4413, reason: 'room_over_budget' };
const RATE_LIMITED = { code: 4429, reason: 'rate_limited' };
const TOO_MANY_CONNECTIONS = { code: 4429, reason: 'too_many_connections' };
/** 정상 종료 close code(1005 = 코드 없이 닫음) — 소음이라 debug로만 남긴다. */
const NORMAL_CLOSE_CODES = new Set([1000, 1001, 1005]);
/** 서버가 직접 정하는 close 사유. 클라이언트가 보내는 임의 사유 문자열은 로그에 옮기지 않는다(`other`로 뭉갠다). */
const KNOWN_CLOSE_REASONS = new Set([
  'revoked', 'room_deleted', 'auth_timeout', 'doc_too_large', 'room_over_budget', 'rate_limited', 'too_many_connections',
  'permission-denied', 'room_full', 'forced',
]);

export async function startRelay(options: RelayOptions = {}): Promise<RelayHandle> {
  const now = options.clock ?? Date.now;
  const emit = createLogger(options.silent ?? false, options.logLevel ?? 'info');
  // 종료가 시작되면 연결 단위 로그(`ws.closed` 등)는 남기지 않는다 — 종료의 당연한 결과이고(재배포 때 소켓 수천 줄), 소켓 close 이벤트는 종료가
  // 끝난 뒤에도 늦게 도착해 이미 닫힌 릴레이가 다음 실행(테스트 포함)의 로그에 섞여 든다. 마지막 `relay.closed`만 남긴다.
  let closingStarted = false;
  const log: Logger = (event, fields, level) => {
    if (!closingStarted) emit(event, fields, level);
  };
  const limits = resolveLimits(options.limits);
  const trustProxyHops = options.trustProxyHops ?? 0;
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error(`trustProxyHops must be a non-negative integer (got ${String(options.trustProxyHops)})`);
  }
  const inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
  if (!Number.isInteger(inviteTtlMs) || inviteTtlMs <= 0) {
    throw new Error(`inviteTtlMs must be a positive integer (got ${String(options.inviteTtlMs)})`);
  }
  const store = new Store(options.dbPath ?? ':memory:', inviteTtlMs, now);
  const resolveIp = createClientIpResolver(trustProxyHops, log);

  const contextOf = (raw: unknown): RelayContext => (raw ?? {}) as RelayContext;

  /**
   * 서버가 소켓을 직접 닫을 때의 close code·사유. ws의 서버측 `close` 이벤트는 상대가 되돌려 준 값만 알려 줘서(사유는 보통 비어 있고,
   * 상대가 사라졌으면 1006) 서버가 정한 값을 따로 기억해 `ws.closed` 로그에 쓴다.
   */
  const sentClose = new WeakMap<object, { code: number; reason: string }>();
  const closeSocket = (socket: { close(code?: number, reason?: string): void }, event: { code: number; reason: string }): void => {
    sentClose.set(socket, event);
    socket.close(event.code, event.reason);
  };

  const roomDocuments = function* (roomId: string) {
    const prefix = `${roomId}/`;
    for (const [name, document] of server.hocuspocus.documents) if (name.startsWith(prefix)) yield document;
  };

  const isOnline = (participantId: string): boolean => {
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        if (contextOf(connection.context).participantId === participantId) return true;
      }
    }
    return false;
  };

  const disconnectParticipant = (participantId: string): void => {
    const sockets = new Set<{ close(code?: number, reason?: string): void }>();
    let roomId: string | undefined;
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        const context = contextOf(connection.context);
        if (context.participantId !== participantId) continue;
        roomId = context.roomId;
        context.revoked = true;
        sockets.add(connection.webSocket);
        connection.close(REVOKED);
      }
    }
    for (const socket of sockets) closeSocket(socket, REVOKED);
    if (sockets.size > 0) log('ws.closing', { roomId, participantId, code: REVOKED.code, reason: REVOKED.reason });
  };

  /** 방 삭제: 그 방 문서의 모든 연결을 끊고, 다른 방 문서를 싣고 있지 않은 소켓은 닫는다. */
  const disconnectRoom = (roomId: string): void => {
    const sockets = new Set<WsLike>();
    for (const document of roomDocuments(roomId)) {
      for (const connection of document.getConnections()) {
        contextOf(connection.context).revoked = true;
        sockets.add(connection.webSocket as unknown as WsLike);
        connection.close(ROOM_DELETED);
      }
    }
    const stillUsed = new Set<unknown>();
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) stillUsed.add(connection.webSocket);
    }
    for (const socket of sockets) if (!stillUsed.has(socket)) closeSocket(socket, ROOM_DELETED);
    if (sockets.size > 0) log('ws.closing', { roomId, code: ROOM_DELETED.code, reason: ROOM_DELETED.reason });
  };

  const roomHasConnections = (roomId: string): boolean => {
    for (const document of roomDocuments(roomId)) if (document.getConnectionsCount() > 0) return true;
    return false;
  };

  const sweepStaleRooms = (): number => {
    if (limits.roomTtlDays <= 0) return 0;
    const cutoff = now() - limits.roomTtlDays * DAY;
    let removed = 0;
    for (const roomId of store.staleRoomIds(cutoff)) {
      if (roomHasConnections(roomId)) {
        store.touchRoom(roomId);
        continue;
      }
      if (store.deleteRoom(roomId)) {
        removed++;
        log('room.expired', { roomId });
      }
    }
    return removed;
  };

  const handleHttp = createHttpHandler({
    store,
    log,
    now,
    limits,
    clientIp: resolveIp,
    isOnline,
    disconnectParticipant,
    disconnectRoom,
  });

  // --- 소켓 등록부: 방·참가자별 동시 소켓 수 상한 -------------------------------------------------------------
  interface SocketInfo {
    roomId: string;
    participantId: string;
  }
  const socketInfo = new WeakMap<object, SocketInfo>();
  const authenticatedSockets = new WeakSet<object>();
  const roomSockets = new Map<string, Set<object>>();
  const participantSockets = new Map<string, Set<object>>();

  const registerSocket = (ws: WsLike, info: SocketInfo): boolean => {
    if (socketInfo.has(ws)) return true;
    const room = roomSockets.get(info.roomId) ?? new Set<object>();
    const participant = participantSockets.get(info.participantId) ?? new Set<object>();
    if (room.size >= limits.maxSocketsPerRoom || participant.size >= limits.maxSocketsPerParticipant) return false;
    room.add(ws);
    participant.add(ws);
    roomSockets.set(info.roomId, room);
    participantSockets.set(info.participantId, participant);
    socketInfo.set(ws, info);
    ws.once('close', () => {
      room.delete(ws);
      participant.delete(ws);
      if (room.size === 0 && roomSockets.get(info.roomId) === room) roomSockets.delete(info.roomId);
      if (participant.size === 0 && participantSockets.get(info.participantId) === participant) {
        participantSockets.delete(info.participantId);
      }
    });
    return true;
  };

  // --- 프레임 상한: 인증 전에는 작게, 인증 후에는 문서 상한 + 여유 -----------------------------------------------
  // ws는 프레임 전체를 버퍼링한 뒤에야 메시지를 넘기므로, 인증 전 소켓이 16MB 프레임을 여러 개 보내 메모리를 잡는 것을
  // 막으려면 수신기 단계에서 상한을 걸어야 한다. 공개 API가 없어 ws 내부 필드(`_receiver._maxPayload`)를 조정한다 —
  // 필드가 없으면(ws 내부 변경) 경고 후 전역 상한만 적용하고, 서버 테스트(pre-auth 프레임 상한)가 변경을 잡는다.
  const postAuthLimit = postAuthMaxPayloadBytes(limits);
  let warnedReceiver = false;
  const setReceiverLimit = (ws: unknown, bytes: number): void => {
    const receiver = (ws as { _receiver?: { _maxPayload?: unknown } })._receiver;
    if (receiver && typeof receiver._maxPayload === 'number') {
      receiver._maxPayload = bytes;
    } else if (!warnedReceiver) {
      warnedReceiver = true;
      log('relay.receiver_limit_unavailable');
    }
  };

  // --- 소켓당 메시지 속도(토큰 버킷) -------------------------------------------------------------------------
  const buckets = new WeakMap<object, { tokens: number; at: number }>();
  const takeMessageToken = (ws: object): boolean => {
    const at = Date.now();
    const bucket = buckets.get(ws) ?? { tokens: limits.messageBurst, at };
    bucket.tokens = Math.min(limits.messageBurst, bucket.tokens + ((at - bucket.at) / 1000) * limits.messageRatePerSec);
    bucket.at = at;
    buckets.set(ws, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };

  // --- 문서 크기·방 메모리 예산 -------------------------------------------------------------------------------
  const docAccounts = new Map<string, { bytes: number; pending: number; measuredAt: number }>();

  const evictDocument = (documentName: string, event: { code: number; reason: string }): void => {
    const document = server.hocuspocus.documents.get(documentName);
    if (!document) return;
    for (const connection of document.getConnections()) {
      contextOf(connection.context).revoked = true;
      connection.close(event);
    }
    const parsed = parseDocumentName(documentName);
    log('ws.evicted', { roomId: parsed?.roomId, docKind: parsed?.kind, reason: event.reason, code: event.code });
  };

  const accountDocument = (document: Y.Doc, documentName: string, updateBytes: number): void => {
    const account = docAccounts.get(documentName) ?? { bytes: 0, pending: 0, measuredAt: 0 };
    docAccounts.set(documentName, account);
    account.pending += updateBytes;
    const at = Date.now();
    if (account.pending < MEASURE_PENDING_BYTES && at - account.measuredAt < MEASURE_INTERVAL_MS) return;
    account.bytes = Y.encodeStateAsUpdate(document).byteLength;
    account.pending = 0;
    account.measuredAt = at;

    if (account.bytes > limits.maxDocumentBytes) return evictDocument(documentName, DOC_TOO_LARGE);
    const parsed = parseDocumentName(documentName);
    if (parsed) {
      const prefix = `${parsed.roomId}/`;
      let roomBytes = 0;
      for (const [name, other] of docAccounts) if (name.startsWith(prefix)) roomBytes += other.bytes;
      if (roomBytes > limits.maxRoomBytes) return evictDocument(documentName, ROOM_OVER_BUDGET);
    }
    let total = 0;
    for (const other of docAccounts.values()) total += other.bytes;
    if (total > limits.maxTotalBytes) evictDocument(documentName, ROOM_OVER_BUDGET);
  };

  // --- WebSocket 업그레이드 시점 소켓 수 상한 -----------------------------------------------------------------
  let upgradedSockets = 0;
  const ipSockets = new Map<string, number>();
  const refuseUpgrade = (socket: Duplex, status: string): void => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
  };

  const server = new Server<RelayContext>({
    port: options.port ?? 0,
    quiet: true,
    stopOnSignals: false,
    unloadImmediately: true,
    // 하드 상한 = 인증 후 프레임 상한. 인증 전에는 아래 handleConnection 래퍼가 더 작게 낮춘다.
    websocketOptions: { maxPayload: postAuthLimit },

    async onRequest({ request, response }) {
      await handleHttp(request, response);
      // 훅이 빈 값으로 reject되면 Hocuspocus가 기본 응답("Welcome to Hocuspocus!")을 덮어쓰지 않는다.
      throw null;
    },

    async onUpgrade({ request, socket }: { request: IncomingMessage; socket: Duplex }) {
      const ip = resolveIp(request);
      const perIp = ipSockets.get(ip) ?? 0;
      if (upgradedSockets >= limits.maxSockets) {
        log('ws.denied', { reason: 'server_busy' });
        refuseUpgrade(socket, '503 Service Unavailable');
        throw null;
      }
      if (perIp >= limits.maxSocketsPerIp) {
        log('ws.denied', { reason: 'too_many_sockets_ip' });
        refuseUpgrade(socket, '429 Too Many Requests');
        throw null;
      }
      upgradedSockets++;
      ipSockets.set(ip, perIp + 1);
      socket.once('close', () => {
        upgradedSockets--;
        const left = (ipSockets.get(ip) ?? 1) - 1;
        if (left <= 0) ipSockets.delete(ip);
        else ipSockets.set(ip, left);
      });
    },

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const parsed = parseDocumentName(documentName);
      if (!parsed || typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        log('ws.denied', { reason: 'bad_request' });
        throw PERMISSION_DENIED;
      }
      const participant = store.authenticate(token);
      if (!participant || participant.roomId !== parsed.roomId) {
        log('ws.denied', { roomId: parsed.roomId, docKind: parsed.kind, reason: 'not_member' });
        throw PERMISSION_DENIED;
      }
      if (!server.hocuspocus.documents.has(documentName) && roomDocumentCount(parsed.roomId) >= limits.maxDocumentsPerRoom) {
        log('ws.denied', { roomId: parsed.roomId, docKind: parsed.kind, reason: 'room_full' });
        throw ROOM_FULL;
      }
      if (parsed.kind === 'file' && participant.role !== 'owner') connectionConfig.readOnly = true;
      store.touchRoom(participant.roomId);
      log('ws.authenticated', {
        roomId: parsed.roomId,
        participantId: participant.participantId,
        docKind: parsed.kind,
      });
      await options.testHooks?.afterAuthenticate?.();
      return { participantId: participant.participantId, roomId: participant.roomId, role: participant.role };
    },

    async connected({ connection, context }) {
      const socket = connection.webSocket as unknown as WsLike;
      // 인증 직후 문서 로딩 중에 강퇴가 끼어든 경우를 막는다.
      if (context.participantId && !store.isActive(context.participantId)) {
        context.revoked = true;
        log('ws.closing', { roomId: context.roomId, participantId: context.participantId, code: REVOKED.code, reason: REVOKED.reason });
        connection.close(REVOKED);
        closeSocket(socket, REVOKED);
        return;
      }
      if (context.roomId && context.participantId) {
        if (!registerSocket(socket, { roomId: context.roomId, participantId: context.participantId })) {
          context.revoked = true;
          log('ws.denied', { roomId: context.roomId, participantId: context.participantId, reason: 'too_many_connections', code: TOO_MANY_CONNECTIONS.code });
          connection.close(TOO_MANY_CONNECTIONS);
          closeSocket(socket, TOO_MANY_CONNECTIONS);
          return;
        }
      }
      if (!authenticatedSockets.has(socket)) {
        authenticatedSockets.add(socket);
        setReceiverLimit(socket, postAuthLimit);
      }
    },

    async beforeHandleMessage({ context, connection }) {
      if (context.revoked) throw REVOKED;
      if (!takeMessageToken(connection.webSocket)) {
        log('ws.denied', { roomId: context.roomId, participantId: context.participantId, reason: 'rate_limited', code: RATE_LIMITED.code });
        closeSocket(connection.webSocket as unknown as WsLike, RATE_LIMITED);
        throw RATE_LIMITED;
      }
    },

    async onChange({ document, documentName, update }) {
      accountDocument(document, documentName, update.byteLength);
    },

    // 문서 단위 연결 종료(debug 전용). Hocuspocus의 onDisconnect 페이로드에는 close code가 없어 code·사유는 소켓 단위 `ws.closed`가 남긴다.
    async onDisconnect({ context, documentName }) {
      const parsed = parseDocumentName(documentName);
      log('ws.disconnected', { roomId: parsed?.roomId ?? context.roomId, participantId: context.participantId, docKind: parsed?.kind }, 'debug');
    },

    async afterUnloadDocument({ documentName }) {
      docAccounts.delete(documentName);
    },

    // 콘텐츠는 영속 저장하지 않는다 — 문서 상태는 접속자가 있는 동안 메모리에만 존재한다.
    async onStoreDocument() {},
  });

  /**
   * 소켓이 닫혔다 — close code와(서버가 정한 것만 옮긴) 사유를 남긴다. 정상 종료(1000/1001/1005)는 debug.
   * 서버가 직접 닫은 소켓은 서버가 보낸 code·사유를 쓴다(ws의 close 이벤트는 상대의 되돌림 값이라 사유가 비거나 1006일 수 있다).
   * roomId·participantId는 인증 뒤 등록된 소켓만 안다(인증 전에 끊긴 소켓은 code만). 상대가 보낸 사유 문자열은 옮기지 않는다(`other`).
   */
  const logSocketClosed = (socket: WsLike, receivedCode: number, received: Buffer): void => {
    const info = socketInfo.get(socket);
    const sent = sentClose.get(socket);
    const code = sent?.code ?? receivedCode;
    const text = sent?.reason ?? (received.length > 0 ? received.toString('utf8') : '');
    const level: LogLevel = NORMAL_CLOSE_CODES.has(code) ? 'debug' : code === 1009 ? 'warn' : 'info';
    log(
      'ws.closed',
      {
        roomId: info?.roomId,
        participantId: info?.participantId,
        code,
        reason: text === '' ? undefined : KNOWN_CLOSE_REASONS.has(text) ? text : 'other',
      },
      level,
    );
  };

  /**
   * ws 수신기 오류. 프레임이 상한을 넘으면(`WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`) ws가 1009로 소켓을 닫는데, 그때는 상대의 close 응답을 더는
   * 처리하지 않아 `close` 이벤트가 1006으로만 온다 — 1009는 이 오류 이벤트에서만 알 수 있다. 그 밖의 소켓 오류(연결 리셋 등)는 debug.
   */
  const logSocketError = (socket: WsLike, error: unknown): void => {
    const rawCode = (error as { code?: unknown } | null)?.code;
    const errorCode = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(rawCode) ? rawCode : 'UNKNOWN';
    const tooBig = errorCode === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
    const info = socketInfo.get(socket);
    log(
      'ws.error',
      { roomId: info?.roomId, participantId: info?.participantId, reason: errorCode, ...(tooBig ? { code: 1009 } : {}) },
      tooBig ? 'warn' : 'debug',
    );
  };

  // 소켓이 열린 가장 이른 시점(첫 메시지 이전)에 인증 전 프레임 상한과 인증 타임아웃을 건다.
  const acceptConnection = server.hocuspocus.handleConnection.bind(server.hocuspocus);
  server.hocuspocus.handleConnection = (incoming, request, defaultContext) => {
    const socket = incoming as unknown as WsLike;
    setReceiverLimit(socket, limits.preAuthMaxPayloadBytes);
    const timer = setTimeout(() => {
      if (authenticatedSockets.has(socket) || socket.readyState !== WS_OPEN) return;
      log('ws.denied', { reason: 'auth_timeout', code: AUTH_TIMEOUT.code });
      closeSocket(socket, AUTH_TIMEOUT);
      setTimeout(() => socket.terminate(), 2000).unref();
    }, limits.authTimeoutMs);
    timer.unref();
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      logSocketClosed(socket, code, reason);
    });
    socket.on('error', (error) => logSocketError(socket, error));
    return acceptConnection(incoming, request, defaultContext);
  };

  function roomDocumentCount(roomId: string): number {
    let count = 0;
    for (const _ of roomDocuments(roomId)) count++;
    return count;
  }

  const sockets = new Set<Socket>();
  server.httpServer.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await server.listen();
  const port = server.address.port;
  log('relay.listening', { port });

  if (limits.roomTtlDays > 0) sweepStaleRooms();
  const sweeper =
    limits.roomTtlDays > 0 ? setInterval(sweepStaleRooms, Math.max(1000, limits.roomSweepIntervalMs)) : undefined;
  sweeper?.unref();

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      closingStarted = true;
      if (sweeper) clearInterval(sweeper);
      const httpClosed = new Promise<void>((resolve) => server.httpServer.once('close', () => resolve()));
      await server.destroy();
      for (const socket of sockets) socket.destroy();
      await httpClosed;
      store.close();
      emit('relay.closed');
    })();
    return closing;
  };

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    stats: () => ({
      documents: server.hocuspocus.getDocumentsCount(),
      connections: server.hocuspocus.getConnectionsCount(),
    }),
    sweepStaleRooms,
    close,
  };
}
