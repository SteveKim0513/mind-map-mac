import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCrashHandlers } from '../src/crash.js';
import { classifyRoute, createHttpHandler } from '../src/http.js';
import { createClientIpResolver } from '../src/clientIp.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { describeError, formatLogLine, parseLogLevel, sanitizeMessage, type LogFields, type LogLevel } from '../src/logger.js';
import { Harness, addGuest, cleanupTemp, newRoom, openRaw, until } from './helpers.js';

type Line = Record<string, unknown> & { event: string; level: string };

/** stdout/stderr(console)로 나가는 로그 줄을 모은다. JSON이 아닌 줄은 raw에만 남는다. */
function captureLogs() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(push);
  vi.spyOn(console, 'error').mockImplementation(push);
  return {
    events: (): Line[] =>
      lines.flatMap((l) => {
        try {
          return [JSON.parse(l) as Line];
        } catch {
          return [];
        }
      }),
    find: (event: string, match: (l: Line) => boolean = () => true): Line | undefined =>
      captureLogsEvents(lines).find((l) => l.event === event && match(l)),
    raw: () => lines.join('\n'),
  };
}
function captureLogsEvents(lines: string[]): Line[] {
  return lines.flatMap((l) => {
    try {
      return [JSON.parse(l) as Line];
    } catch {
      return [];
    }
  });
}

let h: Harness | undefined;
let httpServer: Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await h?.stop();
  h = undefined;
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  httpServer = undefined;
  cleanupTemp();
});

const started = async (extra: Parameters<Harness['start']>[0] = {}) => {
  h = await new Harness().start({ silent: false, ...extra });
  return h;
};

describe('http route classification', () => {
  it('names routes by URL pattern, never by id values', () => {
    expect(classifyRoute(['health'])).toBe('/health');
    expect(classifyRoute(['rooms'])).toBe('/rooms');
    expect(classifyRoute(['join'])).toBe('/join');
    expect(classifyRoute(['rooms', 'abc123'])).toBe('/rooms/:roomId');
    expect(classifyRoute(['rooms', 'abc123', 'invites'])).toBe('/rooms/:roomId/invites');
    expect(classifyRoute(['rooms', 'abc123', 'participants'])).toBe('/rooms/:roomId/participants');
    expect(classifyRoute(['rooms', 'abc123', 'participants', 'p1'])).toBe('/rooms/:roomId/participants/:participantId');
    expect(classifyRoute([])).toBe('unmatched');
    expect(classifyRoute(['wp-login.php'])).toBe('unmatched');
    expect(classifyRoute(['rooms', 'a', 'b', 'c', 'd'])).toBe('unmatched');
    expect(classifyRoute(['rooms', 'a', 'unknown'])).toBe('unmatched');
  });

  it('keeps the route name and logs the error code when a handler ends in an HttpError', async () => {
    const logs = captureLogs();
    const relay = await started();
    const room = await newRoom(relay.api);
    const guest = await addGuest(relay.api, room);

    expect((await relay.api.join('ZZZZZZZZ')).status).toBe(404); // 잘못된 초대 코드
    expect((await relay.api.call('GET', `/rooms/${room.roomId}/participants`, { token: 'nope' })).status).toBe(401);
    expect((await relay.api.call('POST', `/rooms/${room.roomId}/invites`, { token: guest.token })).status).toBe(403); // 참가자는 초대 불가
    expect((await relay.api.call('DELETE', `/rooms/${room.roomId}/participants/${room.owner.participantId}`, { token: room.owner.token })).status).toBe(400);
    expect((await relay.api.call('GET', '/rooms')).status).toBe(405);
    expect((await relay.api.call('GET', '/wp-login.php')).status).toBe(404);
    expect((await relay.api.createRoom('')).status).toBe(400);
    expect((await relay.api.call('GET', '/health')).status).toBe(200);

    const http = logs.events().filter((l) => l.event === 'http');
    const by = (route: string, status: number) => http.find((l) => l.route === route && l.status === status);
    expect(by('/join', 404)?.reason).toBe('invalid_code');
    expect(by('/rooms/:roomId/participants', 401)?.reason).toBe('unauthorized');
    expect(by('/rooms/:roomId/invites', 403)?.reason).toBe('forbidden');
    expect(by('/rooms/:roomId/participants/:participantId', 400)?.reason).toBe('cannot_remove_owner');
    expect(by('/rooms', 405)?.reason).toBe('method_not_allowed');
    expect(by('unmatched', 404)?.reason).toBe('not_found');
    expect(by('/rooms', 400)?.reason).toBe('invalid_owner_name');
    expect(http.some((l) => l.route === '/health')).toBe(false); // health는 기존대로 남기지 않는다
    // 성공 요청에는 reason이 없다.
    expect(by('/rooms', 200)?.reason).toBeUndefined();
    // 방·참가자 id 값이 route 이름에 새지 않는다.
    for (const line of http) {
      expect(String(line.route)).not.toContain(room.roomId);
      expect(String(line.route)).not.toContain(guest.participantId);
    }
    // 어떤 실패 요청도 unmatched로 뭉개지지 않는다(정말 없는 경로 하나만 예외).
    expect(http.filter((l) => l.route === 'unmatched')).toHaveLength(1);
  });

  it('logs the 429 rate_limited reason for the join brute-force guard', async () => {
    const logs = captureLogs();
    const relay = await started();
    for (let i = 0; i < 10; i++) expect((await relay.api.join(`ABCDEFG${i}`)).status).toBe(404);
    expect((await relay.api.join('ABCDEFGH')).status).toBe(429);
    const limited = logs.events().find((l) => l.event === 'http' && l.status === 429);
    expect(limited).toMatchObject({ route: '/join', reason: 'rate_limited' });
  });

  it('answers a malformed URL with 400 (not a 500 server error) and keeps the route unmatched', async () => {
    const logs = captureLogs();
    const relay = await started();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: relay.relay.port, path: '//', method: 'GET' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
    expect(logs.events().find((l) => l.event === 'http' && l.status === 400)).toMatchObject({ route: 'unmatched', reason: 'invalid_url' });
    expect(logs.events().some((l) => l.event === 'http.error')).toBe(false);
  });
});

