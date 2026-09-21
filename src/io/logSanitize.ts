// 로그에 남길 오류 문구를 다듬는 순수 함수 — 렌더러 전역 오류 캡처(src/diagnostics.ts)와 main의 console-message 브리지(electron/main.ts)가
// 함께 쓴다. electron/은 src/io/의 순수 모듈만 import할 수 있어(harness-check) 여기에 둔다. window·DOM에 의존하지 않는다.
//
// 규칙: 오류 메시지·던져진 값에는 파일 내용·입력 조각이 섞일 수 있다 — 따옴표로 묶인 조각은 가리고, JSON 파서 메시지는 버리고,
// Error가 아닌 값은 내용 없이 길이만 남긴다.

export const MAX_DIAG_LINE = 300;

// 로그 한 줄에 제어문자가 섞이지 않게 걸러낸다.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]+/g;

export function cap(text: string): string {
  return text.length > MAX_DIAG_LINE ? `${text.slice(0, MAX_DIAG_LINE - 1)}…` : text;
}

const IDENT = /^[A-Za-z_$][\w$]{0,39}$/;

/**
 * 오류 메시지 → 로그용. 따옴표로 묶인 조각은 가린다(입력 조각이 인용될 수 있다) — 단 `reading 'foo'`처럼 프로퍼티·API 이름 자리의 짧은
 * 식별자는 진단에 꼭 필요해 남긴다. SyntaxError·JSON 관련 메시지는 통째로 버린다.
 */
export function redactMessage(name: string, message: string): string {
  if (name === 'SyntaxError' || /JSON|not valid|Unexpected (?:token|end|character)/i.test(message)) return '(message omitted)';
  const text = message
    .replace(CONTROL_CHARS, ' ')
    .replace(/(["'`])(.*?)\1/g, (match: string, quote: string, inner: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 12), offset);
      const nameSlot = /(?:reading|setting|deleting|execute|construct|on|of|for|to) $/.test(before) && IDENT.test(inner);
      return nameSlot ? match : `${quote}…${quote}`;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : '(empty message)';
}

/**
 * main의 `console-message` 브리지가 남기는 "Uncaught …" 줄을 정제한다. Chromium은 잡히지 않은 오류를 콘솔 오류로도 내보내는데, 던진 값이
 * Error가 아니면(`throw "문자열"`) 그 값이 `Uncaught <값>`으로 그대로 실리고, Error여도 메시지에 입력 조각이 인용될 수 있다.
 * `Uncaught [(in promise) ]<Name>Error: <메시지>` 형태만 이름과 정제한 메시지를 남기고, 그 밖의 값은 길이만 남긴다.
 */
export function sanitizeUncaughtConsoleMessage(message: string): string {
  const line = message.split('\n')[0] ?? '';
  const m = /^Uncaught (\(in promise\) )?((?:[A-Za-z][A-Za-z0-9_]{0,40})?(?:Error|Exception)): (.*)$/.exec(line);
  if (m) return cap(`Uncaught ${m[1] ?? ''}${m[2]}: ${redactMessage(m[2] ?? 'Error', m[3] ?? '')}`);
  const inPromise = line.startsWith('Uncaught (in promise)') ? ' (in promise)' : '';
  return `Uncaught${inPromise} non-Error value (len=${message.length})`;
}
