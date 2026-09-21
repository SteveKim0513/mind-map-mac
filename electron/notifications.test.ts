import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOTIFICATIONS_FILE, MAX_NOTIFICATIONS_BYTES, createNotificationHandlers } from './notifications';

const ROOM = 'room-abcdef12';
const item = (id: string, createdAt: number, read = false) => ({
  id,
  type: 'comment',
  roomId: ROOM,
  folderName: '기획',
  anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1' },
  targetLabel: '계획 · 루트',
  authorName: '민수',
  preview: '코멘트',
  createdAt,
  read,
});

let dir: string;
const handlers = () =>
  createNotificationHandlers({
    userDataDir: () => dir,
    atomicWrite: async (target, data) => {
      await fs.writeFile(target, data, 'utf-8');
    },
  });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-noti-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('notifications IPC handlers', () => {
  it('load returns an empty state when nothing was saved', async () => {
    // 파일이 아직 없다 — 기준선을 잃은 것과 같은 상태라 복구 표시가 붙는다(렌더러가 과거 코멘트를 알림으로 만들지 않게)
    expect(await handlers().load()).toEqual({ version: 1, items: [], baselines: {}, recovered: true });
  });

  it('round-trips a saved state (survives a "restart" = fresh handlers on the same userData)', async () => {
    const saved = await handlers().save({ version: 1, items: [item('a', 10), item('b', 20, true)], baselines: { [ROOM]: 55 } });
    expect(saved).toBe(true);
    const loaded = await handlers().load();
    expect(loaded.items.map((i) => [i.id, i.read])).toEqual([
      ['b', true],
      ['a', false],
    ]);
    expect(loaded.baselines[ROOM]).toBe(55);
    expect('recovered' in loaded).toBe(false); // 정상 파일에는 복구 표시가 없다
    // stored inside userData only, with the agreed file name
    expect((await fs.readdir(dir)).includes(NOTIFICATIONS_FILE)).toBe(true);
  });

  it('save treats the renderer input as untrusted: junk is refused, unknown fields and bad items are dropped', async () => {
    const h = handlers();
    expect(await h.save(null)).toBe(false);
    expect(await h.save('x')).toBe(false);
    expect(await h.save({ version: 2, items: [] })).toBe(false);
    expect(await h.save({ version: 1, items: [item('ok', 1), { id: '../evil', type: 'comment' }], baselines: { bad: 1 }, secret: 'token' })).toBe(true);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, NOTIFICATIONS_FILE), 'utf-8'));
    expect(Object.keys(onDisk).sort()).toEqual(['baselines', 'items', 'version']);
    expect(onDisk.items.map((i: { id: string }) => i.id)).toEqual(['ok']);
    expect(onDisk.baselines).toEqual({});
  });

  it('a corrupt or oversize file loads as empty instead of throwing', async () => {
    const RECOVERED = { version: 1, items: [], baselines: {}, recovered: true };
    await fs.writeFile(path.join(dir, NOTIFICATIONS_FILE), '{not json', 'utf-8');
    expect(await handlers().load()).toEqual(RECOVERED);
    await fs.writeFile(path.join(dir, NOTIFICATIONS_FILE), ' '.repeat(MAX_NOTIFICATIONS_BYTES + 1), 'utf-8');
    expect(await handlers().load()).toEqual(RECOVERED);
  });

  it('an empty file, a wrong-version file, or non-object JSON is flagged recovered (baselines are lost, so old comments must not become notifications)', async () => {
    const RECOVERED = { version: 1, items: [], baselines: {}, recovered: true };
    for (const body of ['', '   ', '[]', 'null', '{"version":2,"items":[],"baselines":{}}', '{"items":[]}']) {
      await fs.writeFile(path.join(dir, NOTIFICATIONS_FILE), body, 'utf-8');
      expect(await handlers().load(), JSON.stringify(body)).toEqual(RECOVERED);
    }
    // 정상이지만 비어 있는 파일은 복구가 아니다(기준선이 없는 게 정상 상태)
    await fs.writeFile(path.join(dir, NOTIFICATIONS_FILE), '{"version":1,"items":[],"baselines":{}}', 'utf-8');
    expect(await handlers().load()).toEqual({ version: 1, items: [], baselines: {} });
  });

  it('serializes overlapping saves so the last call wins', async () => {
    const h = handlers();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => h.save({ version: 1, items: [item(`c${i}`, i + 1)], baselines: {} })),
    );
    expect(results.every(Boolean)).toBe(true);
    expect((await h.load()).items.map((i) => i.id)).toEqual(['c9']);
  });

  it('reports failure (false) when the write fails', async () => {
    const h = createNotificationHandlers({
      userDataDir: () => dir,
      atomicWrite: async () => {
        throw new Error('disk full');
      },
    });
    expect(await h.save({ version: 1, items: [], baselines: {} })).toBe(false);
  });
});

describe('notifications diagnostics (log lines carry codes only)', () => {
  const logged = () => {
    const lines: string[] = [];
    const h = createNotificationHandlers({
      userDataDir: () => dir,
      atomicWrite: async (target, data) => {
        await fs.writeFile(target, data, 'utf-8');
      },
      log: (level, message) => lines.push(`${level}: ${message}`),
    });
    return { h, lines };
  };

  it('a first run (no file) is normal and stays silent', async () => {
    const { h, lines } = logged();
    expect((await h.load()).recovered).toBe(true);
    expect(lines).toEqual([]);
  });

  it('logs a warn with the recovery reason when the stored state is unusable — never the file content', async () => {
    const SECRET = 'SECRET-COMMENT-BODY-do-not-log';
    const cases: [string, string][] = [
      ['', 'empty'],
      [`{"version":1,"items":[{"preview":"${SECRET}"`, 'corrupt'], // 잘린 JSON — 파서 오류 메시지에 조각이 실릴 수 있다
      [`{"version":2,"note":"${SECRET}"}`, 'bad_version'],
    ];
    for (const [body, reason] of cases) {
      const { h, lines } = logged();
      await fs.writeFile(path.join(dir, NOTIFICATIONS_FILE), body, 'utf-8');
      expect((await h.load()).recovered).toBe(true);
      expect(lines).toEqual([`warn: notifications:load recovered (${reason}) — baselines reset`]);
      expect(lines.join('\n')).not.toContain(SECRET);
    }
  });

  it('logs when an oversized state file is refused', async () => {
    const { h, lines } = logged();
    await fs.writeFile(path.join(dir, NOTIFICATIONS_FILE), 'x'.repeat(MAX_NOTIFICATIONS_BYTES + 1), 'utf-8');
    await h.load();
    expect(lines).toEqual(['warn: notifications:load recovered (oversize) — baselines reset']);
  });

  it('logs invalid save payloads and write failures as warnings (error code only)', async () => {
    const { h, lines } = logged();
    expect(await h.save({ version: 9 })).toBe(false);
    expect(lines).toEqual(['warn: notifications:save rejected (invalid payload)']);

    const failing: string[] = [];
    const broken = createNotificationHandlers({
      userDataDir: () => dir,
      atomicWrite: async () => {
        throw Object.assign(new Error(`ENOSPC writing ${path.join(dir, 'private-name.json')}`), { code: 'ENOSPC' });
      },
      log: (level, message) => failing.push(`${level}: ${message}`),
    });
    expect(await broken.save({ version: 1, items: [], baselines: {} })).toBe(false);
    expect(failing).toEqual(['warn: notifications:save failed (ENOSPC)']);
    expect(failing.join('\n')).not.toContain('private-name');
  });
});
