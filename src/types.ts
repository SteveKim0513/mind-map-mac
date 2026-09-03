import type { TagKey } from './theme/palette';

/** A single mind-map node. Tree structure is encoded via parentId + children order. */
export interface MindNode {
  id: string;
  text: string;
  parentId: string | null; // null = this node is a root
  children: string[]; // ordered child ids
  collapsed: boolean; // when true, descendants are hidden
  // 할 일(todo) 노드 표식 — 완료·일정·집중은 todo 노드에서만 노출된다(결정 0014). 일반 노드는
  // 순수 생각. 선택 필드·가산이라 version 무범프(0012 선례); done/scheduled/reminderOn이 있으면
  // 로드 시 todo로 backfill(io/formats.ts).
  todo?: boolean;
  done?: boolean; // marked complete (strikethrough + faded) — only on todo nodes
  color?: string; // tag-palette key ('red'…'brown'); see theme/palette.ts
  icon?: string; // optional emoji/icon prefix
  note?: string; // optional long-form note
  link?: string; // legacy single URL (still editable via the note·link popover)
  links?: string[]; // attached URLs shown as satellites
  // ── Schedule / Reminders sync ──
  scheduled?: boolean; // marked as a schedule node (shows date + reminder options)
  scheduleAt?: string; // local-time ISO ("2026-06-15T09:00:00"); date/time of the schedule
  // Time-block length in minutes (calendar time-grid). Optional & additive — the
  // schema `version` stays 1 (decision 0012). Local-only: NOT synced to Reminders
  // (they have no duration concept); only meaningful for timed (hasTime) events.
  durationMin?: number;
  // "종일" vs explicit-time disambiguation. scheduleAt "...T00:00:00" is ambiguous
  // (all-day OR a deliberately-typed midnight, e.g. "@오전 12시"); allDay pins it.
  // Optional & additive — schema `version` stays 1 (decision 0012). undefined →
  // derive from the time component (00:00 = all-day), so every pre-existing doc
  // keeps its current behaviour.
  allDay?: boolean;
  reminderOn?: boolean; // user wants this node mirrored to macOS Reminders
  reminderId?: string; // external Reminders id once created (sync key)
  reminderSyncedAt?: number; // ms — reminder's modification date at last reconcile
  updatedAt?: number; // ms — last local edit to a synced field (title/done/scheduleAt)
  // Last agreed (synced) reminder content — the base for content-based change
  // detection: a field changed iff its current value differs from this snapshot.
  reminderBase?: { title: string; due: string | null; done: boolean };
  // Roots only: a manual anchor position (world coords). When set, the whole tree
  // is auto-laid-out relative to this point instead of being auto-stacked.
  manualPos?: { x: number; y: number };
}

/** A free cross-link between two nodes (separate from the parent-child tree). */
export interface Connection {
  id: string;
  from: string; // node id
  to: string; // node id
  note?: string; // optional memo shown on the line
  // memo position (world coords). When set, the line routes through it.
  labelPos?: { x: number; y: number };
}

/** A labelled region drawn around a set of nodes. Its box follows the members. */
export interface Section {
  id: string;
  nodeIds: string[]; // member nodes — the region hugs these
  title?: string;
  color?: string; // tag-palette key — see theme/palette.ts
  labelPos?: { x: number; y: number }; // draggable title position (world coords)
}

/** The full document — a flat node map plus an ordered list of roots. */
export interface MindMapDoc {
  version: 1;
  // Stable document id — survives file rename/move so notes can link to a node
  // by (mapId, nodeId). Backfilled on load for older files.
  id?: string;
  rootIds: string[]; // supports multiple root topics on one canvas
  nodes: Record<string, MindNode>;
  connections?: Connection[]; // node-to-node cross links
  sections?: Section[]; // grouping regions
  // 색상 태그 범례(2026-09-03): 이 맵에서 각 태그 키에 붙인 사용자 라벨. 문서별로
  // 독립 저장 — 다른 맵과 공유되지 않는다. 옵션·가산 필드라 version 무범프(결정
  // 0012 선례). 값이 없는 키는 theme/palette.ts의 TAG_DEFAULT_LABELS로 대체 표시.
  tagLabels?: Partial<Record<TagKey, string>>;
  view: { zoom: number; panX: number; panY: number };
}