describe('unexpected error logging', () => {
  const TOKEN = 'Xk3v9Qm2LpR7sT1uW4yZ8aB5cD6eF0gH2iJ3kL4mN5o'; // 43자 base64url(토큰 모양)
  const INVITE = 'K7M2Q9XA';

  /** store가 던지는 핸들러를 직접 띄워(실제 HTTP) 오류 로그를 관찰한다. */
  async function callThrowing(store: Record<string, unknown>, path: string, init: { method?: string; token?: string; body?: string } = {}) {
    const events: { event: string; fields: LogFields; level?: LogLevel }[] = [];
    const handler = createHttpHandler({
      store: store as never,
      log: (event, fields, level) => events.push({ event, fields: fields ?? {}, level }),
      now: Date.now,
      limits: DEFAULT_LIMITS,
      clientIp: createClientIpResolver(0, () => {}),
      isOnline: () => false,
      disconnectParticipant: () => {},
      disconnectRoom: () => {},
    });
    httpServer = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method ?? 'GET',
      headers: init.token ? { Authorization: `Bearer ${init.token}` } : {},
      body: init.body,
    });
    await res.text();
    return { status: res.status, events };
  }

  it('records the error name and a bounded, control-free message on http.error', async () => {
    const boom = new TypeError(`db exploded\n\u0007while reading ${'x'.repeat(400)}`);
    const { status, events } = await callThrowing({ authenticate: () => { throw boom; } }, '/rooms/abc/participants', { token: TOKEN });
    expect(status).toBe(500);
    const err = events.find((e) => e.event === 'http.error');
    expect(err?.level).toBe('error');
    expect(err?.fields.route).toBe('/rooms/:roomId/participants');
    expect(err?.fields.errorName).toBe('TypeError');
    const message = formatMessage(err?.fields);
    expect(message.startsWith('db exploded')).toBe(true);
    expect(message.length).toBeLessThanOrEqual(200);
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(message)).toBe(false);
    const http = events.find((e) => e.event === 'http');
    expect(http?.fields).toMatchObject({ route: '/rooms/:roomId/participants', status: 500, reason: 'internal' });
    expect(http?.level).toBe('error');
  });

  it('never lets a token or invite code inside an error message reach the log line', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(String(a[0])));
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(String(a[0])));
    const store = {
      authenticate: (token: string) => {
        throw new Error(`lookup failed for token ${token} (invite ${INVITE}, again ${INVITE.toLowerCase()}9 and K7M2-Q9XA)`);
      },
    };
    const { events } = await callThrowing(store, '/rooms/abc/participants', { token: TOKEN });
    const err = events.find((e) => e.event === 'http.error');
    expect(err).toBeDefined();
    // 실제 로그 줄로 직렬화해 본다 — 화이트리스트·다듬기를 모두 지난 최종 출력이 기준이다.
    const line = formatLogLine(err!.event, err!.fields, 'error');
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(INVITE);
    expect(line).not.toContain('K7M2-Q9XA');
    expect(line).toContain('[redacted]');
    expect(line).toContain('lookup failed');
  });

  it('drops the message of a SyntaxError (JSON parser messages can quote the input) and keeps only its name', () => {
    let syntax: unknown;
    try {
      JSON.parse('Alice-secret-name is here'); // V8: Unexpected token 'A', "Alice-secr"... is not valid JSON
    } catch (error) {
      syntax = error;
    }
    expect((syntax as Error).message).toContain('Alice'); // 전제: 파서 메시지에는 입력 조각이 실제로 들어 있다
    expect(describeError(syntax)).toEqual({ errorName: 'SyntaxError' });
    expect(describeError('not an error')).toEqual({ errorName: 'unknown' });
    expect(describeError(new Error('bad\u0000\u001b[31m'))).toEqual({ errorName: 'Error', message: 'bad [31m' });
  });

  it('bad request bodies never appear in logs (invalid_json maps to a 400 code, not a message)', async () => {
    const logs = captureLogs();
    const relay = await started();
    const res = await relay.api.call('POST', '/join', { raw: '{"displayName":"Mallory-body-fragment","code":' });
    expect(res.status).toBe(400);
    expect(logs.raw()).not.toContain('Mallory-body-fragment');
    expect(logs.events().find((l) => l.event === 'http' && l.status === 400)).toMatchObject({ route: '/join', reason: 'invalid_json' });
  });

  it('sanitizeMessage keeps normal diagnostics readable', () => {
    expect(sanitizeMessage('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: participants.token_hash')).toContain('SQLITE_CONSTRAINT_UNIQUE');
    expect(sanitizeMessage('Cannot read properties of undefined (reading roomId)')).toBe('Cannot read properties of undefined (reading roomId)');
    expect(sanitizeMessage('')).toBeUndefined();
    expect(sanitizeMessage(42)).toBeUndefined();
  });
});

