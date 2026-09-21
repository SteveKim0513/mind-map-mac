// 공유 폴더의 크기·개수 상한과 사이드카 파일 이름 규칙 — 한곳에 모아 서로 다른 계층(main 스캔 ↔ 렌더러 검사, 복제 ↔ 매니페스트)이
// 어긋나지 않게 한다. 순수 상수만 둔다: `src/io/`는 main(electron/share.ts)과 렌더러(src/share/)가 함께 import할 수 있는 경계다.

/**
 * 워크스페이스 루트 기준 공유 폴더의 최대 깊이(루트의 자식 = 1). main의 표식 스캔(`share:listMarkers`)이 이 깊이까지만
 * 내려가므로, 더 깊은 폴더는 "공유 만들기"가 성공해도 다음 스캔에서 보이지 않는다 — 그래서 만들기 전에 막는다.
 */
export const SHARE_MAX_FOLDER_DEPTH = 4;
/** 표식 스캔이 방문하는 디렉터리 수의 상한(main). 넘으면 이후 폴더의 표식은 발견되지 않는다. */
export const SHARE_MAX_SCAN_DIRS = 5000;

/** manifest에서 읽는 노트 항목 수의 상한(원격 참가자가 무제한으로 넣을 수 없게). 서버의 방당 문서 1000개 제한과 별개로 렌더러가 방어한다. */
export const MAX_MANIFEST_NOTES = 2000;
/** manifest에서 읽는 맵·보드 파일 항목 수의 상한(파일 복제의 동시 문서 상한 300과는 별개). */
export const MAX_MANIFEST_FILES = 1000;

/** 노트 하나의 Y 상태(update) 크기 상한(바이트) — 넘으면 md 파생·쓰기를 건너뛴다(악의적·손상 문서가 렌더러를 멈추지 않게). */
export const MAX_NOTE_STATE_BYTES = 5 * 1024 * 1024;
/** 파생한 md 본문 길이 상한(글자). */
export const MAX_NOTE_MARKDOWN_CHARS = 2 * 1024 * 1024;

/**
 * 사이드카 파일 id에 넣을 수 있는 문서 id의 최대 길이. 파일 이름은 `접두사 + hex(id) + '.yjs'`이고 hex는 글자당 2자라
 * 128자 id는 256자가 되어 파일 이름 상한(255바이트)을 넘는다 — 100자까지만(hex 200 + 접두사 6 + 확장자 4 = 210).
 */
export const MAX_SIDECAR_DOC_ID = 100;

/**
 * 사이드카 파일 id 형식 — `src/share/docKeys.ts`의 `sidecarIdForDocKey`가 만들고 `electron/share.ts`가 같은 규칙으로 검증한다
 * (둘이 어긋나면 사이드카가 조용히 저장 안 된다): `_manifest` · `_comments` · `n_<소문자 hex>`(노트) · `_file_<소문자 hex>`(맵·보드).
 */
export const SIDECAR_ID_RE = /^(?:_manifest|_comments|(?:n_|_file_)(?:[0-9a-f]{2}){1,100})$/;
