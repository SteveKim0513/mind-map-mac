// 렌더러 전역 오류 캡처 — `window`의 `error`·`unhandledrejection`을 앱 로그(`[renderer]` 줄)로 남겨, 사용자가 보낸 로그만으로 화면이 멈춘/깨진
// 원인을 좁힐 수 있게 한다.
//
// 규칙
//  - 동작·UI 변경 없음: 리스너는 관찰만 한다(`preventDefault` 금지 — 브라우저 기본 처리(콘솔 출력 등)를 그대로 둔다).
//  - 개인정보: **내용이 섞일 수 있는 값은 남기지 않는다.** `Event` 객체 전체·입력 문자열·Error가 아닌 던져진 값(문자열 등)의 내용은 절대 기록하지 않고
//    타입만 남긴다. Error의 메시지는 따옴표로 묶인 조각(JSON 파서 오류가 입력 조각을 따옴표로 인용한다)을 가리고, SyntaxError·JSON 오류 메시지는 아예 버린다.
//    스택은 앞 3프레임만, 파일 경로는 `파일명:줄:열`로 줄인다(홈 디렉터리·워크스페이스 경로 미노출). 한 줄은 300자까지.
//  - 소음 방지: 같은 메시지는 60초에 1회(억제한 횟수는 다음 기록 끝에 `(+N)`), 전체는 분당 20건까지(넘치면 다음 분에 개수만 요약).
//  - main의 `render-process-gone` 로깅과 겹치지 않는다(그건 렌더러 프로세스 자체가 죽을 때, 이건 살아 있는 채로 던져진 오류).
//    main의 `console-message` 브리지가 "Uncaught …" 줄을 이미 warn/error로 남기지만 스택이 없고 원문 그대로라, 이 모듈은 스택 프레임과
//    Promise rejection 종류를 정제해 더한다.

import { MAX_DIAG_LINE, cap, redactMessage } from './io/logSanitize';

export { MAX_DIAG_LINE };

export type DiagLevel = 'error' | 'warn';
export type DiagLog = (level: DiagLevel, message: string) => void;

interface DiagTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface DiagnosticsOptions {
  now?: () => number;
  /** 분당 최대 기록 건수(기본 20). */
  maxPerMinute?: number;
  /** 같은 메시지를 다시 남기기까지의 간격(ms, 기본 60000). */
  dedupeWindowMs?: number;
}

const MAX_FRAMES = 3;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_MINUTE = 20;
const MAX_SEEN = 100;

/** 소음이라 남기지 않는 브라우저 오류(오류 객체 없이 오는 ResizeObserver 알림). */
const IGNORED_MESSAGE = /^ResizeObserver loop/;

interface ErrorLike {
  name: string;
  message: string;
  stack?: string;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ErrorLike).name === 'string' &&
    typeof (value as ErrorLike).message === 'string'
  );
}

/** 던져진 값이 Error가 아닐 때의 설명 — 내용 없이 타입(과 문자열이면 길이)만. */
function describeNonError(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `string(len=${value.length})`;
  return typeof value;
}

/** 스택의 앞 `MAX_FRAMES`개 프레임(`at fn (file:line:col)`)을 파일명만 남겨 반환한다. */
export function shortFrames(stack: string | undefined): string[] {
  if (typeof stack !== 'string') return [];
  return stack
    .split('\n')
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) =>
      line
        .trim()
        .replace(/[^\s()]*[\\/]([^\\/\s()]+:\d+:\d+)/g, '$1') // 디렉터리 제거 — 파일명:줄:열만
        .replace(/\?[^\s:)]*(?=:\d+:\d+)/g, ''), // 개발 서버의 ?t=… 쿼리 제거
    );
}

