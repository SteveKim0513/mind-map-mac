import { describe, expect, it } from 'vitest';
import {
  MAX_ANCHOR_LABEL,
  MAX_COMMENT_TEXT,
  MAX_TARGET_ID,
  anchorKey,
  cleanAnchorLabel,
  cleanCommentText,
  compareComments,
  parseComment,
  parseCommentAnchor,
  previewOf,
  sameAnchor,
} from './commentFormat';

const NOW = 1_800_000_000_000;
const good = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1', label: '루트' },
  authorId: 'participant-1',
  authorName: '민수',
  text: '여기 일정이 빠듯해요',
  createdAt: NOW - 1000,
  ...over,
});

describe('parseCommentAnchor', () => {
  it('accepts map/board anchors with and without a target', () => {
    expect(parseCommentAnchor({ kind: 'map', fileId: 'f1', targetId: 'n1' })).toEqual({ kind: 'map', fileId: 'f1', targetId: 'n1' });
    expect(parseCommentAnchor({ kind: 'board', fileId: 'f1' })).toEqual({ kind: 'board', fileId: 'f1' });
  });

  it('accepts a note anchor (whole note) and drops unknown fields', () => {
    expect(parseCommentAnchor({ kind: 'note', noteId: 'note-1', label: '회의록', evil: '<script>' })).toEqual({ kind: 'note', noteId: 'note-1', label: '회의록' });
  });

  it('rejects unknown kinds, unsafe ids and oversize fields', () => {
    expect(parseCommentAnchor({ kind: 'calendar', fileId: 'f1' })).toBeNull();
    expect(parseCommentAnchor({ kind: 'map', fileId: '../etc' })).toBeNull();
    expect(parseCommentAnchor({ kind: 'map', fileId: '.hidden' })).toBeNull();
    expect(parseCommentAnchor({ kind: 'map', fileId: 'f1', targetId: 'x'.repeat(MAX_TARGET_ID + 1) })).toBeNull();
    expect(parseCommentAnchor({ kind: 'map', fileId: 'f1', targetId: 'a\u0000b' })).toBeNull();
    expect(parseCommentAnchor({ kind: 'map', fileId: 'f1', label: 'x'.repeat(MAX_ANCHOR_LABEL + 1) })).toBeNull();
    expect(parseCommentAnchor({ kind: 'note' })).toBeNull();
    expect(parseCommentAnchor(null)).toBeNull();
    expect(parseCommentAnchor([])).toBeNull();
    expect(parseCommentAnchor('map')).toBeNull();
  });
});

describe('parseComment', () => {
  it('accepts a well-formed comment and normalizes it', () => {
    const c = parseComment(good({ extra: 1 }), 'c-1', NOW);
    expect(c).toEqual({
      id: 'c-1',
      anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1', label: '루트' },
      authorId: 'participant-1',
      authorName: '민수',
      text: '여기 일정이 빠듯해요',
      createdAt: NOW - 1000,
    });
  });

  it('keeps replies and soft deletes (deleted comments may have empty text)', () => {
    expect(parseComment(good({ parentId: 'c-0' }), 'c-1', NOW)?.parentId).toBe('c-0');
    const del = parseComment(good({ text: '', deleted: true }), 'c-1', NOW);
    expect(del?.deleted).toBe(true);
    expect(del?.text).toBe('');
    // "deleted" must be exactly true — other truthy values are malformed
    expect(parseComment(good({ deleted: 'yes' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ deleted: false }), 'c-1', NOW)).toBeNull();
  });

  it('rejects a key/id mismatch (a forged value under someone else’s key)', () => {
    expect(parseComment(good(), 'c-2', NOW)).toBeNull();
    expect(parseComment(good({ id: '__proto__' }), '__proto__', NOW)?.id).toBe('__proto__'); // legal id chars — map-safe via Map/defineProperty elsewhere
  });

  it('rejects malicious or oversize input', () => {
    expect(parseComment(good({ text: '' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ text: 'x'.repeat(MAX_COMMENT_TEXT + 1) }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ text: 'x'.repeat(10_000_000) }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ text: 'a\u0000b' }), 'c-1', NOW)).toBeNull(); // NUL
    expect(parseComment(good({ text: 'a\u202Eb' }), 'c-1', NOW)).toBeNull(); // bidi override
    expect(parseComment(good({ text: 5 }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ authorName: '<img src=x onerror=1>' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ authorName: '' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ authorName: 'n'.repeat(41) }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ authorId: 'short' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ authorId: '../../x/y/z/w' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ id: 'a/b' }), undefined, NOW)).toBeNull();
    expect(parseComment(good({ anchor: { kind: 'map', fileId: '../x' } }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ parentId: '../x' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(null, undefined, NOW)).toBeNull();
    expect(parseComment('hello', undefined, NOW)).toBeNull();
    expect(parseComment([1, 2], undefined, NOW)).toBeNull();
  });

  it('rejects impossible timestamps but tolerates small clock skew', () => {
    expect(parseComment(good({ createdAt: -1 }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ createdAt: Number.NaN }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ createdAt: Infinity }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ createdAt: '123' }), 'c-1', NOW)).toBeNull();
    expect(parseComment(good({ createdAt: NOW + 60_000 }), 'c-1', NOW)).not.toBeNull(); // a minute ahead: fine
    expect(parseComment(good({ createdAt: NOW + 3 * 24 * 3600_000 }), 'c-1', NOW)).toBeNull(); // days ahead: garbage
  });

  it('never returns HTML-ish structure — text stays a plain string', () => {
    const c = parseComment(good({ text: '<b>bold</b> & <script>alert(1)</script>' }), 'c-1', NOW);
    expect(c?.text).toBe('<b>bold</b> & <script>alert(1)</script>'); // stored verbatim; rendering as React text is the UI's job
  });
});

