// IF-10 — mtime-keyed incremental scan cache.
//
// Both the global search (⌘⇧F) and the calendar re-scan the *whole* workspace
// each time they open: every .mind is deserialized and every .md is parsed.
// On a large workspace that re-parse dominates the open latency even though
// almost nothing changed. This module caches each file's parse result keyed by
// (path, mtimeMs). A scan reuses the cached value when mtime is unchanged,
// re-parses only files whose mtime moved, and prunes entries for files that no
// longer exist — so the *result* is identical, only the work shrinks.
//
// The generic FileScanCache holds no I/O (the loader is injected), so its
// mechanics — hit / miss / mtime-invalidation / prune — are unit-tested in
// scanCache.test.ts without touching the filesystem. The loadMindDoc/loadNote
// helpers are the impure edge that binds it to window.api + the io/ parsers.

import { deserialize } from './formats';
import { parseNote } from './noteFormat';
import type { MindMapDoc, NoteDoc } from '../types';

/** A workspace file plus the mtime the workspace tree reported for it. */
export interface FileRef {
  path: string;
  mtimeMs?: number;
}

/**
 * A parse cache keyed by file path, invalidated by mtime.
 *
 * - `load` returns the cached value when the stored mtime equals the requested
 *   mtime; otherwise it invokes `loader`, caches, and returns the fresh value.
 * - A non-finite mtime (unknown/missing) is treated as *never provably fresh*:
 *   it always reloads and is never cached, so a stale parse can never be served.
 * - `prune` drops entries whose path is absent from the live set (deleted or
 *   renamed files), so the cache cannot grow without bound or resurrect a file.
 */
export class FileScanCache<T> {
  private entries = new Map<string, { mtimeMs: number; value: T }>();

  /** Cached value for `path`, re-loading on a cache miss or an mtime change. */
  async load(path: string, mtimeMs: number, loader: (path: string) => Promise<T>): Promise<T> {
    const fresh = Number.isFinite(mtimeMs);
    if (fresh) {
      const hit = this.entries.get(path);
      if (hit && hit.mtimeMs === mtimeMs) return hit.value;
    }
    const value = await loader(path);
    if (fresh) this.entries.set(path, { mtimeMs, value });
    else this.entries.delete(path); // unknown mtime → don't hold a value we can't trust
    return value;
  }

  /** Remove entries whose path is not in `livePaths`. Returns the count removed. */
  prune(livePaths: Iterable<string>): number {
    const live = livePaths instanceof Set ? livePaths : new Set(livePaths);
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (!live.has(key)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

// ── Shared workspace caches ──────────────────────────────────────────────────
// One instance each, module-scoped, so global search and the calendar warm the
// *same* cache: opening one primes the other. .mind docs are shared by both;
// .md notes are only read by search.

const nameOf = (p: string): string => (p.split('/').pop() ?? p).replace(/\.(mind|md)$/, '');

const mindCache = new FileScanCache<MindMapDoc | null>();
const noteCache = new FileScanCache<NoteDoc | null>();

/**
 * Parsed .mind document for `path`, cached by mtime. Returns null when the file
 * is unreadable or corrupt — callers skip it, exactly as the previous inline
 * try/catch did. Shared by global search and the calendar agenda scan.
 */
export function loadMindDoc(path: string, mtimeMs: number | undefined): Promise<MindMapDoc | null> {
  return mindCache.load(path, mtimeMs ?? Number.NaN, async (p) => {
    try {
      return deserialize(await window.api.readFile(p));
    } catch {
      return null;
    }
  });
}

/**
 * Parsed note for `path`, cached by mtime. Returns null when unreadable/corrupt.
 * Only global search reads note bodies (the workspace noteIndex holds frontmatter
 * only, not the body needed for full-text search).
 */
export function loadNote(path: string, mtimeMs: number | undefined): Promise<NoteDoc | null> {
  return noteCache.load(path, mtimeMs ?? Number.NaN, async (p) => {
    try {
      return parseNote(await window.api.readFile(p), nameOf(p));
    } catch {
      return null;
    }
  });
}

/** Drop cached .mind entries for files no longer in the workspace. */
export function pruneMindCache(livePaths: Iterable<string>): number {
  return mindCache.prune(livePaths);
}

/** Drop cached .md entries for files no longer in the workspace. */
export function pruneNoteCache(livePaths: Iterable<string>): number {
  return noteCache.prune(livePaths);
}

/** Test/reset hook — empties both shared caches. */
export function clearScanCache(): void {
  mindCache.clear();
  noteCache.clear();
}