function baseName(file: unknown): string {
  if (typeof file !== 'string' || file === '') return '';
  const clean = file.split(/[?#]/)[0] ?? '';
  return clean.slice(clean.lastIndexOf('/') + 1).slice(0, 60);
}

function errorSummary(err: ErrorLike): string {
  const name = /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(err.name) ? err.name : 'Error';
  const frames = shortFrames(err.stack);
  return `${name}: ${redactMessage(name, err.message)}${frames.length > 0 ? ` | ${frames.join(' | ')}` : ''}`;
}

/** `window`의 `error` 이벤트 → 로그 한 줄(무시할 이벤트면 null). 이벤트 객체 자체는 기록하지 않는다. */
export function formatErrorEvent(event: unknown): string | null {
  const ev = (event ?? {}) as { message?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown; error?: unknown };
  if (typeof ev.message === 'string' && IGNORED_MESSAGE.test(ev.message)) return null;
  const where = baseName(ev.filename);
  const at = where
    ? ` @ ${where}${typeof ev.lineno === 'number' ? `:${ev.lineno}` : ''}${typeof ev.colno === 'number' ? `:${ev.colno}` : ''}`
    : '';
  if (isErrorLike(ev.error)) return cap(`uncaught ${errorSummary(ev.error)}${at}`);
  // 오류 객체가 없으면(문자열 throw 등) 브라우저가 만든 message에 던져진 값이 그대로 실릴 수 있다 — 내용 없이 위치만.
  return cap(`uncaught non-Error (${describeNonError(ev.error)})${at}`);
}

/** `unhandledrejection` 이벤트 → 로그 한 줄. reason이 Error가 아니면 내용 없이 타입만. */
export function formatRejectionEvent(event: unknown): string {
  const reason = (event as { reason?: unknown } | null | undefined)?.reason;
  if (isErrorLike(reason)) return cap(`unhandled rejection ${errorSummary(reason)}`);
  return cap(`unhandled rejection non-Error reason (${describeNonError(reason)})`);
}

/**
 * 전역 오류 리스너를 설치한다(앱 시작 시 한 번). 반환 함수는 리스너를 제거한다(테스트용).
 * `log`가 던져도 앱 동작에 영향이 없도록 삼킨다.
 */
export function installRendererDiagnostics(log: DiagLog, target: DiagTarget = window, options: DiagnosticsOptions = {}): () => void {
  const now = options.now ?? (() => Date.now());
  const windowMs = options.dedupeWindowMs ?? DEFAULT_WINDOW_MS;
  const maxPerMinute = options.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
  const seen = new Map<string, { at: number; suppressed: number }>();
  let minuteStart = -Infinity;
  let inMinute = 0;
  let dropped = 0;

  const write = (level: DiagLevel, message: string) => {
    try {
      log(level, message);
    } catch {
      /* 로그 실패가 앱을 깨뜨리면 안 된다 */
    }
  };

  const emit = (message: string) => {
    const t = now();
    if (t - minuteStart >= 60_000) {
      minuteStart = t;
      inMinute = 0;
      if (dropped > 0) {
        write('warn', `renderer error log rate limit (${maxPerMinute}/min): ${dropped} entries dropped in the previous minute`);
        dropped = 0;
      }
    }
    const prev = seen.get(message);
    if (prev && t - prev.at < windowMs) {
      prev.suppressed++;
      return;
    }
    if (inMinute >= maxPerMinute) {
      dropped++;
      return;
    }
    inMinute++;
    if (seen.size >= MAX_SEEN) {
      for (const [key, value] of seen) if (t - value.at >= windowMs) seen.delete(key);
      if (seen.size >= MAX_SEEN) seen.clear();
    }
    seen.set(message, { at: t, suppressed: 0 });
    write('error', cap(prev && prev.suppressed > 0 ? `${message} (+${prev.suppressed})` : message));
  };

  const onError = (event: unknown) => {
    try {
      const line = formatErrorEvent(event);
      if (line) emit(line);
    } catch {
      /* 진단이 오류를 만들면 삼킨다 */
    }
  };
  const onRejection = (event: unknown) => {
    try {
      emit(formatRejectionEvent(event));
    } catch {
      /* 진단이 오류를 만들면 삼킨다 */
    }
  };
  // 관찰만 한다 — 기본 동작을 막지 않는다(preventDefault 없음).
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
