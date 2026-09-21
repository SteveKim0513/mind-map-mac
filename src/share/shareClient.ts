// 공유 폴더(방) 하나당 하나의 세션: WebSocket 하나를 공유하고 문서마다 HocuspocusProvider를 붙인다.
//
// 규칙
//  - Y.Doc은 세션(=문서를 여는 시점)마다 새로 만든다. clientID를 저장·재사용하지 않는다
//    (같은 clientID가 두 인스턴스에서 쓰이면 CRDT가 깨진다). 상태 복원은 사이드카 update 적용으로만.
//  - 공유 소켓 위의 프로바이더는 생성 직후 반드시 provider.attach() 해야 동기화가 시작된다.
//  - 토큰은 프로바이더 token 함수로 연결(재연결)마다 가져온다 — 로그·저장 금지.
//  - 강퇴(소켓 close 4403 'revoked')나 인증 실패 사유가 permission-denied/revoked면 status='denied'로 두고 재접속을 멈춘다.
//    (프로바이더 내장 재접속은 그 외의 끊김에만 쓴다.)
//  - 그 밖의 인증 실패 사유(예: 서버가 문서 수 상한으로 거부)는 **그 문서만** 실패로 다룬다 — 세션은 살아 있고, 그 문서의 인증을
//    지수 백오프로 다시 시도한다. 문서 하나의 실패가 방 전체를 영구 "접근 해제됨"으로 만들면 안 된다.
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { ShareConnStatus } from '../types';
import { isRoomId } from '../io/shareFormat';
import { makeDocName, type DocKey } from './docKeys';

/**
 * 릴레이가 소켓을 끊을 때 쓰는 close code(server/src/relay.ts). 4403은 "이 방에 더 접근할 수 없다"(reason `revoked`: 강퇴, `room_deleted`:
 * 소유자가 방을 지움)이라 재접속하지 않는다. 4408(`auth_timeout`)·4429(`rate_limited`/`too_many_connections`)는 일시적이라 늘려 가는
 * 대기 뒤에 다시 접속한다(접근 해제가 아니다).
 */
export const REVOKED_CLOSE_CODE = 4403;
export const AUTH_TIMEOUT_CLOSE_CODE = 4408;
export const RATE_LIMITED_CLOSE_CODE = 4429;
/** 문서 단위 close 사유(provider가 close code를 항상 1000으로 전달해 reason 문자열로만 구분한다): 이 문서만 서버 한도를 넘었다. */
const DOC_LIMIT_REASONS = new Set(['doc_too_large', 'room_over_budget']);
/** 서버가 한도로 닫은 문서를 다시 붙여 보는 횟수와 첫 대기(이후 4배) — 같은 문서가 계속 쫓겨나는 루프를 막는다. */
const DOC_EVICT_MAX_RETRIES = 2;
const DOC_EVICT_RETRY_MS = 60_000;
/** 소켓 close 4408/4429 뒤 재접속 대기: 기본 대기 × 2^(연속 횟수-1), 최대 60초. */
const RECONNECT_BASE_MS = { [AUTH_TIMEOUT_CLOSE_CODE]: 1000, [RATE_LIMITED_CLOSE_CODE]: 5000 } as const;
const RECONNECT_MAX_MS = 60_000;
const DEFAULT_SYNC_TIMEOUT_MS = 10_000;

export interface ShareDocHandle {
  docKey: DocKey;
  /** `${roomId}/${docKey}` */
  name: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  provider: HocuspocusProvider;
  /** 서버와 첫 동기화가 끝나면 true. timeout(기본 10s) 안에 안 되면 false(오프라인·거부). */
  whenSynced(timeoutMs?: number): Promise<boolean>;
}

