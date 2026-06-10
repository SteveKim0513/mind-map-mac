/** A single mind-map node. Tree structure is encoded via parentId + children order. */
export interface MindNode {
  id: string;
  text: string;
  parentId: string | null; // null = this node is a root
  children: string[]; // ordered child ids
  collapsed: boolean; // when true, descendants are hidden
  done?: boolean; // marked complete (strikethrough + faded)
  color?: string; // optional sticker-palette color tag (left accent bar)
  icon?: string; // optional emoji/icon prefix
  note?: string; // optional long-form note
  link?: string; // optional URL
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
  color?: string;
  labelPos?: { x: number; y: number }; // draggable title position (world coords)
}

/** The full document — a flat node map plus an ordered list of roots. */
export interface MindMapDoc {
  version: 1;
  rootIds: string[]; // supports multiple root topics on one canvas
  nodes: Record<string, MindNode>;
  connections?: Connection[]; // node-to-node cross links
  sections?: Section[]; // grouping regions
  view: { zoom: number; panX: number; panY: number };
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
