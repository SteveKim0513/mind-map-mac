import { describe, expect, it } from 'vitest';
import { formatErrorEvent, formatRejectionEvent, installRendererDiagnostics, shortFrames, type DiagLevel } from './diagnostics';
import { MAX_DIAG_LINE, redactMessage, sanitizeUncaughtConsoleMessage } from './io/logSanitize';

/** 리스너를 붙잡아 두는 가짜 window. `defaultPrevented` 같은 기본 동작 조작이 없는지도 본다. */
function fakeTarget() {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
    fire: (type: string, event: unknown) => listeners.get(type)?.(event),
    has: (type: string) => listeners.has(type),
  };
}

function setup(options: Parameters<typeof installRendererDiagnostics>[2] = {}) {
  const target = fakeTarget();
  const lines: { level: DiagLevel; message: string }[] = [];
  let t = 1_000_000;
  const stop = installRendererDiagnostics((level, message) => lines.push({ level, message }), target, { now: () => t, ...options });
  return { target, lines, stop, advance: (ms: number) => (t += ms) };
}

function errorWithStack(name: string, message: string, frames: string[]): Error {
  const e = new Error(message);
  e.name = name;
  e.stack = `${name}: ${message}\n${frames.map((f) => `    at ${f}`).join('\n')}`;
  return e;
}

describe('formatting', () => {
  it('keeps the error name, message and the first 3 frames reduced to file:line:col', () => {
    const err = errorWithStack('TypeError', "Cannot read properties of undefined (reading 'title')", [
      'renderNode (file:///Users/jiho/Library/app.asar/dist/assets/index-abc.js:10:20)',
      'commit (http://localhost:5173/src/canvas/Canvas.tsx?t=17123:5:6)',
      'run (/Users/jiho/Documents/secret-project/other.js:1:2)',
      'fourth (/x/y/z.js:9:9)',
    ]);
    const line = formatErrorEvent({ message: 'Uncaught TypeError: ...', filename: 'file:///Users/jiho/Library/app.asar/dist/assets/index-abc.js', lineno: 10, colno: 20, error: err })!;
    expect(line).toContain("uncaught TypeError: Cannot read properties of undefined (reading 'title')");
    expect(line).toContain('at renderNode (index-abc.js:10:20)');
    expect(line).toContain('at commit (Canvas.tsx:5:6)');
    expect(line).toContain('at run (other.js:1:2)');
    expect(line).not.toContain('fourth'); // 앞 3프레임만
    expect(line).toContain('@ index-abc.js:10:20');
    // 홈 디렉터리·프로젝트 경로는 새지 않는다.
    expect(line).not.toContain('/Users/');
    expect(line).not.toContain('secret-project');
    expect(line).not.toContain('?t=');
    expect(line.length).toBeLessThanOrEqual(MAX_DIAG_LINE);
  });

  it('never includes the browser message or value of a non-Error throw (it can carry file content)', () => {
    const secret = 'MY-PRIVATE-NOTE-TEXT';
    const line = formatErrorEvent({ message: `Uncaught ${secret}`, filename: 'file:///a/b/index.js', lineno: 3, colno: 4, error: secret })!;
    expect(line).toBe('uncaught non-Error (string(len=20)) @ index.js:3:4');
    expect(line).not.toContain(secret);
    expect(formatRejectionEvent({ reason: secret })).toBe('unhandled rejection non-Error reason (string(len=20))');
    expect(formatRejectionEvent({ reason: { note: secret } })).toBe('unhandled rejection non-Error reason (object)');
    expect(formatRejectionEvent({ reason: undefined })).toBe('unhandled rejection non-Error reason (undefined)');
    expect(formatRejectionEvent({})).not.toContain(secret);
  });

  it('drops SyntaxError / JSON parser messages (they quote the input) and masks quoted fragments elsewhere', () => {
    const secret = 'Alice-secret-name';
    let syntax: unknown;
    try {
      JSON.parse(`${secret} is here`);
    } catch (e) {
      syntax = e;
    }
    const line = formatRejectionEvent({ reason: syntax });
    expect(line).toContain('SyntaxError: (message omitted)');
    expect(line).not.toContain('Alice');

    expect(redactMessage('Error', `failed to read "${secret}" from 'private.md'`)).toBe('failed to read "…" from \'…\'');
    // 프로퍼티·API 이름 자리의 짧은 식별자는 진단에 필요해 남긴다.
    expect(redactMessage('TypeError', "Cannot read properties of null (reading 'children')")).toBe("Cannot read properties of null (reading 'children')");
    // 따옴표 안이 식별자 모양이어도 그 자리가 아니면(값 자리) 가린다.
    expect(redactMessage('Error', "value 'hello' rejected")).toBe("value '…' rejected");
    const bell = String.fromCharCode(7);
    expect(redactMessage('Error', `bad${bell}thing`)).toBe('bad thing');
  });

  it('caps the whole line at 300 characters', () => {
    const err = errorWithStack('Error', 'x '.repeat(400), ['a (f.js:1:1)', 'b (g.js:2:2)', 'c (h.js:3:3)']);
    expect(formatErrorEvent({ error: err })!.length).toBeLessThanOrEqual(MAX_DIAG_LINE);
    expect(formatRejectionEvent({ reason: err }).length).toBeLessThanOrEqual(MAX_DIAG_LINE);
  });

  it('ignores the benign ResizeObserver loop notification and tolerates junk events', () => {
    expect(formatErrorEvent({ message: 'ResizeObserver loop completed with undelivered notifications.' })).toBeNull();
    expect(formatErrorEvent(null)).toBe('uncaught non-Error (undefined)');
    expect(shortFrames(undefined)).toEqual([]);
    expect(shortFrames('no frames here')).toEqual([]);
  });
});

