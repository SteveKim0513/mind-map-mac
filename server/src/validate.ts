const ROOM_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DOC_KEY = /^(?:manifest|comments|(?:note|file):[A-Za-z0-9._-]{1,128})$/;
const MAX_DOCUMENT_NAME = 256;

export type DocKind = 'manifest' | 'note' | 'file' | 'comments';

export interface ParsedDocumentName {
  roomId: string;
  docKey: string;
  kind: DocKind;
}

export function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID.test(value);
}

export function parseDocumentName(name: unknown): ParsedDocumentName | null {
  if (typeof name !== 'string' || name.length > MAX_DOCUMENT_NAME) return null;
  const slash = name.indexOf('/');
  if (slash < 0) return null;
  const roomId = name.slice(0, slash);
  const docKey = name.slice(slash + 1);
  if (!ROOM_ID.test(roomId) || !DOC_KEY.test(docKey)) return null;
  const kind = docKey.split(':', 1)[0] as DocKind;
  return { roomId, docKey, kind };
}

const MAX_DISPLAY_NAME = 40;

export function parseDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim();
  const length = [...name].length;
  if (length < 1 || length > MAX_DISPLAY_NAME) return null;
  if (/[\p{C}\p{Zl}\p{Zp}<>]/u.test(name)) return null;
  return name;
}

const MAX_FOLDER_NAME = 80;

/**
 * 공유 폴더 이름(메타데이터) — NFC·trim, 1~80자, 경로 구분자·제어문자 금지, 선행 '.' 금지(숨김/`..` 방지).
 * 참가자 클라이언트가 이 이름으로 로컬 폴더를 만들기 때문에 서버에서도 걸러둔다(클라이언트도 다시 검증한다).
 */
export function parseFolderName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim();
  const length = [...name].length;
  if (length < 1 || length > MAX_FOLDER_NAME) return null;
  if (/[/\\\p{C}\p{Zl}\p{Zp}]/u.test(name) || name.startsWith('.')) return null;
  return name;
}

const MAX_BEARER = 256;

export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  const token = match?.[1];
  return token && token.length <= MAX_BEARER ? token : null;
}