/** A link from a note to one specific mind-map node. Stored only in the note. */
export interface NoteLink {
  mapId: string; // MindMapDoc.id of the target map (stable match key)
  nodeId: string; // MindNode.id within that map
  nodeText?: string; // snapshot of the node's text (for display when map isn't open)
  mapPath?: string; // best-effort file path hint, to open the map when it isn't already
}

/** A focus-session record stamped into a note's frontmatter. The note IS the
 *  session log; this struct is the structured truth the dashboard aggregates.
 *  Times are epoch ms (not local ISO) so duration survives sleep / DST / TZ. */
export interface FocusSession {
  sessionId: string; // unique — dedup key (a copied note must not double-count)
  link: NoteLink; // node attribution, reusing the note-link identity/recovery
  ancestorIds: string[]; // node's ancestor chain (root→parent) for subtree roll-up
  ancestorTexts: string[]; // snapshot labels for those ancestors (display when map gone)
  start: number; // epoch ms
  end: number | null; // epoch ms; null while running
  durationSec: number; // 0 while running; (end-start)/1000 once ended
  goal?: string; // the "🎯" line from the note body, snapshotted at end (goal vs outcome)
  reflect?: string; // optional one-line reflection (outcome) captured at end
  estimated?: boolean; // end was inferred (abnormal exit), not user-confirmed
  idleSec?: number; // IF-07 · seconds idle/away during the session; durationSec stays honest wall-clock
}

/** A standalone note document, stored as a Markdown file (.md) with frontmatter. */
export interface NoteDoc {
  id: string; // stable note id (frontmatter)
  title: string;
  body: string; // Markdown body
  links: NoteLink[]; // nodes this note is linked to
  session?: FocusSession; // present iff this is a focus-session note (read-only meta)
  metaBlocks?: NoteMetaBlock[];
}

/** Lightweight note record for the workspace link index (frontmatter only). */
export interface NoteMeta {
  path: string;
  id: string;
  title: string;
  links: NoteLink[];
  session?: FocusSession; // carried so the dashboard aggregates from the index, no re-scan
  refs?: string[]; // lowercased titles this note's body wiki-links to ([[ ]]) — powers backlinks
}

/** A node with its computed on-canvas position. `x` is the node's LEFT edge;
 * `y` is its vertical center. `width` is the measured (or estimated) box width. */
export interface PositionedNode {
  node: MindNode;
  x: number;
  y: number;
  width: number;
  depth: number;
  rootId: string; // id of the root this node belongs to
  hiddenCount: number; // descendants hidden under this node when collapsed (else 0)
  childDone: number; // direct children marked done
  childTotal: number; // direct children count
}

export type MetaFieldType = 'text' | 'date' | 'select' | 'url' | 'number';

export interface MetaFieldDef {
  key: string;
  label: string;
  type: MetaFieldType;
  options?: string[];
}

export interface MetaTemplate {
  id: string;
  name: string;
  fields: MetaFieldDef[];
}

export interface NoteMetaBlock {
  templateId: string;
  values: Record<string, string>;
}

/** A computed edge between two node centers. */
export interface PositionedEdge {
  id: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
  rootId: string; // id of the root this edge belongs to
  depth: number; // depth of the parent (drives connector thickness/hierarchy)
}

// ── Board (moodboard) — free-placement canvas, decision 0020 ──────────────────
// A third, independent file type (.board). No tree structure: elements sit at
// absolute world coordinates. `BoardDoc.order` is the z-order (back→front) —
// the single source of truth for stacking, same "flat record + ordered id
// list" shape as MindMapDoc's nodes/rootIds.
//
// v1 redesigned around "sticky notes + arrows" (2026-09-03 UX feedback): plain
// shapes/text boxes were dropped, and connectors are never freestanding — they
// always attach two elements by id + anchor side, so they follow when either
// end moves (geometry is derived at render time, never stored as fixed points).