describe('installRendererDiagnostics', () => {
  it('logs window errors and unhandled rejections as error lines without touching the event (no preventDefault)', () => {
    const { target, lines } = setup();
    let prevented = false;
    const event = { error: errorWithStack('Error', 'boom', ['f (a.js:1:2)']), preventDefault: () => (prevented = true) };
    target.fire('error', event);
    target.fire('unhandledrejection', { reason: errorWithStack('RangeError', 'late', []), preventDefault: () => (prevented = true) });
    expect(prevented).toBe(false);
    expect(lines.map((l) => l.level)).toEqual(['error', 'error']);
    expect(lines[0]!.message).toBe('uncaught Error: boom | at f (a.js:1:2)');
    expect(lines[1]!.message).toBe('unhandled rejection RangeError: late');
  });

  it('logs the same message once per 60 seconds and summarizes suppressed repeats as (+N)', () => {
    const { target, lines, advance } = setup();
    const boom = () => target.fire('error', { error: errorWithStack('Error', 'same', []) });
    for (let i = 0; i < 5; i++) boom();
    expect(lines).toHaveLength(1);
    advance(59_000);
    boom();
    expect(lines).toHaveLength(1);
    advance(2_000); // 창(60초) 경과
    boom();
    expect(lines).toHaveLength(2);
    expect(lines[1]!.message).toBe('uncaught Error: same (+5)');
    advance(61_000);
    boom();
    expect(lines[2]!.message).toBe('uncaught Error: same'); // 억제한 게 없으면 요약 없음
  });

  it('allows at most 20 lines per minute and reports the dropped count in the next minute', () => {
    const { target, lines, advance } = setup();
    for (let i = 0; i < 35; i++) target.fire('error', { error: errorWithStack('Error', `distinct-${i}`, []) });
    expect(lines).toHaveLength(20);
    advance(61_000);
    target.fire('error', { error: errorWithStack('Error', 'after', []) });
    expect(lines).toHaveLength(22);
    expect(lines[20]).toEqual({ level: 'warn', message: 'renderer error log rate limit (20/min): 15 entries dropped in the previous minute' });
    expect(lines[21]!.message).toBe('uncaught Error: after');
  });

  it('survives a throwing log function and can be removed', () => {
    const target = fakeTarget();
    const stop = installRendererDiagnostics(
      () => {
        throw new Error('ipc gone');
      },
      target,
    );
    expect(() => target.fire('error', { error: new Error('x') })).not.toThrow();
    expect(() => target.fire('unhandledrejection', { reason: 1 })).not.toThrow();
    stop();
    expect(target.has('error')).toBe(false);
    expect(target.has('unhandledrejection')).toBe(false);
  });
});

describe('sanitizeUncaughtConsoleMessage (main의 console-message 브리지용)', () => {
  it('Error 형태는 이름과 정제한 메시지만 남긴다', () => {
    expect(sanitizeUncaughtConsoleMessage('Uncaught TypeError: Cannot read properties of null (reading \'children\')')).toBe(
      "Uncaught TypeError: Cannot read properties of null (reading 'children')",
    );
    expect(sanitizeUncaughtConsoleMessage('Uncaught Error: diag-test')).toBe('Uncaught Error: diag-test');
    expect(sanitizeUncaughtConsoleMessage('Uncaught (in promise) RangeError: bad "private text" value')).toBe('Uncaught (in promise) RangeError: bad "…" value');
    expect(sanitizeUncaughtConsoleMessage('Uncaught SyntaxError: Unexpected token \'A\', "Alice-secr"... is not valid JSON')).toBe('Uncaught SyntaxError: (message omitted)');
  });

  it('Error가 아닌 값(throw "문자열" 등)은 내용 없이 길이만 남긴다', () => {
    const line = sanitizeUncaughtConsoleMessage('Uncaught MY-PRIVATE-NOTE-TEXT');
    expect(line).toBe('Uncaught non-Error value (len=29)');
    expect(sanitizeUncaughtConsoleMessage('Uncaught (in promise) some secret text')).toBe('Uncaught (in promise) non-Error value (len=38)');
    expect(sanitizeUncaughtConsoleMessage('Uncaught Error without colon secret')).not.toContain('secret');
  });

  it('여러 줄이면 첫 줄만, 300자를 넘지 않는다', () => {
    const out = sanitizeUncaughtConsoleMessage(`Uncaught Error: ${'x '.repeat(400)}\n    at foo (bar.js:1:1)`);
    expect(out.length).toBeLessThanOrEqual(MAX_DIAG_LINE);
    expect(out).not.toContain('bar.js');
  });
});
