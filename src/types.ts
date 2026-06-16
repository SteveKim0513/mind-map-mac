/** A single mind-map node. Tree structure is encoded via parentId + children order. */
export interface MindNode {
  id: string;
  text: string;
  parentId: string | null; // null = this node is a root
  children: string[]; // ordered child ids
  collapsed: boolean; // when true, descendants are hidden
  done?: boolean; // marked complete (strikethrough + faded)
  color?: string; // tag-palette key ('red'…'brown'); see theme/palette.ts
  icon?: string; // optional emoji/icon prefix
  note?: string; // optional long-form note
  link?: string; // legacy single URL (still editable via the note·link popover)
  links?: string[]; // attached URLs shown as satellites
  // ── Schedule / Reminders sync ──
  scheduled?: boolean; // marked as a schedule node (shows date + reminder options)
  scheduleAt?: string; // local-time ISO ("2026-06-15T09:00:00"); date/time of the schedule
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
}

/** A standalone note document, stored as a Markdown file (.md) with frontmatter. */
export interface NoteDoc {
  id: string; // stable note id (frontmatter)
  title: string;
  body: string; // Markdown body
  links: NoteLink[]; // nodes this note is linked to
  session?: FocusSession; // present iff this is a focus-session note (read-only meta)
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

/** A computed edge between two node centers. */
export interface PositionedEdge {
  id: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
  rootId: string; // id of the root this edge belongs to
  depth: number; // depth of the parent (drives connector thickness/hierarchy)
}