function formatMessage(fields: LogFields | undefined): string {
  return (JSON.parse(formatLogLine('x', fields ?? {}, 'error')) as { message?: string }).message ?? '';
}

describe('logger levels and whitelist', () => {
  it('only emits whitelisted fields even if a caller passes extras', () => {
    const line = JSON.parse(
      formatLogLine('x', { roomId: 'r', token: 'SECRET-TOKEN', displayName: 'Alice', text: 'note body' } as unknown as LogFields, 'warn'),
    ) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(['event', 'level', 'roomId', 't']);
    expect(line.level).toBe('warn');
  });

  it('parses LOG_LEVEL strictly', () => {
    expect(parseLogLevel(undefined)).toBe('info');
    expect(parseLogLevel(' Debug ')).toBe('debug');
    expect(() => parseLogLevel('verbose')).toThrow(/LOG_LEVEL/);
  });
});

describe('websocket close diagnostics', () => {
  it('logs revoked closes with code, reason, room and participant (info) and the closing point', async () => {
    const logs = captureLogs();
    const relay = await started();
    const room = await newRoom(relay.api, 'Steve');
    const guest = await addGuest(relay.api, room, 'Alice');
    const name = `${room.roomId}/note:n1`;
    const client = relay.connect(name, guest.token);
    await client.synced();

    await relay.api.call('DELETE', `/rooms/${room.roomId}/participants/${guest.participantId}`, { token: room.owner.token });
    await until(() => logs.events().some((l) => l.event === 'ws.closed' && l.code === 4403), 'ws.closed 4403 logged');

    expect(logs.find('ws.closing')).toMatchObject({ roomId: room.roomId, participantId: guest.participantId, code: 4403, reason: 'revoked' });
    expect(logs.find('ws.closed', (l) => l.code === 4403)).toMatchObject({
      level: 'info',
      roomId: room.roomId,
      participantId: guest.participantId,
      code: 4403,
      reason: 'revoked',
    });
  });

  it('logs room_deleted closes for every live socket of the room', async () => {
    const logs = captureLogs();
    const relay = await started();
    const room = await newRoom(relay.api);
    const client = relay.connect(`${room.roomId}/manifest`, room.owner.token);
    await client.synced();
    await relay.api.call('DELETE', `/rooms/${room.roomId}`, { token: room.owner.token });
    await until(() => logs.events().some((l) => l.event === 'ws.closed' && l.reason === 'room_deleted'), 'room_deleted close logged');
    expect(logs.find('ws.closing', (l) => l.reason === 'room_deleted')).toMatchObject({ roomId: room.roomId, code: 4403 });
  });

  it('keeps normal closes (1000/1001/1005) out of the default log and shows them only at LOG_LEVEL=debug', async () => {
    const quiet = captureLogs();
    const relay = await started();
    const room = await newRoom(relay.api);
    const client = relay.connect(`${room.roomId}/manifest`, room.owner.token);
    await client.synced();
    client.destroy();
    await until(() => relay.relay.stats().connections === 0, 'connection gone');
    await new Promise((r) => setTimeout(r, 100));
    expect(quiet.events().some((l) => l.event === 'ws.closed')).toBe(false);
    expect(quiet.events().some((l) => l.event === 'ws.disconnected')).toBe(false);
    await relay.stop();
    h = undefined;
    vi.restoreAllMocks();

    const loud = captureLogs();
    const debug = await started({ logLevel: 'debug' });
    const room2 = await newRoom(debug.api);
    const client2 = debug.connect(`${room2.roomId}/note:d1`, room2.owner.token);
    await client2.synced();
    client2.destroy();
    await until(() => loud.events().some((l) => l.event === 'ws.closed'), 'debug ws.closed logged');
    const closed = loud.find('ws.closed');
    expect(closed?.level).toBe('debug');
    expect([1000, 1001, 1005]).toContain(closed?.code);
    expect(loud.find('ws.disconnected')).toMatchObject({ level: 'debug', roomId: room2.roomId, docKind: 'note' });
  });

  it('records 4408 for an idle socket, and the 1009 of an oversized pre-auth frame (from the ws error) as a warning', async () => {
    const logs = captureLogs();
    const relay = await started({ limits: { authTimeoutMs: 200, preAuthMaxPayloadBytes: 4 * 1024 } });
    const idle = openRaw(relay.relay.wsUrl);
    expect(await idle.opened).toBe(true);
    expect(await idle.closed).toBe(4408);
    const big = openRaw(relay.relay.wsUrl);
    expect(await big.opened).toBe(true);
    big.ws.send(new Uint8Array(64 * 1024));
    expect(await big.closed).toBe(1009);
    await until(
      () => logs.events().some((l) => l.event === 'ws.error' && l.code === 1009) && logs.events().some((l) => l.event === 'ws.closed' && l.code === 4408),
      'both closes logged',
    );
    expect(logs.find('ws.denied', (l) => l.reason === 'auth_timeout')).toMatchObject({ code: 4408 });
    expect(logs.find('ws.closed', (l) => l.code === 4408)).toMatchObject({ level: 'info', reason: 'auth_timeout' });
    // 프레임 상한 초과는 ws가 1009로 닫지만, 서버측 close 이벤트는 1006으로만 온다 — 1009는 수신기 오류 이벤트에서 남긴다.
    expect(logs.find('ws.error', (l) => l.code === 1009)).toMatchObject({ level: 'warn', reason: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' });
  });

  it('adds room, kind and close code to document evictions (4413)', async () => {
    const logs = captureLogs();
    const relay = await started({ limits: { maxDocumentBytes: 200 * 1024 } });
    const room = await newRoom(relay.api);
    const client = relay.connect(`${room.roomId}/note:n1`, room.owner.token);
    await client.synced();
    client.doc.getText('body').insert(0, 'x'.repeat(300 * 1024));
    await until(() => logs.events().some((l) => l.event === 'ws.evicted'), 'eviction logged', 5000);
    expect(logs.find('ws.evicted')).toMatchObject({ roomId: room.roomId, docKind: 'note', reason: 'doc_too_large', code: 4413 });
  });

  it('logs 4429 codes at the deny points (too many connections)', async () => {
    const logs = captureLogs();
    const relay = await started({ limits: { maxSocketsPerParticipant: 1 } });
    const room = await newRoom(relay.api);
    const a = relay.connect(`${room.roomId}/note:a`, room.owner.token);
    await a.synced();
    relay.connect(`${room.roomId}/note:b`, room.owner.token);
    await until(() => logs.events().some((l) => l.event === 'ws.denied' && l.reason === 'too_many_connections'), 'deny logged');
    expect(logs.find('ws.denied', (l) => l.reason === 'too_many_connections')).toMatchObject({ code: 4429, roomId: room.roomId });
  });

  it('never copies a client-chosen close reason (or any token) into the log', async () => {
    const logs = captureLogs();
    const relay = await started();
    const socket = openRaw(relay.relay.wsUrl);
    expect(await socket.opened).toBe(true);
    socket.ws.close(4000, 'client-secret-reason-token-abc123');
    await socket.closed;
    await until(() => logs.events().some((l) => l.event === 'ws.closed' && l.code === 4000), 'client close logged');
    expect(logs.find('ws.closed', (l) => l.code === 4000)?.reason).toBe('other');
    expect(logs.raw()).not.toContain('client-secret-reason');
  });
});

describe('shutdown', () => {
  it('stops emitting connection logs once close() begins (only relay.closed remains) so a closed relay never leaks lines into later output', async () => {
    const logs = captureLogs();
    const relay = await started({ logLevel: 'debug' });
    const room = await newRoom(relay.api);
    const a = relay.connect(`${room.roomId}/note:a`, room.owner.token);
    const b = relay.connect(`${room.roomId}/note:b`, room.owner.token);
    await Promise.all([a.synced(), b.synced()]);
    await relay.stop();
    h = undefined;
    await new Promise((r) => setTimeout(r, 200)); // 소켓 close 이벤트는 종료가 끝난 뒤에도 늦게 도착한다
    const events = logs.events().map((l) => l.event);
    expect(events.at(-1)).toBe('relay.closed');
    expect(events.filter((e) => e === 'relay.closed')).toHaveLength(1);
    const closedAt = events.lastIndexOf('relay.closed');
    expect(events.slice(closedAt + 1)).toEqual([]);
    // 종료 시작 뒤의 소켓 정리 때문에 생기는 ws.closed/ws.disconnected는 남기지 않는다.
    expect(events.filter((e) => e === 'ws.closed' || e === 'ws.disconnected')).toEqual([]);
  });
});

describe('process-level errors', () => {
  function fakeProcess() {
    const emitter = new EventEmitter();
    const written: string[] = [];
    const exits: number[] = [];
    installCrashHandlers({
      proc: emitter as never,
      write: (line, done) => {
        written.push(line);
        done();
      },
      exit: (code) => void exits.push(code),
    });
    return { emitter, written, exits };
  }

  it('logs uncaughtException as relay.crash (name + bounded message) and exits with code 1', () => {
    const p = fakeProcess();
    p.emitter.emit('uncaughtException', new RangeError(`bad value ${'y'.repeat(500)}`));
    expect(p.exits).toContain(1);
    expect(p.written).toHaveLength(1);
    const line = JSON.parse(p.written[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'relay.crash', level: 'error', reason: 'uncaughtException', errorName: 'RangeError' });
    expect(String(line.message).startsWith('bad value')).toBe(true);
    expect(String(line.message).length).toBeLessThanOrEqual(200);
  });

  it('treats unhandledRejection the same way (log + exit 1), even for non-Error reasons, and logs only once', () => {
    const p = fakeProcess();
    p.emitter.emit('unhandledRejection', 'a string reason with Alice');
    p.emitter.emit('uncaughtException', new Error('second'));
    expect(p.exits).toEqual([1]);
    expect(p.written).toHaveLength(1);
    const line = JSON.parse(p.written[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'relay.crash', reason: 'unhandledRejection', errorName: 'unknown' });
    expect(p.written[0]).not.toContain('Alice'); // 오류가 아닌 reason의 내용은 남기지 않는다
  });

  it('a real process that throws exits with code 1 and leaves one relay.crash JSON line on stderr', () => {
    const fixture = fileURLToPath(new URL('./fixtures/crash-child.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', fixture, 'throw'], { encoding: 'utf8', timeout: 20_000 });
    expect(result.status).toBe(1);
    const crash = result.stderr.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(crash).toHaveLength(1);
    expect(crash[0]).toMatchObject({ event: 'relay.crash', reason: 'uncaughtException', errorName: 'Error' });
    expect(String(crash[0]!.message)).toContain('child-boom');

    const rejected = spawnSync(process.execPath, ['--import', 'tsx', fixture, 'reject'], { encoding: 'utf8', timeout: 20_000 });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('"reason":"unhandledRejection"');
  });
});
