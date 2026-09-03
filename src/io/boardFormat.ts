import type { BoardDoc } from '../types';
import { newId } from './formats';
import { TAG_KEYS } from '../theme/palette';

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
