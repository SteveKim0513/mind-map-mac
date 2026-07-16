import { describe, it, expect } from 'vitest';
import { FileScanCache } from './scanCache';

// Pure mechanics only — the loader is a counting fake, so no filesystem, no
// window.api, no timers (no sleep). Covers the four IF-10 scenarios:
// hit, miss, mtime-invalidation, prune-on-delete.

/** A loader that records how many times it ran per path and returns a tagged value. */
function countingLoader() {
  const calls: string[] = [];
  const loader = async (path: string) => {
    calls.push(path);
    return `${path}@${calls.filter((p) => p === path).length}`; // value encodes the load count
  };
  return { loader, calls };
}

describe('FileScanCache', () => {
  it('miss then hit: same (path, mtime) loads once, reuses after', async () => {
    const cache = new FileScanCache<string>();
    const { loader, calls } = countingLoader();

    const first = await cache.load('a.mind', 100, loader);
    const second = await cache.load('a.mind', 100, loader);

    expect(first).toBe('a.mind@1');
    expect(second).toBe('a.mind@1'); // identical cached value
    expect(calls).toEqual(['a.mind']); // loader ran exactly once
    expect(cache.size).toBe(1);
    expect(cache.has('a.mind')).toBe(true);
  });

  it('miss: a new path always loads', async () => {
    const cache = new FileScanCache<string>();
    const { loader, calls } = countingLoader();

    await cache.load('a.mind', 100, loader);
    await cache.load('b.mind', 100, loader);

    expect(calls).toEqual(['a.mind', 'b.mind']);
    expect(cache.size).toBe(2);
  });

  it('invalidation: a changed mtime re-loads and replaces the cached value', async () => {
    const cache = new FileScanCache<string>();
    const { loader, calls } = countingLoader();

    const before = await cache.load('a.mind', 100, loader);
    const after = await cache.load('a.mind', 200, loader); // file edited → mtime moved
    const again = await cache.load('a.mind', 200, loader); // now cached at new mtime

    expect(before).toBe('a.mind@1');
    expect(after).toBe('a.mind@2'); // fresh parse, not the stale @1
    expect(again).toBe('a.mind@2'); // reused
    expect(calls).toEqual(['a.mind', 'a.mind']); // loaded twice total, not three times
    expect(cache.size).toBe(1);
  });

  it('does not serve a stale value after mtime changes (correctness invariant)', async () => {
    const cache = new FileScanCache<string>();
    let disk = 'v1';
    const loader = async () => disk;

    const a = await cache.load('note.md', 10, loader);
    disk = 'v2'; // content changed on disk...
    const b = await cache.load('note.md', 10, loader); // ...but mtime unchanged → cached v1
    disk = 'v3';
    const c = await cache.load('note.md', 11, loader); // mtime moved → re-read v3

    expect(a).toBe('v1');
    expect(b).toBe('v1'); // mtime is the freshness key; unchanged mtime keeps the cache
    expect(c).toBe('v3');
  });

  it('prune: drops entries for deleted paths, keeps the rest', async () => {
    const cache = new FileScanCache<string>();
    const { loader } = countingLoader();

    await cache.load('a.mind', 1, loader);
    await cache.load('b.mind', 1, loader);
    await cache.load('c.mind', 1, loader);
    expect(cache.size).toBe(3);

    // b.mind was deleted from the workspace; a and c remain.
    const removed = cache.prune(['a.mind', 'c.mind']);

    expect(removed).toBe(1);
    expect(cache.size).toBe(2);
    expect(cache.has('a.mind')).toBe(true);
    expect(cache.has('b.mind')).toBe(false);
    expect(cache.has('c.mind')).toBe(true);
  });

  it('prune: a pruned entry re-loads fresh on next access (no resurrection)', async () => {
    const cache = new FileScanCache<string>();
    const { loader, calls } = countingLoader();

    await cache.load('a.mind', 1, loader);
    cache.prune([]); // everything gone
    expect(cache.size).toBe(0);

    await cache.load('a.mind', 1, loader); // must load again — cache no longer holds it

    expect(calls).toEqual(['a.mind', 'a.mind']);
  });

  it('prune accepts a Set as well as an array', async () => {
    const cache = new FileScanCache<string>();
    const { loader } = countingLoader();
    await cache.load('a.mind', 1, loader);
    await cache.load('b.mind', 1, loader);

    const removed = cache.prune(new Set(['a.mind']));

    expect(removed).toBe(1);
    expect(cache.has('a.mind')).toBe(true);
    expect(cache.has('b.mind')).toBe(false);
  });

  it('unknown mtime (NaN) always reloads and is never cached', async () => {
    const cache = new FileScanCache<string>();
    const { loader, calls } = countingLoader();

    await cache.load('a.mind', Number.NaN, loader);
    await cache.load('a.mind', Number.NaN, loader);

    expect(calls).toEqual(['a.mind', 'a.mind']); // no caching when freshness is unprovable
    expect(cache.size).toBe(0);
    expect(cache.has('a.mind')).toBe(false);
  });
});
