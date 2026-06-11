import type { MindMapDoc, MindNode } from '../types';
import { normalizeColor } from '../theme/palette';

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyDoc(): MindMapDoc {
  // Start on a blank canvas — the first Enter creates the center topic.
  return {
    version: 1,
    id: newId(),
    rootIds: [],
    nodes: {},
    view: { zoom: 1, panX: 0, panY: 0 },
  };
}

// ── .mind (JSON) ──────────────────────────────────────────────────────────────

export function serialize(doc: MindMapDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function deserialize(text: string): MindMapDoc {
  let parsed: MindMapDoc;
  try {
    parsed = JSON.parse(text) as MindMapDoc;
  } catch {
    throw new Error('파일을 열 수 없습니다 — 손상된 마인드맵');
  }
  if (!parsed || !parsed.nodes || !parsed.rootIds) throw new Error('Invalid .mind file');
  // Backfill defaults defensively.
  parsed.id ??= newId(); // stable doc id (persisted on next save) for note links
  for (const n of Object.values(parsed.nodes)) {
    n.children ??= [];
    n.collapsed ??= false;
    if (n.color) n.color = normalizeColor(n.color); // legacy raw-hex tags → semantic keys
  }
  for (const s of parsed.sections ?? []) if (s.color) s.color = normalizeColor(s.color);
  parsed.view ??= { zoom: 1, panX: 0, panY: 0 };
  return parsed;
}

// ── Tree walking helper ─────────────────────────────────────────────────────

interface PlainNode {
  text: string;
  children: PlainNode[];
}

function toPlainTree(doc: MindMapDoc): PlainNode[] {
  const build = (id: string): PlainNode => {
    const n = doc.nodes[id];
    return { text: n.text, children: n.children.map(build) };
  };
  return doc.rootIds.map(build);
}

function fromPlainTree(roots: PlainNode[]): MindMapDoc {
  const nodes: Record<string, MindNode> = {};
  const rootIds: string[] = [];
  const add = (p: PlainNode, parentId: string | null): string => {
    const id = newId();
    const node: MindNode = {
      id,
      text: p.text,
      parentId,
      children: [],
      collapsed: false,
    };
    nodes[id] = node;
    node.children = p.children.map((c) => add(c, id));
    return id;
  };
  for (const r of roots) rootIds.push(add(r, null));
  if (rootIds.length === 0) return emptyDoc();
  return { version: 1, rootIds, nodes, view: { zoom: 1, panX: 0, panY: 0 } };
}

// ── Markdown (indented bullet list) ──────────────────────────────────────────

export function toMarkdown(doc: MindMapDoc): string {
  const lines: string[] = [];
  const walk = (p: PlainNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${p.text.replace(/\n/g, ' ')}`);
    p.children.forEach((c) => walk(c, depth + 1));
  };
  toPlainTree(doc).forEach((r) => walk(r, 0));
  return lines.join('\n') + '\n';
}

export function fromMarkdown(text: string): MindMapDoc {
  const roots: PlainNode[] = [];
  // stack of { indent, node }
  const stack: { indent: number; node: PlainNode }[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (!m) continue;
    const indent = m[1].replace(/\t/g, '  ').length;
    const node: PlainNode = { text: m[2].trim(), children: [] };

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ indent, node });
  }
  return fromPlainTree(roots);
}

// ── OPML ──────────────────────────────────────────────────────────────────────

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toOpml(doc: MindMapDoc): string {
  const walk = (p: PlainNode, depth: number): string => {
    const indent = '  '.repeat(depth + 2);
    const attr = `text="${escapeAttr(p.text)}"`;
    if (p.children.length === 0) return `${indent}<outline ${attr}/>`;
    const inner = p.children.map((c) => walk(c, depth + 1)).join('\n');
    return `${indent}<outline ${attr}>\n${inner}\n${indent}</outline>`;
  };
  const body = toPlainTree(doc)
    .map((r) => walk(r, 0))
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>MindMap</title>
  </head>
  <body>
${body}
  </body>
</opml>
`;
}

export function fromOpml(text: string): MindMapDoc {
  const dom = new DOMParser().parseFromString(text, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('Invalid OPML file');
  const body = dom.querySelector('body');
  if (!body) throw new Error('OPML has no <body>');

  const walk = (el: Element): PlainNode => ({
    text: el.getAttribute('text') ?? el.getAttribute('title') ?? '',
    children: Array.from(el.children)
      .filter((c) => c.tagName.toLowerCase() === 'outline')
      .map(walk),
  });

  const roots = Array.from(body.children)
    .filter((c) => c.tagName.toLowerCase() === 'outline')
    .map(walk);
  return fromPlainTree(roots);
}
