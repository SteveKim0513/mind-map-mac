// share/ 단위 테스트 전용 가짜 소켓·프로바이더·IPC (프로덕션 코드에서 import하지 않는다).
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { ShareApi } from './api';
import { sidecarIdForDocKey } from './docKeys';
import type { ProviderConfig, SessionFactories } from './shareClient';

class Emitter {
  private handlers = new Map<string, Set<(...a: never[]) => void>>();
  on(event: string, fn: (...a: never[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn?: (...a: never[]) => void) {
    if (fn) this.handlers.get(event)?.delete(fn);
    else this.handlers.delete(event);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const fn of [...(this.handlers.get(event) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
    return this;
  }
}

export class FakeSocket extends Emitter {
  connectCalls = 0;
  disconnectCalls = 0;
  destroyed = false;
  shouldConnect = false;
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  connect() {
    this.connectCalls++;
    this.shouldConnect = true;
    return Promise.resolve();
  }
  disconnect() {
    this.disconnectCalls++;
    this.shouldConnect = false;
  }
  destroy() {
    this.destroyed = true;
  }
  /** 실제 소켓처럼 status 이벤트를 발생. */
  setStatus(status: 'connecting' | 'connected' | 'disconnected') {
    this.emit('status', { status });
  }
  close(code: number, reason?: string) {
    this.emit('close', { event: reason === undefined ? { code } : { code, reason } });
    this.setStatus('disconnected');
  }
}

export class FakeProvider extends Emitter {
  isSynced = false;
  attached = false;
  destroyed = false;
  awareness: Awareness | null;
  document: Y.Doc;
  name: string;
  token: () => Promise<string>;
  constructor(c: ProviderConfig) {
    super();
    this.awareness = c.awareness;
    this.document = c.document;
    this.name = c.name;
    this.token = c.token;
  }
  attachCalls = 0;
  detachCalls = 0;
  attach() {
    this.attachCalls++;
    this.attached = true;
  }
  detach() {
    this.detachCalls++;
    this.attached = false;
  }
  destroy() {
    this.destroyed = true;
    this.attached = false;
    this.awareness?.destroy(); // 실제 프로바이더도 destroy 시 awareness를 정리한다
  }
  authenticate() {
    this.emit('authenticated', { scope: 'read-write' });
  }
  denyAuth(reason = 'permission-denied') {
    this.emit('authenticationFailed', { reason });
  }
  sendTokenCalls = 0;
  sendToken() {
    this.sendTokenCalls++;
    return Promise.resolve();
  }
  sync() {
    this.isSynced = true;
    this.emit('synced', { state: true });
  }
}

export function makeFakeFactories() {
  const sockets: FakeSocket[] = [];
  const providers: FakeProvider[] = [];
  const factories: SessionFactories = {
    createSocket: ({ url }) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s as unknown as HocuspocusProviderWebsocket;
    },
    createProvider: (c) => {
      const p = new FakeProvider(c);
      providers.push(p);
      return p as unknown as HocuspocusProvider;
    },
  };
  return { factories, sockets, providers };
}

type Sidecars = Map<string, Uint8Array>;

/** window.api.share 대역 — 인메모리 사이드카·토큰·표식. 호출을 기록한다. */
export function makeFakeShareApi(over: Partial<ShareApi> = {}) {
  const sidecars: Sidecars = new Map();
  const tokens = new Map<string, string>();
  const calls: string[] = [];
  /**
   * 사이드카 쓰기 실패 주입 — `'io'`(일시적 오류: 재시도할 가치가 있다) · `'invalid_input'`(영구 오류: 용량 초과 등) · `null`(정상).
   * `sidecarWriteAttempts`는 실패를 포함한 쓰기 시도 횟수(재시도 상한 검증용).
   */
  const switches: { failSidecar: 'io' | 'invalid_input' | null; sidecarWriteAttempts: number } = { failSidecar: null, sidecarWriteAttempts: 0 };
  const api = {
    relayUrl: async () => ({ ok: true as const, info: { url: 'https://relay.example.com', wsUrl: 'wss://relay.example.com' } }),
    readMarker: async () => null,
    writeMarker: async () => ({ ok: true as const }),
    removeMarker: async () => ({ ok: true as const }),
    listMarkers: async () => [],
    tokenGet: async (roomId: string) => tokens.get(roomId) ?? null,
    tokenSet: async (roomId: string, token: string) => {
      tokens.set(roomId, token);
      return { ok: true as const };
    },
    tokenDelete: async (roomId: string) => {
      tokens.delete(roomId);
    },
    createRoom: async () => ({ ok: false as const, error: 'network' as const }),
    join: async () => ({ ok: false as const, error: 'network' as const }),
    invite: async () => ({ ok: false as const, error: 'network' as const }),
    participants: async () => ({ ok: true as const, participants: [] }),
    revoke: async () => ({ ok: true as const }),
    deleteRoom: async () => ({ ok: true as const }),
    sidecarRead: async (folder: string, id: string) => {
      calls.push(`read:${id}`);
      return sidecars.get(`${folder}|${id}`) ?? null;
    },
    sidecarWrite: async (folder: string, id: string, data: Uint8Array) => {
      calls.push(`write:${id}`);
      switches.sidecarWriteAttempts++;
      if (switches.failSidecar) return { ok: false as const, error: switches.failSidecar };
      sidecars.set(`${folder}|${id}`, data);
      return { ok: true as const };
    },
    ...over,
  } as ShareApi;
  return { api, sidecars, tokens, calls, switches };
}

/** 노트 사이드카의 파일 id(`n_` + hex) — 테스트가 사이드카 맵·호출 기록을 조회할 때 쓴다. */
export const noteSidecarId = (noteId: string): string => sidecarIdForDocKey(`note:${noteId}`)!;
/** `makeFakeShareApi().sidecars`의 키(`<폴더>|<사이드카 id>`). */
export const noteSidecarKey = (folder: string, noteId: string): string => `${folder}|${noteSidecarId(noteId)}`;