export interface SessionHooks {
  /** 집계 연결 상태가 바뀔 때. `reason`은 denied일 때 원인 코드('revoked' | 'permission-denied'). */
  onStatus?(status: ShareConnStatus, reason?: string): void;
  /** 문서 하나의 인증이 (접근 해제가 아닌 사유로) 실패했다 — 세션은 유지되고 재시도한다. */
  onDocFailed?(docKey: DocKey, reason: string): void;
  /** 인증에 실패했던 문서가 다시 인증됐다. */
  onDocRecovered?(docKey: DocKey): void;
  /** 그 문서의 재시도가 상한에 닿아 더는 시도하지 않는다(인증 재시도 6번 소진, 서버 한도 재접속 횟수 소진) — 진단 로그용. */
  onDocGaveUp?(docKey: DocKey, reason: string): void;
  /** 소켓이 닫혔다(진단 로그용). `code`는 close code(없으면 undefined), `reason`은 서버가 보낸 사유(없으면 undefined). */
  onSocketClose?(code: number | undefined, reason: string | undefined): void;
}

/** 이 인증 실패 사유는 "이 참가자는 이 방에 접근할 수 없다"는 뜻이다(서버가 문서 이름·토큰·멤버십으로 거부). 그 외 사유는 문서 하나의 문제다. */
export function isAccessDeniedReason(reason: unknown): boolean {
  return reason === 'permission-denied' || reason === 'revoked';
}
/** 인증 실패한 문서의 재시도: 첫 재시도 1초, 두 배씩 늘려 최대 30초, 최대 6번. */
const DOC_RETRY_BASE_MS = 1000;
const DOC_RETRY_MAX_MS = 30_000;
const DOC_RETRY_MAX_ATTEMPTS = 6;

export interface ProviderConfig {
  socket: HocuspocusProviderWebsocket;
  name: string;
  document: Y.Doc;
  awareness: Awareness;
  token: () => Promise<string>;
}

/** 테스트에서 가짜 소켓·프로바이더로 바꿔 끼울 수 있게 한 팩토리. */
export interface SessionFactories {
  createSocket(config: { url: string }): HocuspocusProviderWebsocket;
  createProvider(config: ProviderConfig): HocuspocusProvider;
}

export const defaultFactories: SessionFactories = {
  // autoConnect:false — 첫 프로바이더를 붙인 뒤 session.connect()가 연결을 시작한다.
  createSocket: ({ url }) => new HocuspocusProviderWebsocket({ url, autoConnect: false }),
  createProvider: (c) =>
    new HocuspocusProvider({
      websocketProvider: c.socket,
      name: c.name,
      document: c.document,
      awareness: c.awareness,
      token: c.token,
    }),
};

export interface ShareSession {
  readonly roomId: string;
  readonly status: ShareConnStatus;
  /** 소켓 연결 시작(이미 시작했으면 무시). denied 상태에서는 reconnect()를 써야 한다. */
  connect(): void;
  /** denied를 해제하고 다시 연결(예: 토큰을 새로 받은 뒤). */
  reconnect(): void;
  /** 연결만 끊는다(문서·Y.Doc은 유지). status는 'idle'. */
  disconnect(): void;
  /**
   * 문서를 연다. 새 Y.Doc을 만들고 `initialState`(사이드카 update)가 있으면 프로바이더를 붙이기 **전에** 적용한다.
   * 이미 열려 있으면 그 핸들을 돌려준다.
   */
  openDoc(docKey: DocKey, opts?: { initialState?: Uint8Array | null }): ShareDocHandle;
  getDoc(docKey: DocKey): ShareDocHandle | undefined;
  /** 문서를 닫는다(프로바이더 destroy → Y.Doc destroy). */
  closeDoc(docKey: DocKey): void;
  /** 모든 문서를 닫고 소켓을 파기한다. 이후 사용 불가. */
  destroy(): void;
}

export interface CreateSessionOptions {
  roomId: string;
  /** 릴레이 WebSocket base URL(`share:relayUrl`의 wsUrl). */
  wsUrl: string;
  /** 연결(재연결)마다 호출되는 토큰 공급자. */
  getToken: () => Promise<string | null>;
  hooks?: SessionHooks;
  factories?: SessionFactories;
}

