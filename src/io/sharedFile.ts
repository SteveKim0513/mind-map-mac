// 공유 폴더의 맵(.mind)·보드(.board) 보기 전용 공유(ADR 0021) — 파일 내용이 릴레이를 오가기 전후의 경계 함수들.
//
// 소유자는 저장된 파일 내용을 그대로 발행하되 **다른 사람의 기기로 가는 사본에서는 리마인더 신원 4개 필드
// (reminderOn/reminderId/reminderSyncedAt/reminderBase)를 제거**한다 — 복사·붙여넣기와 같은 규칙(결정 0005·ADR 0016)이다.
// 남겨 두면 참가자 기기의 리마인더 동기화가 소유자의 리마인더 id를 자기 것으로 오해해 고아를 만든다.
// 참가자는 받은 내용을 다시 같은 함수로 검증·정제한 뒤에만 파일에 쓴다(외부 입력 경계).
//
// 이 함수들은 스키마(`version`)를 바꾸지 않는다 — 파싱은 기존 `deserialize`/`parseBoard`를 그대로 쓴다.
import { deserialize } from './formats';
import { parseBoard } from './boardFormat';
import { hashText } from './noteEnvelope';
import { isSafeDocId } from './shareFormat';
import { validateAndSanitizeShared, type SharedRejectReason, type SharedSanitizeOptions } from './sharedValidate';

export type { SharedRejectReason, SharedSanitizeOptions, NoteLinkResolver, SharedNoteRef } from './sharedValidate';

export type SharedFileKind = 'map' | 'board';

/** 발행할 수 있는 파일 내용의 상한(글자 수 기준 근사) — 릴레이 소켓 페이로드 한도(16MB)보다 훨씬 작게 둔다. */
export const MAX_SHARED_FILE_CHARS = 4 * 1024 * 1024;

const REMINDER_FIELDS = ['reminderOn', 'reminderId', 'reminderSyncedAt', 'reminderBase'] as const;

/** 확장자로 공유 대상 종류를 판별한다(`.mind` → map, `.board` → board, 그 외 null). */
export function sharedFileKind(path: string): SharedFileKind | null {
  if (path.endsWith('.mind')) return 'map';
  if (path.endsWith('.board')) return 'board';
  return null;
}

export function sharedFileExt(kind: SharedFileKind): '.mind' | '.board' {
  return kind === 'map' ? '.mind' : '.board';
}

export function isSharedFileKind(v: unknown): v is SharedFileKind {
  return v === 'map' || v === 'board';
}

