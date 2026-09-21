import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  SIDECAR_ORIGIN,
  attachSidecarPersistence,
  encodeSidecar,
  loadSidecar,
  readSidecar,
  writeSidecar,
} from './sidecar';
import { makeFakeShareApi, noteSidecarId } from './testFakes';

describe('loadSidecar / encodeSidecar', () => {
  it('상태 왕복: 다른 Y.Doc에 적용하면 같은 내용', () => {
    const a = new Y.Doc();
    a.getMap('m').set('k', 'v');
    a.getText('t').insert(0, '안녕');
    const b = new Y.Doc();
    expect(loadSidecar(b, encodeSidecar(a))).toBe(true);
    expect(b.getMap('m').get('k')).toBe('v');
    expect(b.getText('t').toString()).toBe('안녕');
  });

  it('null·빈·손상 바이트는 false이고 문서를 건드리지 않는다', () => {
    const d = new Y.Doc();
    d.getMap('m').set('keep', 1);
    expect(loadSidecar(d, null)).toBe(false);
    expect(loadSidecar(d, undefined)).toBe(false);
    expect(loadSidecar(d, new Uint8Array())).toBe(false);
    expect(loadSidecar(d, new Uint8Array([255, 255, 255, 1, 2, 3]))).toBe(false);
    expect(d.getMap('m').get('keep')).toBe(1);
  });

  it('로드로 생긴 update의 origin은 SIDECAR_ORIGIN', () => {
    const a = new Y.Doc();
    a.getMap('m').set('k', 1);
    const b = new Y.Doc();
    const origins: unknown[] = [];
    b.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    loadSidecar(b, encodeSidecar(a));
    expect(origins).toEqual([SIDECAR_ORIGIN]);
  });
});

describe('readSidecar / writeSidecar (docKey → 사이드카 id 매핑)', () => {
  it('docKey를 id로 바꿔 IPC를 호출', async () => {
    const { api, calls } = makeFakeShareApi();
    expect(await writeSidecar(api, '/ws/f', 'note:n1', new Uint8Array([1, 2]))).toBe(true);
    expect(await writeSidecar(api, '/ws/f', 'manifest', new Uint8Array([3]))).toBe(true);
    expect(Array.from((await readSidecar(api, '/ws/f', 'note:n1'))!)).toEqual([1, 2]);
    expect(calls).toEqual([`write:${noteSidecarId('n1')}`, 'write:_manifest', `read:${noteSidecarId('n1')}`]);
  });
  it('규약 밖 docKey는 IPC를 호출하지 않는다', async () => {
    const { api, calls } = makeFakeShareApi();
    expect(await writeSidecar(api, '/ws/f', 'note:../x', new Uint8Array([1]))).toBe(false);
    expect(await readSidecar(api, '/ws/f', 'bogus')).toBeNull();
    expect(calls).toEqual([]);
  });
  it('IPC 실패·예외는 false/null로 흡수', async () => {
    const { api } = makeFakeShareApi({
      sidecarWrite: async () => ({ ok: false as const, error: 'io' as const }),
      sidecarRead: async () => {
        throw new Error('ipc down');
      },
    });
    expect(await writeSidecar(api, '/ws/f', 'comments', new Uint8Array([1]))).toBe(false);
    expect(await readSidecar(api, '/ws/f', 'comments')).toBeNull();
  });
});

