// 공유 폴더 진단 로그 — share/ 도메인이 앱 로그(main.log의 `[share]` 줄)로 내보내는 유일한 통로.
//
// 도메인 경계: share/는 `window.api`를 직접 쓰지 않는다. 합성 루트(App.tsx)가 `setShareLogSink`로 `window.api.log(level, 'share', msg)`를
// 주입하고, 주입 전(테스트·비-Electron)에는 아무것도 하지 않는다. 테스트는 가짜 싱크를 주입해 검증한다.
//
// 개인정보 규칙(변경 금지): 로그에는 **이벤트·상태·오류 코드·개수**만 남긴다. 문서·노트·코멘트 내용, 토큰, 초대 코드, 폴더 이름,
// 표시 이름, 파일 내용, 서버가 준 자유 문장은 절대 넣지 않는다. 방 id·문서 id는 앞 8자만(`shortId`) — 서버 로그와 `grep`으로 잇기에 충분하다.
// 코드성 값은 `safeCode`를 거쳐 영숫자·`_-.:`만, 40자까지 남긴다(낯선 값이 통째로 새는 것을 막는다).

export type ShareLogLevel = 'info' | 'warn' | 'error';
export type ShareLogFn = (level: ShareLogLevel, message: string) => void;

let sink: ShareLogFn | null = null;

/** 로그 싱크를 주입한다(`null`이면 끈다). App.tsx가 앱 시작 시 한 번 부른다. */
export function setShareLogSink(fn: ShareLogFn | null): void {
  sink = fn;
}

/** 싱크로 한 줄 남긴다. 싱크가 던져도 공유 동작을 깨뜨리지 않는다. */
export function shareLog(level: ShareLogLevel, message: string): void {
  try {
    sink?.(level, message);
  } catch {
    /* 로그 실패가 공유 동작을 막으면 안 된다 */
  }
}

/** id를 앞 8자로 줄인다(로그에 남길 수 있는 최대치). 비어 있으면 `?`. */
export function shortId(id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, '?') : '?';
}

/** 코드성 값(오류 코드·사유·close code) → 안전한 짧은 토큰. 형식이 아니면 `unknown`. */
export function safeCode(value: unknown, max = 40): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return 'unknown';
  const cleaned = value.replace(/[^A-Za-z0-9_.:-]/g, '');
  return cleaned.length > 0 && cleaned.length === value.length ? cleaned.slice(0, max) : 'unknown';
}

/** 오류 객체 → 클래스 이름만(메시지는 경로·입력 조각이 섞일 수 있어 남기지 않는다). */
export function errorName(error: unknown): string {
  return error instanceof Error ? safeCode(error.name, 30) : 'unknown';
}

/** 문서 키 → 로그용 라벨: `manifest` · `comments` · `note:ab12cd34` · `file:ab12cd34`. 규약 밖이면 `doc`. */
export function docLabel(docKey: string): string {
  if (docKey === 'manifest' || docKey === 'comments') return docKey;
  const colon = docKey.indexOf(':');
  if (colon > 0) {
    const kind = docKey.slice(0, colon);
    if (kind === 'note' || kind === 'file') return `${kind}:${shortId(docKey.slice(colon + 1))}`;
  }
  return 'doc';
}

/** 문서 키 → 종류만(`note` | `file` | `comments` | `manifest` | `doc`). */
export function docKind(docKey: string): string {
  return docLabel(docKey).split(':')[0] ?? 'doc';
}

// ── 중복 억제 ────────────────────────────────────────────────────────────────
// 프로바이더 재접속 백오프 중에는 같은 전이·같은 오류가 반복된다. 같은 키의 로그는 창(기본 60초) 안에 1회만 남기고, 억제한 횟수는
// 그 키의 다음 기록 끝에 `(+N)`으로 요약한다. 요약은 다음 기록이 있을 때만 나온다(창 안의 마지막 반복은 조용히 사라질 수 있다).

export const THROTTLE_WINDOW_MS = 60_000;
const MAX_THROTTLE_KEYS = 300;
const throttle = new Map<string, { at: number; suppressed: number }>();

/** `key`가 창 안에서 이미 기록됐으면 억제(카운트만 올림), 아니면 남긴다. 반환: 실제로 남겼는가. */
export function shareLogThrottled(key: string, level: ShareLogLevel, message: string, windowMs = THROTTLE_WINDOW_MS): boolean {
  const now = Date.now();
  const entry = throttle.get(key);
  if (entry && now - entry.at < windowMs) {
    entry.suppressed++;
    return false;
  }
  if (throttle.size >= MAX_THROTTLE_KEYS) {
    for (const [k, v] of throttle) if (now - v.at >= windowMs) throttle.delete(k);
    if (throttle.size >= MAX_THROTTLE_KEYS) throttle.clear(); // 방·문서가 비정상적으로 많다 — 무한히 자라지 않게 초기화
  }
  throttle.set(key, { at: now, suppressed: 0 });
  shareLog(level, entry && entry.suppressed > 0 ? `${message} (+${entry.suppressed})` : message);
  return true;
}

/**
 * 방별로 **마지막으로 로그에 남긴** 연결 상태. 전이 로그의 `이전->이후`는 이 값을 이전으로 쓴다 — 억제된 중간 전이(재접속 반복,
 * 정리 중 잠깐의 connecting)가 있어도 로그를 위에서 아래로 읽으면 앞줄의 "이후"가 다음 줄의 "이전"으로 이어진다.
 */
const lastLoggedStatus = new Map<string, string>();
export function getLastLoggedStatus(roomId: string): string | undefined {
  return lastLoggedStatus.get(roomId);
}
export function setLastLoggedStatus(roomId: string, status: string): void {
  if (lastLoggedStatus.size >= MAX_THROTTLE_KEYS) lastLoggedStatus.clear();
  lastLoggedStatus.set(roomId, status);
}

/** 테스트용: 중복 억제 상태를 비운다. */
export function resetShareLogState(): void {
  throttle.clear();
  lastLoggedStatus.clear();
}