function parseRaw(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 파일에 이미 들어 있는 안정 문서 id(`MindMapDoc.id`/`BoardDoc.id`). 없거나 문서 id 규칙에 안 맞으면 null. */
export function rawDocId(text: string): string | null {
  const raw = parseRaw(text);
  return raw && isSafeDocId(raw.id) ? raw.id : null;
}

/**
 * 공유 파일 id — 문서에 안정 id가 있으면 그것(이름 변경·이동을 따라간다), 없으면 상대 경로 해시 기반의 결정론적 id.
 * 파일을 고쳐 쓰지 않는다(id를 심으려고 기존 파일을 조용히 수정하지 마라).
 */
export function sharedFileId(text: string, relPath: string): string {
  return rawDocId(text) ?? `f-${hashText(relPath)}`;
}

/** 이미지 요소의 src가 안전한 상대 경로인가(폴더 밖으로 나가는 `..`·절대 경로·스킴 금지). */
function isSafeAssetSrc(src: unknown): boolean {
  if (typeof src !== 'string' || src.length === 0 || src.length > 1024) return false;
  if (src.startsWith('/') || src.startsWith('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || /[\p{C}]/u.test(src)) return false;
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    /* 잘못된 퍼센트 인코딩 — 원문 그대로 검사 */
  }
  return !decoded.split(/[/\\]/).some((seg) => seg === '..');
}

/** `checkSharedContent`의 결과 — 통과하면 정제된 내용, 거부하면 사유 코드(사용자 문구는 호출자가 정한다). */
export type SharedContentCheck = { ok: true; content: string } | { ok: false; reason: SharedRejectReason };

/**
 * 파일 내용을 공유용으로 검증·정제하고, 거부되면 **사유 코드**를 함께 돌려준다(`prepareSharedContent`의 상세 버전).
 *  - 공통: 크기 상한 → 최상위 JSON 형태 → 공유 전용 엄격 검증(`sharedValidate`: 필드 타입·참조 무결성·순환 금지·깊이/개수 상한·
 *    유한 좌표·`__proto__` 거부) + 링크 정제(외부 링크는 http(s)·mailto만, `mapPath`는 안전한 상대 경로만,
 *    보드 `noteLink`는 노트 id `{noteId,title}`로만 남기고 `notePath`는 항상 제거 — ADR 0022)
 *  - 맵: 기존 `deserialize`로 한 번 더 검증 → 노드의 리마인더 신원 4개 필드 제거
 *  - 보드: 기존 `parseBoard`로 한 번 더 검증 → 이미지 요소의 위험한 src(`..`·절대 경로·스킴) 제거
 * 로컬 파일 로드 경로(`deserialize`/`parseBoard`)는 그대로다 — 엄격 검증은 이 공유 경계에서만 적용된다.
 *
 * `opts.resolveNoteLink`는 **소유자의 발행**에서만 준다: 링크 대상 노트가 공유 폴더 안 노트일 때만 id를 돌려주는 해석기(io/는 store·도메인을
 * import하지 않으므로 주입). 안 주면 수신 재검증 모드 — 이미 정제된 사본의 `noteId`만 형식 검증해 남긴다. 입력 파일은 고치지 않는다(사본 문자열만 만든다).
 */
export function checkSharedContent(kind: SharedFileKind, text: string, opts: SharedSanitizeOptions = {}): SharedContentCheck {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'parse' };
  if (text.length > MAX_SHARED_FILE_CHARS) return { ok: false, reason: 'too_large' };
  try {
    const raw = parseRaw(text);
    if (!raw) return { ok: false, reason: 'parse' };
    // 비싼 로더(`parseBoard`의 order 보충 등 O(n²))를 부르기 전에 구조·개수 상한부터 확인한다(DoS 방어).
    const reason = validateAndSanitizeShared(kind, raw, opts);
    if (reason) return { ok: false, reason };
    if (kind === 'map') {
      deserialize(text);
      for (const n of Object.values(raw.nodes as Record<string, unknown>)) {
        for (const f of REMINDER_FIELDS) delete (n as Record<string, unknown>)[f];
      }
    } else {
      parseBoard(text);
      for (const el of Object.values(raw.elements as Record<string, unknown>)) {
        const e = el as Record<string, unknown>;
        if (e.kind === 'image' && !isSafeAssetSrc(e.src)) e.src = '';
      }
    }
    return { ok: true, content: JSON.stringify(raw, null, 2) };
  } catch {
    return { ok: false, reason: 'parse' };
  }
}

/**
 * 파일 내용을 공유용으로 검증·정제한다. 유효하지 않거나 너무 크면 null(사유가 필요하면 `checkSharedContent`).
 * 출력은 같은 입력에 항상 같은 문자열이다(id 자동 보충 같은 비결정 요소를 넣지 않는다 — 원본 JSON을 다듬어 되돌린다).
 * 이미 정제된 내용을 다시 넣어도 결과가 같다(멱등).
 */
export function prepareSharedContent(kind: SharedFileKind, text: string, opts: SharedSanitizeOptions = {}): string | null {
  const r = checkSharedContent(kind, text, opts);
  return r.ok ? r.content : null;
}

/**
 * 발행 여부 판단용 "내용 동일성 키": 최상위 `view`(팬·줌 — `MindMapDoc.view`/`BoardDoc.view`)를 뺀 나머지의 정규 직렬화.
 * 소유자가 화면을 열거나 팬·줌만 해도 파일의 `view`가 바뀌어 자동저장되는데, 그것만으로는 참가자에게 다시 보낼 이유가 없다
 * (문서 내용이 아니라 소유자의 화면 위치 — 최대 4MB 파일을 모두에게 다시 보내고 참가자 미러를 덮어쓰게 된다).
 * 두 정제된 사본의 키가 같으면 view 말고는 같은 문서다. 파싱할 수 없으면 원문을 그대로 돌려준다(항상 "다름"에 가깝게 — 안전한 쪽).
 */
export function contentIdentityKey(text: string): string {
  const raw = parseRaw(text);
  if (!raw) return text;
  const { view: _view, ...rest } = raw;
  return JSON.stringify(rest);
}

/** 발행 여부 판단용: 정제된 내용의 해시(같으면 다시 발행하지 않는다). */
export function sharedContentHash(content: string): string {
  return hashText(content);
}