describe('attachSidecarPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('변경을 디바운스해 마지막 상태만 저장한다', async () => {
    const { api, sidecars, calls } = makeFakeShareApi();
    const doc = new Y.Doc();
    attachSidecarPersistence(doc, { api, folderPath: '/ws/f', docKey: 'manifest', debounceMs: 500 });
    doc.getMap('m').set('a', 1);
    await vi.advanceTimersByTimeAsync(300);
    doc.getMap('m').set('b', 2);
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toEqual([]); // 아직 저장 전
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toEqual(['write:_manifest']);
    const restored = new Y.Doc();
    loadSidecar(restored, sidecars.get('/ws/f|_manifest')!);
    expect(restored.getMap('m').toJSON()).toEqual({ a: 1, b: 2 });
  });

  it('원격 update도 저장하지만, 사이드카 로드로 생긴 update는 저장하지 않는다', async () => {
    const { api, calls } = makeFakeShareApi();
    const src = new Y.Doc();
    src.getMap('m').set('x', 1);
    const doc = new Y.Doc();
    attachSidecarPersistence(doc, { api, folderPath: '/ws/f', docKey: 'comments', debounceMs: 100 });
    loadSidecar(doc, encodeSidecar(src));
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([]);
    Y.applyUpdate(doc, encodeSidecar(src), 'remote-provider');
    doc.getMap('m').set('y', 2); // 로컬 변경
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual(['write:_comments']);
  });

  it('flush는 대기 중인 저장을 즉시 수행하고, 변경이 없으면 아무것도 안 한다', async () => {
    const { api, calls } = makeFakeShareApi();
    const doc = new Y.Doc();
    const p = attachSidecarPersistence(doc, { api, folderPath: '/ws/f', docKey: 'note:n1', debounceMs: 10_000 });
    await p.flush();
    expect(calls).toEqual([]);
    doc.getText('t').insert(0, 'hi');
    await p.flush();
    expect(calls).toEqual([`write:${noteSidecarId('n1')}`]);
    await p.flush();
    expect(calls).toEqual([`write:${noteSidecarId('n1')}`]);
  });

  it('stop은 마지막으로 flush한 뒤 관찰을 멈춘다', async () => {
    const { api, calls } = makeFakeShareApi();
    const doc = new Y.Doc();
    const p = attachSidecarPersistence(doc, { api, folderPath: '/ws/f', docKey: 'note:n1', debounceMs: 10_000 });
    doc.getText('t').insert(0, 'hi');
    await p.stop();
    expect(calls).toEqual([`write:${noteSidecarId('n1')}`]);
    doc.getText('t').insert(0, 'more');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toEqual([`write:${noteSidecarId('n1')}`]);
  });

  it('저장 실패는 onError로 알리고 다음 flush에서 재시도한다', async () => {
    let ok = false;
    const { api, calls } = makeFakeShareApi({
      sidecarWrite: async () => {
        calls.push('try');
        return ok ? { ok: true as const } : { ok: false as const, error: 'io' as const };
      },
    });
    const errors: string[] = [];
    const doc = new Y.Doc();
    const p = attachSidecarPersistence(doc, {
      api,
      folderPath: '/ws/f',
      docKey: 'manifest',
      debounceMs: 10,
      onError: (k) => errors.push(k),
    });
    doc.getMap('m').set('a', 1);
    await vi.advanceTimersByTimeAsync(50);
    expect(errors).toEqual(['manifest']);
    ok = true;
    await p.flush();
    expect(calls.filter((c) => c === 'try')).toHaveLength(2);
    await p.flush();
    expect(calls.filter((c) => c === 'try')).toHaveLength(2); // 성공 후에는 더 저장 안 함
  });

  it('저장은 직렬화된다 — 느린 이전 저장이 끝난 뒤 다음 저장이 시작', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const { api } = makeFakeShareApi({
      sidecarWrite: async () => {
        const id = ++n;
        order.push(`start${id}`);
        if (id === 1) await gate;
        order.push(`end${id}`);
        return { ok: true as const };
      },
    });
    const doc = new Y.Doc();
    const p = attachSidecarPersistence(doc, { api, folderPath: '/ws/f', docKey: 'manifest', debounceMs: 10 });
    doc.getMap('m').set('a', 1);
    await vi.advanceTimersByTimeAsync(20); // 첫 저장 시작(게이트에서 대기)
    doc.getMap('m').set('b', 2);
    const second = p.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['start1']); // 두 번째는 아직 시작 못 함
    release();
    await second;
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
  });
});