export type BoardElementKind = 'sticky' | 'image' | 'connector';

interface BoardBoxElement {
  id: string;
  x: number; // world coords, top-left
  y: number;
  width: number;
  height: number;
  rotation?: number; // degrees, optional (0 when absent)
}

/** Outline shape of a sticky note — a second, filterable tag axis alongside
 *  `color` (same UX as the color filter: pick one, board dims everything else). */
export type StickyShape = 'rect' | 'ellipse';

export type StickyAlign = 'left' | 'center' | 'right';
export type StickyValign = 'top' | 'middle' | 'bottom';
export type StickyFontSize = 'small' | 'medium' | 'large';

export interface BoardStickyElement extends BoardBoxElement {
  kind: 'sticky';
  text: string;
  color?: string; // tag-palette key (background) — see theme/palette.ts
  shape?: StickyShape; // default 'rect' when absent
  align?: StickyAlign; // horizontal, default 'left' when absent
  valign?: StickyValign; // vertical, default 'top' when absent
  fontSize?: StickyFontSize; // default 'medium' when absent
  bold?: boolean;
  // Extra text blocks stacked BELOW the sticky's own box (2026-09-03 UX
  // feedback) — visually outside the main card, but permanently fused to it:
  // always part of THIS sticky, move/select/delete with it, never an
  // independent, separately-positioned element. Any number, stacking downward.
  notes?: string[];
  // ── Board ↔ mindmap linking (2026-09-03) ── forward references stored on
  // the sticky itself, mirroring the note↔node "연동" entry point but
  // one-directional and un-indexed: no reverse lookup, no rename/delete GC
  // hooks (board/boardLinks.ts resolves lazily and degrades gracefully — same
  // "stale hint, fall back, toast on failure" shape as NoteLink.mapPath).
  nodeLink?: NoteLink; // links this sticky to a mindmap node
  noteLink?: BoardNoteRef; // links this sticky to a note file
}

/** A sticky's forward reference to a note file — see `BoardStickyElement.noteLink`. */
export interface BoardNoteRef {
  notePath: string;
  title?: string; // cached label snapshot; may go stale if the note is renamed
}

/** `src` is a path relative to the board file, resolved against its own
 *  `.{stem}.assets/` hidden folder — same convention as note images (decision 0010). */
export interface BoardImageElement extends BoardBoxElement {
  kind: 'image';
  src: string;
  alt?: string;
}

/** One of a connector's four attachment points on an element's bounding box
 *  (mid-edge, regardless of the element's own outline shape). */
export type BoardAnchorSide = 'top' | 'right' | 'bottom' | 'left';

/** An arrow between two existing elements, referenced by id — never a free-
 *  floating line (2026-09-03 UX feedback). Endpoint coordinates are always
 *  derived from the current `fromId`/`toId` element boxes, so the arrow
 *  follows automatically when either element moves. */
export interface BoardConnectorElement {
  id: string;
  kind: 'connector';
  fromId: string;
  fromAnchor: BoardAnchorSide;
  toId: string;
  toAnchor: BoardAnchorSide;
  arrow?: boolean; // arrowhead at the `to` end — default true when absent
  color?: string;
  label?: string; // short caption shown at the path's midpoint (e.g. "왜냐하면")
}

export type BoardElement = BoardStickyElement | BoardImageElement | BoardConnectorElement;

/** A standalone moodboard document, stored as JSON (.board). */
export interface BoardDoc {
  version: 1;
  id?: string; // stable doc id, backfilled on load (parity with MindMapDoc.id)
  elements: Record<string, BoardElement>;
  order: string[]; // z-order, back→front
  // Per-board label for each tag color key — same TagBar UX as MindMapDoc.tagLabels
  // (색상 태그 범례, 2026-09-03). Independent per file, not shared with maps.
  tagLabels?: Partial<Record<TagKey, string>>;
  view: { zoom: number; panX: number; panY: number };
}
