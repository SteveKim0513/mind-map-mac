// 외부에서 들어온(원격이 채울 수 있는) 링크·경로의 안전 검사 — 순수 함수 모음(외부 입력 경계, io/ 계층).
//
// 배경(F1b): 공유 폴더로 받은 맵의 노드 `link`/`links`, 보드 스티키의 `link`, 공유 노트 본문의 `[x](url)`은 악성 소유자·참가자가
// 임의 문자열로 채울 수 있다. 그런데 클릭은 `window.open` → main의 `setWindowOpenHandler` → `shell.openExternal`로 이어져
// `file:///…`·`smb://`·`ssh://`·커스텀 스킴이 OS에서 열린다. 그래서 "열 수 있는 스킴"을 한 곳(여기)에 두고
// main(열기 직전)·`io/sharedFile`(발행·수신 정제)·`note/markdown`(렌더)이 같은 규칙을 쓴다.
//
// 파싱은 문자열 검사가 아니라 WHATWG `URL`에 맡긴다 — `JavaScript:`·`  file:`·`java\tscript:`·`data:`처럼
// 공백·제어문자·대소문자로 우회한 스킴도 브라우저와 똑같이 정규화된 뒤 판정된다.

/** 외부 앱으로 열어도 되는 URL 스킴. 그 밖(file:·smb:·ssh:·javascript:·data:·vbscript:·커스텀 스킴…)은 열지 않는다. */
export const SAFE_EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

const MAX_URL_LENGTH = 2048;
const MAX_PATH_LENGTH = 1024;

/**
 * 이미 브라우저가 해석해 넘겨준 URL(예: `setWindowOpenHandler`의 `url`)의 스킴이 허용 목록에 있는가.
 * 파싱 실패(상대 경로·깨진 문자열)는 허용하지 않는다.
 */
export function isAllowedExternalProtocol(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * 파일에 저장된 링크 문자열을 검증한다. 안전하면 앞뒤 공백을 자른 문자열, 아니면 null.
 * `isAllowedExternalProtocol`보다 엄격하다 — 저장값은 그대로 `window.open`/`href`에 들어가므로
 * 제어·서식 문자(탭·개행·제로폭·방향 제어 등)가 섞인 문자열, 너무 긴 문자열, 스킴 없는 문자열은 모두 거부한다.
 */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length === 0 || s.length > MAX_URL_LENGTH) return null;
  if (/[\p{C}]/u.test(s)) return null;
  return isAllowedExternalProtocol(s) ? s : null;
}

/**
 * 워크스페이스(또는 공유 폴더) 기준의 안전한 **상대** 파일 경로인가 — 링크 힌트(`mapPath`·`notePath`) 정제용.
 * 절대 경로·`~`·스킴/드라이브 접두·`\`·`.`/`..` 세그먼트·숨김 세그먼트·제어문자·빈 세그먼트를 거부하고,
 * 확장자가 기대와 다르면 거부한다. 퍼센트 인코딩(`%2e%2e`)으로 우회한 `..`도 잡는다. 안전하면 입력 그대로, 아니면 null.
 */
export function safeRelativeLinkPath(value: unknown, ext: '.md' | '.mind'): string | null {
  if (typeof value !== 'string') return null;
  const p = value;
  if (p.length === 0 || p.length > MAX_PATH_LENGTH) return null;
  if (/[\p{C}]/u.test(p) || p.includes('\\')) return null;
  if (p.startsWith('/') || p.startsWith('~')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return null; // 스킴 또는 드라이브 문자
  if (!p.endsWith(ext)) return null;
  const variants = [p];
  try {
    variants.push(decodeURIComponent(p));
  } catch {
    /* 잘못된 퍼센트 인코딩 — 원문만 검사 */
  }
  for (const v of variants) {
    if (/[\p{C}]/u.test(v) || v.includes('\\') || v.startsWith('/')) return null;
    for (const seg of v.split('/')) {
      if (seg === '' || seg.startsWith('.')) return null; // 빈·`.`·`..`·숨김
    }
  }
  return p;
}

/**
 * 링크 힌트로 저장된 **절대** 경로가 워크스페이스 루트 안의 지정 확장자 파일인가 — 열기 직전(클릭 시점)의 마지막 방어선.
 * 루트 밖·`..`/`.` 세그먼트·제어문자·확장자 불일치는 거부한다. 문자열 검사만 하며 파일 시스템(심볼릭 링크)은 보지 않는다.
 */
export function isPathInsideRoot(root: string, p: unknown, ext: '.md' | '.mind'): p is string {
  if (typeof p !== 'string' || typeof root !== 'string' || root.length === 0) return false;
  if (p.length > MAX_PATH_LENGTH || !p.endsWith(ext) || /[\p{C}]/u.test(p)) return false;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (!p.startsWith(prefix)) return false;
  return !p
    .slice(prefix.length)
    .split('/')
    .some((seg) => seg === '' || seg === '.' || seg === '..');
}
