import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { type RelayHandle, type RelayOptions, startRelay } from '../src/relay.js';

const tempDirs: string[] = [];

export function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  tempDirs.push(dir);
  return join(dir, 'relay.db');
}

export function cleanupTemp(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export class Api {
  constructor(private readonly base: string) {}

  async call<T = any>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    let body: string | undefined;
    if (opts.raw !== undefined) body = opts.raw;
    else if (opts.body !== undefined) body = JSON.stringify(opts.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(this.base + path, { method, headers, body });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
  }

  createRoom(ownerName = 'Owner', folderName?: unknown) {
    return this.call('POST', '/rooms', { body: folderName === undefined ? { ownerName } : { ownerName, folderName } });
  }

  join(code: string, displayName = 'Guest', headers?: Record<string, string>) {
    return this.call('POST', '/join', { body: { code, displayName }, headers });
  }
}

export interface Member {
  roomId: string;
  participantId: string;
  token: string;
}

export interface Room {
  roomId: string;
  owner: Member;
  inviteCode: string;
}

export async function newRoom(api: Api, ownerName = 'Owner', folderName?: string): Promise<Room> {
  const res = await api.createRoom(ownerName, folderName);
  if (res.status !== 200) throw new Error(`createRoom failed: ${res.status}`);
  const { roomId, ownerId, ownerToken, inviteCode } = res.body;
  return { roomId, owner: { roomId, participantId: ownerId, token: ownerToken }, inviteCode };
}

export async function joinRoom(api: Api, code: string, displayName = 'Guest'): Promise<Member> {
  const res = await api.join(code, displayName);
  if (res.status !== 200) throw new Error(`join failed: ${res.status}`);
  return { roomId: res.body.roomId, participantId: res.body.participantId, token: res.body.token };
}

export async function addGuest(api: Api, room: Room, displayName = 'Guest'): Promise<Member> {
  const invite = await api.call('POST', `/rooms/${room.roomId}/invites`, { token: room.owner.token });
  return joinRoom(api, invite.body.inviteCode, displayName);
}

export async function until(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 8000,
  detail?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for: ${what}${detail ? ` (${detail()})` : ''}`);
}

export interface Client {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  failed: string[];
  closes: number[];
  /** 문서 단위 close 메시지의 reason. 문서 단위 close는 프로바이더에서 code가 항상 1000이라 reason으로 구분한다. */
  closeReasons: string[];
  synced(): Promise<void>;
  destroy(): void;
}

export class Harness {
  relay!: RelayHandle;
  api!: Api;
  private clients: Client[] = [];

  async start(options: RelayOptions = {}): Promise<this> {
    this.relay = await startRelay({ silent: true, port: 0, ...options });
    this.api = new Api(this.relay.url);
    return this;
  }

  connect(name: string, token: string, doc: Y.Doc = new Y.Doc()): Client {
    const failed: string[] = [];
    const closes: number[] = [];
    const closeReasons: string[] = [];
    let isSynced = false;
    const provider = new HocuspocusProvider({
      url: this.relay.wsUrl,
      name,
      document: doc,
      token,
      onAuthenticationFailed: ({ reason }) => failed.push(reason),
      onSynced: () => {
        isSynced = true;
      },
      onClose: ({ event }) => {
        closes.push(event?.code ?? 0);
        closeReasons.push(event?.reason ?? '');
      },
    });
    const client: Client = {
      doc,
      provider,
      failed,
      closes,
      closeReasons,
      synced: () =>
        until(
          () => isSynced || failed.length > 0,
          `sync of ${name}`,
          8000,
          () => `failed=${JSON.stringify(failed)} closes=${JSON.stringify(closes)} relay=${JSON.stringify(this.relay.stats())}`,
        ),
      destroy: () => provider.destroy(),
    };
    this.clients.push(client);
    return client;
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.destroy();
    this.clients = [];
    await this.relay?.close();
  }
}

/** 라이브러리 없이 소켓 수준 동작(인증 전 프레임·타임아웃·업그레이드 거절)을 보는 원시 WebSocket. */
export interface RawSocket {
  ws: WebSocket;
  wasOpen: () => boolean;
  /** 연결이 열리기 전에 실패했다면 그 사유(error 메시지 또는 close code) — 간헐 실패 진단용. */
  failure: () => string;
  /** 서버 또는 네트워크가 소켓을 닫은 뒤 그 close code(비정상 종료는 1006). */
  closed: Promise<number>;
  opened: Promise<boolean>;
}

export function openRaw(url: string): RawSocket {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  let open = false;
  let failure = '';
  const opened = new Promise<boolean>((resolve) => {
    ws.addEventListener('open', () => {
      open = true;
      resolve(true);
    });
    ws.addEventListener('close', (event) => {
      if (!open) failure ||= `close ${event.code}`;
      resolve(false);
    });
    ws.addEventListener('error', (event) => {
      if (!open) failure ||= `error ${String((event as { message?: unknown }).message ?? 'unknown')}`;
      resolve(false);
    });
  });
  const closed = new Promise<number>((resolve) => {
    ws.addEventListener('close', (event) => resolve(event.code));
    // 핸드셰이크가 거절되면(non-101) undici는 close 없이 error만 낸다 — 1006(비정상 종료)으로 취급.
    ws.addEventListener('error', () => resolve(1006));
  });
  return { ws, wasOpen: () => open, failure: () => failure, closed, opened };
}

/** 한 소켓(HocuspocusProviderWebsocket)에 문서 여러 개를 붙인다 — 공유 폴더 클라이언트와 같은 형태. */
export class SharedSocket {
  private readonly socket: HocuspocusProviderWebsocket;
  readonly providers: HocuspocusProvider[] = [];
  readonly failed: string[] = [];

  constructor(wsUrl: string) {
    this.socket = new HocuspocusProviderWebsocket({ url: wsUrl });
  }

  attach(roomId: string, token: string, names: string[]): HocuspocusProvider[] {
    return names.map((name) => {
      const provider = new HocuspocusProvider({
        websocketProvider: this.socket,
        name: `${roomId}/${name}`,
        document: new Y.Doc(),
        token,
        onAuthenticationFailed: ({ reason }) => this.failed.push(`${name}:${reason}`),
      });
      provider.attach();
      this.providers.push(provider);
      return provider;
    });
  }

  destroy(): void {
    for (const p of this.providers) p.destroy();
    this.socket.destroy();
  }
}