describe('cleanCommentText', () => {
  it('trims, unifies newlines and strips control characters', () => {
    expect(cleanCommentText('  안녕\r\n하세요\u0000 ')).toBe('안녕\n하세요');
  });
  it('rejects empty and over-long input', () => {
    expect(cleanCommentText('   ')).toBeNull();
    expect(cleanCommentText('\u0000\u0001')).toBeNull();
    expect(cleanCommentText('x'.repeat(MAX_COMMENT_TEXT))).not.toBeNull();
    expect(cleanCommentText('x'.repeat(MAX_COMMENT_TEXT + 1))).toBeNull();
    expect(cleanCommentText(42)).toBeNull();
  });
  it('counts emoji as characters, not UTF-16 units', () => {
    expect(cleanCommentText('😀'.repeat(MAX_COMMENT_TEXT))).not.toBeNull();
  });
});

describe('cleanAnchorLabel / previewOf / anchors', () => {
  it('collapses whitespace and truncates labels', () => {
    expect(cleanAnchorLabel('  두   줄\n라벨 ')).toBe('두 줄 라벨');
    expect(cleanAnchorLabel('')).toBeUndefined();
    expect(cleanAnchorLabel(undefined)).toBeUndefined();
    const long = cleanAnchorLabel('가'.repeat(200));
    expect([...(long ?? '')].length).toBe(MAX_ANCHOR_LABEL);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('previewOf folds newlines and limits length', () => {
    expect(previewOf('a\n\nb   c')).toBe('a b c');
    expect([...previewOf('x'.repeat(500))].length).toBe(80);
  });

  it('anchorKey ignores the label; different targets differ; note vs file never collide', () => {
    const a = { kind: 'map' as const, fileId: 'f1', targetId: 'n1', label: 'A' };
    const b = { kind: 'map' as const, fileId: 'f1', targetId: 'n1', label: 'B' };
    expect(sameAnchor(a, b)).toBe(true);
    expect(sameAnchor(a, { kind: 'map', fileId: 'f1', targetId: 'n2' })).toBe(false);
    expect(sameAnchor({ kind: 'map', fileId: 'f1' }, { kind: 'map', fileId: 'f1', targetId: '' })).toBe(true);
    expect(anchorKey({ kind: 'note', noteId: 'f1' })).not.toBe(anchorKey({ kind: 'map', fileId: 'f1' }));
  });

  it('compareComments orders by time then id, deterministically', () => {
    const base = parseComment(good(), 'c-1', NOW)!;
    const later = { ...base, id: 'c-0', createdAt: base.createdAt + 5 };
    const tie = { ...base, id: 'c-2' };
    expect([later, tie, base].sort(compareComments).map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-0']);
  });
});
