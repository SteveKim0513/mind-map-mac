import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THROTTLE_WINDOW_MS,
  docKind,
  docLabel,
  errorName,
  resetShareLogState,
  safeCode,
  setShareLogSink,
  shareLog,
  shareLogThrottled,
  shortId,
} from './shareLog';

let lines: string[];

beforeEach(() => {
  lines = [];
  resetShareLogState();
  setShareLogSink((level, message) => lines.push(`${level}: ${message}`));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  setShareLogSink(null);
});

describe('sink injection', () => {
  it('does nothing until a sink is injected, and a throwing sink never breaks the caller', () => {
    setShareLogSink(null);
    expect(() => shareLog('info', 'x')).not.toThrow();
    setShareLogSink(() => {
      throw new Error('ipc closed');
    });
    expect(() => shareLog('warn', 'x')).not.toThrow();
    expect(() => shareLogThrottled('k', 'warn', 'x')).not.toThrow();
  });
});

describe('value sanitizers keep only codes', () => {
  it('shortId keeps at most 8 safe characters', () => {
    expect(shortId('abcdefghijklmnop')).toBe('abcdefgh');
    expect(shortId('a/b c')).toBe('a?b?c');
    expect(shortId('')).toBe('?');
    expect(shortId(undefined)).toBe('?');
  });

  it('safeCode passes code-like values and collapses anything else to "unknown"', () => {
    expect(safeCode('permission-denied')).toBe('permission-denied');
    expect(safeCode('doc_too_large')).toBe('doc_too_large');
    expect(safeCode(4403)).toBe('4403');
    expect(safeCode('폴더 이름 with spaces')).toBe('unknown');
    expect(safeCode('/Users/me/Notes/secret.md')).toBe('unknown');
    expect(safeCode({ token: 'x' })).toBe('unknown');
    expect(safeCode('a'.repeat(100)).length).toBe(40);
  });

  it('errorName never includes the message', () => {
    expect(errorName(new TypeError('path /Users/me/secret'))).toBe('TypeError');
    expect(errorName('boom')).toBe('unknown');
  });

  it('docLabel exposes the document kind and at most 8 characters of the id', () => {
    expect(docLabel('manifest')).toBe('manifest');
    expect(docLabel('comments')).toBe('comments');
    expect(docLabel('note:0123456789abcdef')).toBe('note:01234567');
    expect(docLabel('file:xyz')).toBe('file:xyz');
    expect(docLabel('weird')).toBe('doc');
    expect(docKind('note:0123456789abcdef')).toBe('note');
    expect(docKind('comments')).toBe('comments');
  });
});

describe('throttling', () => {
  it('logs the same key once per window and summarizes the suppressed count on the next record', () => {
    for (let i = 0; i < 6; i++) shareLogThrottled('k', 'info', 'conn a->b');
    expect(lines).toEqual(['info: conn a->b']);
    vi.setSystemTime(1_000_000 + THROTTLE_WINDOW_MS - 1);
    shareLogThrottled('k', 'info', 'conn a->b');
    expect(lines).toHaveLength(1);
    vi.setSystemTime(1_000_000 + THROTTLE_WINDOW_MS);
    expect(shareLogThrottled('k', 'info', 'conn a->b')).toBe(true);
    expect(lines).toEqual(['info: conn a->b', 'info: conn a->b (+6)']);
    vi.setSystemTime(1_000_000 + 2 * THROTTLE_WINDOW_MS);
    shareLogThrottled('k', 'info', 'conn a->b');
    expect(lines[2]).toBe('info: conn a->b'); // 억제한 게 없으면 요약이 붙지 않는다
  });

  it('different keys do not suppress each other', () => {
    shareLogThrottled('k1', 'info', 'one');
    shareLogThrottled('k2', 'info', 'two');
    expect(lines).toEqual(['info: one', 'info: two']);
  });

  it('stays bounded when a huge number of distinct keys arrive', () => {
    for (let i = 0; i < 1000; i++) shareLogThrottled(`k${i}`, 'info', `m${i}`);
    expect(lines).toHaveLength(1000); // 초기화돼도 로그는 남는다(억제가 풀릴 뿐)
  });
});
