// 공유 폴더 문서 이름 규약 (설계 계약: exec-plan 2026-09-21-shared-folder-collab.md).
//
//   Hocuspocus 문서 이름 = `${roomId}/${docKey}`
//   docKey = 'manifest' | 'comments' | `note:${id}` | `file:${id}`
//
// 서버(server/src/validate.ts)가 같은 규칙을 강제한다 — 여기서 만든 이름은 항상 서버 검증을 통과하고,
// 여기서 거부한 이름은 서버도 거부한다(id는 서버보다 조금 더 엄격: 선행 '.' 금지).
import { isRoomId, isSafeDocId } from '../io/shareFormat';
import { MAX_SIDECAR_DOC_ID, SIDECAR_ID_RE } from '../io/shareLimits';

// 사이드카 파일 이름 규칙의 원천은 `io/shareLimits.ts`(main도 같은 값을 쓴다). 여기서는 기존 import 경로를 위해 다시 내보낸다.
export { MAX_SIDECAR_DOC_ID, SIDECAR_ID_RE };

export type DocKind = 'manifest' | 'comments' | 'note' | 'file';

export type DocKey = 'manifest' | 'comments' | `note:${string}` | `file:${string}`;

export type ParsedDocKey =
  | { kind: 'manifest' }
  | { kind: 'comments' }
  | { kind: 'note'; id: string }
  | { kind: 'file'; id: string };

export const MANIFEST_KEY: DocKey = 'manifest';
export const COMMENTS_KEY: DocKey = 'comments';

/** 서버가 허용하는 문서 이름 최대 길이. */
const MAX_DOCUMENT_NAME = 256;

export function noteKey(id: string): DocKey {
  if (!isSafeDocId(id)) throw new Error('invalid note id');
  return `note:${id}`;
}

export function fileKey(id: string): DocKey {
  if (!isSafeDocId(id)) throw new Error('invalid file id');
  return `file:${id}`;
}

/** docKey 문자열 → 구조. 규약 밖이면 null. */
export function parseDocKey(docKey: unknown): ParsedDocKey | null {
  if (docKey === 'manifest') return { kind: 'manifest' };
  if (docKey === 'comments') return { kind: 'comments' };
  if (typeof docKey !== 'string') return null;
  const colon = docKey.indexOf(':');
  if (colon < 0) return null;
  const kind = docKey.slice(0, colon);
  const id = docKey.slice(colon + 1);
  if ((kind === 'note' || kind === 'file') && isSafeDocId(id)) return { kind, id };
  return null;
}

export function isDocKey(docKey: unknown): docKey is DocKey {
  return parseDocKey(docKey) !== null;
}

/** `${roomId}/${docKey}` — 잘못된 입력은 던진다(프로그래머 오류). */
export function makeDocName(roomId: string, docKey: string): string {
  if (!isRoomId(roomId)) throw new Error('invalid room id');
  if (!isDocKey(docKey)) throw new Error('invalid doc key');
  const name = `${roomId}/${docKey}`;
  if (name.length > MAX_DOCUMENT_NAME) throw new Error('document name too long');
  return name;
}

/** 문서 이름 → { roomId, docKey, parsed }. 규약 밖이면 null. (roomId에는 '/'가 없으므로 첫 '/'에서 분리.) */
export function parseDocName(
  name: unknown,
): { roomId: string; docKey: DocKey; parsed: ParsedDocKey } | null {
  if (typeof name !== 'string' || name.length > MAX_DOCUMENT_NAME) return null;
  const slash = name.indexOf('/');
  if (slash < 0) return null;
  const roomId = name.slice(0, slash);
  const docKey = name.slice(slash + 1);
  if (!isRoomId(roomId)) return null;
  const parsed = parseDocKey(docKey);
  if (!parsed) return null;
  return { roomId, docKey: docKey as DocKey, parsed };
}

/** id를 소문자 hex로 인코딩한다(문자 코드 단위, id는 ASCII만 허용되므로 1글자 = 2자리). 대소문자 무시 파일시스템에서도 `A`/`a`가 충돌하지 않는다. */
function hexOfId(id: string): string {
  let out = '';
  for (let i = 0; i < id.length; i++) out += id.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

/** 이 문서 id로 사이드카 파일을 만들 수 있는가(너무 긴 id는 파일 이름 상한을 넘는다). */
export function isSidecarableDocId(id: string): boolean {
  return isSafeDocId(id) && id.length <= MAX_SIDECAR_DOC_ID;
}

/**
 * docKey → 사이드카 파일 id (`.mindshare/<id>.yjs`).
 *  - 노트: `n_` + id의 소문자 hex (제목 rename에 안 끌려가고, 시스템 사이드카 이름과 충돌하지 않으며, 대소문자 무시
 *    파일시스템에서 id `A`/`a`가 같은 파일이 되지 않는다).
 *  - 시스템: `_manifest` · `_comments` · `_file_` + hex(fileId). (노트 접두사 `n_`와 `_`로 시작하는 시스템 이름은 서로 겹칠 수 없다.)
 * 너무 긴 id는 null — 호출자는 그 문서를 공유·영속하지 않는다.
 */
export function sidecarIdForDocKey(docKey: string): string | null {
  const p = parseDocKey(docKey);
  if (!p) return null;
  switch (p.kind) {
    case 'note':
      return isSidecarableDocId(p.id) ? `n_${hexOfId(p.id)}` : null;
    case 'manifest':
      return '_manifest';
    case 'comments':
      return '_comments';
    case 'file':
      return isSidecarableDocId(p.id) ? `_file_${hexOfId(p.id)}` : null;
  }
}
