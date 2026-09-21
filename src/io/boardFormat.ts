import type { BoardDoc, BoardNoteRef } from '../types';
import { newId } from './formats';
import { TAG_KEYS } from '../theme/palette';
import { isSafeDocId } from './shareFormat';

const TAG_KEY_SET = new Set<string>(TAG_KEYS);

// ── .board (JSON) ──────────────────────────────────────────────────────────
// Mirrors formats.ts's emptyDoc/serialize/deserialize shape (decision 0020):
// a plain JSON dump plus defensive backfill of optional fields on load so
// future additive fields never require a version bump.

export function emptyBoard(): BoardDoc {
  return {
    version: 1,
    id: newId(),
    elements: {},
    order: [],
    view: { zoom: 1, panX: 0, panY: 0 },
  };
}

/** The reference a sticky/image stores when the user links a note: the note's stable id (ADR 0022 — survives
 *  rename/move and reaches shared-folder participants) plus its path as a legacy fallback. An id that isn't a
 *  valid note id is left out (path only). */
export function boardNoteRef(path: string, title: string, id?: string): BoardNoteRef {
  return { notePath: path, ...(isSafeDocId(id) ? { noteId: id } : {}), title };
}

export function serializeBoard(doc: BoardDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function parseBoard(text: string): BoardDoc {
  let parsed: BoardDoc;
  try {
    parsed = JSON.parse(text) as BoardDoc;
  } catch {
    throw new Error('파일을 열 수 없습니다 — 손상된 보드');
  }
  if (!parsed || !parsed.elements || !Array.isArray(parsed.order)) {
    throw new Error('Invalid .board file');
  }
  parsed.id ??= newId();
  parsed.view ??= { zoom: 1, panX: 0, panY: 0 };
  // Drop order entries whose element vanished (defensive — should not happen
  // via normal store mutations, but keeps a hand-edited file from crashing).
  parsed.order = parsed.order.filter((id) => id in parsed.elements);
  // Any element present but missing from order (hand-edited file) is appended
  // so nothing silently disappears from the canvas.
  for (const id of Object.keys(parsed.elements)) {
    if (!parsed.order.includes(id)) parsed.order.push(id);
  }
  // 노트 링크의 안정 id(ADR 0022): 선택 필드라 없으면 그대로 두고(옛 보드 무변경), 있는데 노트 id 형식이 아니면 그 값만 버린다
  // (`notePath` 폴백은 유지). 잘못된 값이 클릭 해석·공유 발행으로 흘러가지 않게 로드 경계에서 거른다.
  for (const el of Object.values(parsed.elements)) {
    if (el.kind !== 'sticky' && el.kind !== 'image') continue;
    const ref = el.noteLink as unknown; // 외부 입력 — 모양을 믿지 않는다(io/ 경계 캐스팅)
    if (ref && typeof ref === 'object' && 'noteId' in ref && !isSafeDocId((ref as { noteId: unknown }).noteId)) {
      delete (ref as { noteId?: unknown }).noteId;
    }
  }
  // 색상 태그 범례: 외부 입력 경계에서 검증 (formats.ts와 동일한 규칙) — TAG_KEYS
  // 밖의 키나 문자열이 아닌 값은 버린다.
  if (parsed.tagLabels) {
    const clean: Partial<Record<string, string>> = {};
    for (const [key, label] of Object.entries(parsed.tagLabels)) {
      if (TAG_KEY_SET.has(key) && typeof label === 'string' && label) clean[key] = label;
    }
    parsed.tagLabels = Object.keys(clean).length > 0 ? (clean as BoardDoc['tagLabels']) : undefined;
  }
  return parsed;
}