/** 로컬 사용자 정보를 awareness에 싣는다(커서·참가자 표시용). 색상은 소비하는 쪽(에디터)이 정한다. */
export function setLocalUser(awareness: Awareness, user: { participantId: string; name: string }): void {
  awareness.setLocalStateField('user', { participantId: user.participantId, name: user.name });
}

/** 새 Y.Doc에 사이드카 update를 적용(clientID는 새로 생성됨). 손상됐으면 false. */
function applyInitialState(ydoc: Y.Doc, bytes: Uint8Array): boolean {
  try {
    Y.applyUpdate(ydoc, bytes, 'share:initial');
    return true;
  } catch {
    return false;
  }
}

export function createShareSession(opts: CreateSessionOptions): ShareSession {
  if (!isRoomId(opts.roomId)) throw new Error('invalid room id');
  const factories = opts.factories ?? defaultFactories;
  const socket = factories.createSocket({ url: opts.wsUrl });

  const docs = new Map<DocKey, ShareDocHandle>();
  const authed = new Set<DocKey>();
  let wsStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  let started = false;
  let destroyed = false;
  let denied: string | null = null;
  let last: ShareConnStatus = 'idle';
  /** 소켓 close 4408/4429 뒤 재접속을 미루는 시각·연속 횟수·대기 타이머. */
  let backoffUntil = 0;
  let backoffAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 서버가 문서 한도로 닫은 문서(→ 다시 붙인 횟수·타이머). */
  const evicted = new Map<DocKey, { count: number; timer: ReturnType<typeof setTimeout> | null }>();
  function clearReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  function clearEvicted(docKey?: DocKey) {
    const keys = docKey ? [docKey] : [...evicted.keys()];
    for (const k of keys) {
      const e = evicted.get(k);
      if (e?.timer) clearTimeout(e.timer);
      evicted.delete(k);
    }
  }
  /** 인증에 실패해 재시도 중인 문서(→ 시도 횟수·타이머). */
  const failed = new Map<DocKey, { attempts: number; timer: ReturnType<typeof setTimeout> | null; gaveUp?: boolean }>();

  function clearRetry(docKey: DocKey) {
    const f = failed.get(docKey);
    if (f?.timer) clearTimeout(f.timer);
    failed.delete(docKey);
  }
  function clearAllRetries() {
    for (const f of failed.values()) if (f.timer) clearTimeout(f.timer);
    failed.clear();
  }
  function scheduleDocRetry(docKey: DocKey, reason: string) {
    const f = failed.get(docKey) ?? { attempts: 0, timer: null };
    failed.set(docKey, f);
    if (f.timer) return;
    if (f.attempts >= DOC_RETRY_MAX_ATTEMPTS) {
      if (!f.gaveUp) {
        f.gaveUp = true;
        opts.hooks?.onDocGaveUp?.(docKey, reason);
      }
      return;
    }
    const delay = Math.min(DOC_RETRY_MAX_MS, DOC_RETRY_BASE_MS * 2 ** f.attempts);
    f.attempts++;
    f.timer = setTimeout(() => {
      f.timer = null;
      const h = docs.get(docKey);
      if (!h || destroyed || denied || wsStatus !== 'connected') {
        // 지금은 보낼 수 없다(오프라인·파기) — 소켓이 다시 연결되면 프로바이더가 인증을 새로 보낸다.
        return;
      }
      const p = h.provider as unknown as { sendToken?: () => Promise<void> };
      void p.sendToken?.().catch(() => undefined);
    }, delay);
  }

  // 프로바이더 내장 재접속(setTimeout → connect())이 denied 이후에도 되살아나지 않도록 connect를 가드한다.
  const rawConnect = socket.connect.bind(socket) as () => Promise<unknown>;
  socket.connect = (() => {
    if (denied || destroyed) return Promise.resolve();
    const wait = backoffUntil - Date.now();
    if (wait > 0) {
      // 4408/4429 뒤에는 프로바이더의 고정 간격 재접속이 서버를 두드리지 않게 대기 시간이 끝나면 한 번만 다시 연결한다.
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (started && !denied && !destroyed) void rawConnect();
        }, wait);
      }
      return Promise.resolve();
    }
    return rawConnect();
  }) as typeof socket.connect;

  function compute(): ShareConnStatus {
    if (destroyed || !started) return 'idle';
    if (denied) return 'denied';
    if (wsStatus === 'disconnected') return 'disconnected';
    if (wsStatus === 'connecting') return 'connecting';
    return authed.size > 0 ? 'connected' : 'connecting';
  }
  function emit() {
    const next = compute();
    if (next === last) return;
    last = next;
    opts.hooks?.onStatus?.(next, next === 'denied' ? (denied ?? undefined) : undefined);
  }
  function deny(reason: string) {
    if (denied) return;
    denied = reason;
    authed.clear();
    clearAllRetries();
    clearReconnect();
    clearEvicted();
    try {
      socket.disconnect(); // shouldConnect=false + 소켓 종료
    } catch {
      /* 이미 닫힘 */
    }
    emit();
  }

  socket.on('status', ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    wsStatus = status;
    if (status === 'disconnected') authed.clear();
    emit();
  });
  socket.on('close', ({ event }: { event?: { code?: number; reason?: string } }) => {
    const code = event?.code;
    opts.hooks?.onSocketClose?.(code, typeof event?.reason === 'string' && event.reason !== '' ? event.reason : undefined);
    if (code === REVOKED_CLOSE_CODE) {
      // 강퇴(`revoked`)와 소유자의 공유 종료(`room_deleted`)는 둘 다 재접속하지 않는다 — 사유는 화면 문구가 구분한다.
      deny(event?.reason === 'room_deleted' ? 'room_deleted' : 'revoked');
    } else if (code === AUTH_TIMEOUT_CLOSE_CODE || code === RATE_LIMITED_CLOSE_CODE) {
      backoffAttempts++;
      const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS[code] * 2 ** (backoffAttempts - 1));
      backoffUntil = Date.now() + wait;
    }
  });

  /** 서버가 한도(문서 크기·방 예산)로 문서 하나를 닫았다 — 그 문서만 멈추고 세션은 유지한다. 몇 번만 다시 붙여 본다. */
  function stopDocForLimit(docKey: DocKey, reason: string) {
    if (destroyed || denied) return;
    const h = docs.get(docKey);
    if (!h) return;
    authed.delete(docKey);
    const e = evicted.get(docKey) ?? { count: 0, timer: null };
    evicted.set(docKey, e);
    e.count++;
    opts.hooks?.onDocFailed?.(docKey, reason);
    if (e.count > DOC_EVICT_MAX_RETRIES) opts.hooks?.onDocGaveUp?.(docKey, reason); // 더는 다시 붙여 보지 않는다
    try {
      h.provider.detach(); // 같은 문서가 재접속 때마다 다시 쫓겨나지 않게 소켓에서 뗀다
    } catch {
      /* 이미 파기됨 */
    }
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    if (e.count <= DOC_EVICT_MAX_RETRIES) {
      e.timer = setTimeout(() => {
        e.timer = null;
        if (destroyed || denied || docs.get(docKey) !== h) return;
        try {
          h.provider.attach();
        } catch {
          /* 이미 파기됨 */
        }
      }, DOC_EVICT_RETRY_MS * 4 ** (e.count - 1));
    }
    emit();
  }

  const session: ShareSession = {
    roomId: opts.roomId,
    get status() {
      return last;
    },

    connect() {
      if (destroyed || started) return;
      started = true;
      wsStatus = 'connecting';
      emit();
      void rawConnect();
    },

    reconnect() {
      if (destroyed) return;
      denied = null;
      backoffUntil = 0;
      backoffAttempts = 0;
      started = true;
      wsStatus = 'connecting';
      emit();
      void rawConnect();
    },

    disconnect() {
      if (destroyed) return;
      started = false;
      clearReconnect();
      authed.clear();
      try {
        socket.disconnect();
      } catch {
        /* noop */
      }
      emit();
    },

    openDoc(docKey, o) {
      if (destroyed) throw new Error('session destroyed');
      const existing = docs.get(docKey);
      if (existing) return existing;
      const name = makeDocName(opts.roomId, docKey);
      const ydoc = new Y.Doc(); // 세션마다 새 Y.Doc — clientID 재사용 금지
      if (o?.initialState && o.initialState.byteLength > 0) applyInitialState(ydoc, o.initialState);
      const awareness = new Awareness(ydoc);
      const provider = factories.createProvider({
        socket,
        name,
        document: ydoc,
        awareness,
        token: async () => (await opts.getToken()) ?? '',
      });
      provider.on('authenticated', () => {
        authed.add(docKey);
        backoffAttempts = 0; // 인증까지 됐다 — 소켓 재접속 백오프를 처음으로
        backoffUntil = 0;
        if (failed.has(docKey) || evicted.has(docKey)) {
          clearRetry(docKey);
          const wasEvicted = evicted.get(docKey);
          // 한도로 쫓겨났던 문서가 다시 붙어 인증되면 문제 표시를 거둔다(재시도 횟수는 유지 — 곧 또 쫓겨나면 상한에 닿는다).
          if (wasEvicted?.timer) clearTimeout(wasEvicted.timer);
          if (wasEvicted) wasEvicted.timer = null;
          opts.hooks?.onDocRecovered?.(docKey);
        }
        emit();
      });
      provider.on('close', (payload?: { event?: { reason?: string } }) => {
        const reason = payload?.event?.reason;
        if (typeof reason === 'string' && DOC_LIMIT_REASONS.has(reason)) stopDocForLimit(docKey, reason);
      });
      provider.on('authenticationFailed', (payload?: { reason?: unknown }) => {
        const reason = payload?.reason;
        if (isAccessDeniedReason(reason)) {
          deny(reason === 'revoked' ? 'revoked' : 'permission-denied');
          return;
        }
        // 접근 해제가 아닌 실패(문서 수 상한·토큰을 못 읽음 등) — 이 문서만 실패로 두고 세션은 유지한다.
        authed.delete(docKey);
        const failure = typeof reason === 'string' ? reason : 'unknown';
        opts.hooks?.onDocFailed?.(docKey, failure);
        scheduleDocRetry(docKey, failure);
        emit();
      });
      provider.attach(); // 공유 소켓에서는 필수 — 없으면 동기화가 시작되지 않는다
      const handle: ShareDocHandle = {
        docKey,
        name,
        ydoc,
        awareness,
        provider,
        whenSynced(timeoutMs = DEFAULT_SYNC_TIMEOUT_MS) {
          if (provider.isSynced) return Promise.resolve(true);
          return new Promise<boolean>((resolve) => {
            const onSynced = ({ state }: { state?: boolean }) => {
              if (state === false) return;
              cleanup();
              resolve(true);
            };
            const timer = setTimeout(() => {
              cleanup();
              resolve(false);
            }, timeoutMs);
            function cleanup() {
              clearTimeout(timer);
              provider.off('synced', onSynced);
            }
            provider.on('synced', onSynced);
          });
        },
      };
      docs.set(docKey, handle);
      return handle;
    },

    getDoc: (docKey) => docs.get(docKey),

    closeDoc(docKey) {
      const h = docs.get(docKey);
      if (!h) return;
      docs.delete(docKey);
      authed.delete(docKey);
      clearRetry(docKey);
      clearEvicted(docKey);
      try {
        h.provider.destroy(); // flush → 소켓에서 detach(close 메시지) → awareness 정리
      } catch {
        /* 이미 파기됨 */
      }
      h.ydoc.destroy();
      emit();
    },

    destroy() {
      if (destroyed) return;
      for (const key of [...docs.keys()]) session.closeDoc(key);
      clearAllRetries();
      clearReconnect();
      clearEvicted();
      destroyed = true;
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      emit(); // → 'idle'
    },
  };
  return session;
}
