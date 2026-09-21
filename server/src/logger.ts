export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 로그에 남길 수 있는 필드(화이트리스트). 여기에 없는 키는 호출자가 넘겨도 버린다 — 토큰·초대 코드·이름·문서 내용이
 * 로그로 새는 경로를 구조적으로 막는다. 값은 모두 이벤트·메타데이터·오류 코드다.
 */
export interface LogFields {
  roomId?: string;
  participantId?: string;
  docKind?: string;
  method?: string;
  route?: string;
  status?: number;
  /** 사유 코드(`invalid_code`, `rate_limited`, `revoked` …) — 자유 문장이 아니다. */
  reason?: string;
  port?: number;
  /** WebSocket close code(4403 등). */
  code?: number;
  /** 오류 클래스 이름(`TypeError` …). */
  errorName?: string;
  /** 예기치 못한 오류의 메시지 — `sanitizeMessage`를 거쳐 200자 이내, 비밀처럼 보이는 조각은 가린다. */
  message?: string;
}

export type Logger = (event: string, fields?: LogFields, level?: LogLevel) => void;

const ALLOWED: ReadonlyArray<keyof LogFields> = [
  'roomId', 'participantId', 'docKind', 'method', 'route', 'status', 'reason', 'port', 'code', 'errorName', 'message',
];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export const LOG_LEVELS: ReadonlyArray<LogLevel> = ['debug', 'info', 'warn', 'error'];
const MAX_FIELD_LENGTH = 100;
export const MAX_MESSAGE_LENGTH = 200;

/**
 * 오류 메시지를 로그에 남길 수 있게 다듬는다(방어 심층 — 1차 방어는 "오류 메시지에 사용자 값을 넣지 않는다"이다).
 *  - 제어문자 제거, 200자 상한.
 *  - 토큰(base64url 32자+ 또는 숫자가 섞인 16자+)·초대 코드(8자: 대문자/숫자, 또는 숫자가 섞인 8자)처럼 보이는 조각은 `[redacted]`로 가린다.
 */
export function sanitizeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
  text = text.replace(/[A-Za-z0-9_-]{16,}/g, (run) => (run.length >= 32 || /\d/.test(run) ? '[redacted]' : run));
  text = text.replace(/\b[A-Z0-9]{4}[-\s]?[A-Z0-9]{4}\b/g, '[redacted]');
  text = text.replace(/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8}\b/g, '[redacted]');
  text = text.trim();
  if (text.length > MAX_MESSAGE_LENGTH) text = `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
  return text.length > 0 ? text : undefined;
}

/**
 * 오류 객체 → 로그 필드(이름 + 다듬은 메시지). `SyntaxError`는 메시지에 입력 조각(JSON 조각 등)이 섞일 수 있어 이름만 남긴다.
 */
export function describeError(error: unknown): Pick<LogFields, 'errorName' | 'message'> {
  if (!(error instanceof Error)) return { errorName: 'unknown' };
  const errorName = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(error.name) ? error.name : 'Error';
  if (error.name === 'SyntaxError') return { errorName };
  const message = sanitizeMessage(error.message);
  return message === undefined ? { errorName } : { errorName, message };
}

/** 로그 한 줄(JSON)을 만든다. 허용된 필드만 담는다. */
export function formatLogLine(event: string, fields: LogFields = {}, level: LogLevel = 'info', at: Date = new Date()): string {
  const line: Record<string, unknown> = { t: at.toISOString(), level, event };
  for (const key of ALLOWED) {
    const value = fields[key];
    if (value === undefined) continue;
    if (key === 'message') {
      const message = sanitizeMessage(value);
      if (message !== undefined) line[key] = message;
    } else if (typeof value === 'string') {
      line[key] = value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
    } else {
      line[key] = value;
    }
  }
  return JSON.stringify(line);
}

/**
 * 로거를 만든다. `silent`면 아무것도 쓰지 않는다. `minLevel` 미만(기본 info 미만 = debug)은 버린다 — 정상 종료 같은 소음을
 * 기본으로 숨기고, 필요할 때만 `LOG_LEVEL=debug`로 켠다. error 수준은 stderr로 낸다(Railway가 오류로 분류).
 */
export function createLogger(silent: boolean, minLevel: LogLevel = 'info'): Logger {
  if (silent) return () => {};
  return (event, fields = {}, level = 'info') => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = formatLogLine(event, fields, level);
    if (level === 'error') console.error(line);
    else console.log(line);
  };
}

export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw.trim() === '') return 'info';
  const value = raw.trim().toLowerCase();
  if ((LOG_LEVELS as ReadonlyArray<string>).includes(value)) return value as LogLevel;
  throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${raw}")`);
}
