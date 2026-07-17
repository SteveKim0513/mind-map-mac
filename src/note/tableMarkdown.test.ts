import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { TableMarkdown } from './tableMarkdown';

// GFM tables are parsed by markdown-it on load (tiptap-markdown uses it under the
// hood), so re-parsing the serializer's output with markdown-it faithfully
// reproduces the load-path round-trip — and stays free of the store-coupled
// renderMarkdown import so this file runs in isolation.
const md = new MarkdownIt();
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;

// ── Minimal PM-node stand-ins ─────────────────────────────────────────────
// The serializer only touches childCount / textContent / forEach and hands each
// leaf block to state.renderInline — a tiny tree exercises it without spinning up
// a ProseMirror editor (jsdom-free, deterministic).
type N = {
  childCount: number;
  textContent: string;
  forEach: (fn: (c: N, offset: number, index: number) => void) => void;
};
const leaf = (text: string): N => ({ childCount: 0, textContent: text, forEach: () => {} });
const container = (children: N[], textContent = ''): N => ({
  childCount: children.length,
  textContent,
  forEach: (fn) => children.forEach((c, i) => fn(c, i, i)),
});
const cell = (text: string): N => container([leaf(text)], text); // one paragraph block
const row = (texts: string[]): N => container(texts.map(cell));
const table = (rows: string[][]): N => container(rows.map(row));

// Faithful stand-in for prosemirror-markdown's serializer state. CRITICAL: the
// real renderInline appends inline text straight to state.out (via text()/esc),
// NOT through write's content arg, and it calls write() with NO argument to flush
// block delimiters. An earlier fix that wrapped state.write crashed on that no-arg
// call and never escaped the text — a mock that routed text through write(text)
// hid it. This mock mirrors the real path so the serializer is genuinely exercised.
function makeState() {
  const state = {
    inTable: false,
    out: '',
    write(s?: string) {
      if (s) this.out += s; // real write() is also called with no args (delimiter flush)
    },
    renderInline(node: { textContent: string }) {
      this.write(); // no-arg flush, exactly as prosemirror-markdown's text() does
      this.out += node.textContent; // text lands directly in out, bypassing write's arg
    },
    ensureNewLine() {
      if (this.out.length && !this.out.endsWith('\n')) this.out += '\n';
    },
    closeBlock() {
      if (!this.out.endsWith('\n')) this.out += '\n';
    },
    get output() {
      return this.out;
    },
  };
  return state;
}

// Pull serialize() out of the extension's markdown storage (no editor needed).
function getSerialize() {
  const storage = (
    TableMarkdown as unknown as {
      config: {
        addStorage: (this: { parent?: () => unknown }) => {
          markdown: { serialize: (state: unknown, node: unknown) => void };
        };
      };
    }
  ).config.addStorage.call({ parent: () => ({}) });
  return storage.markdown.serialize;
}

function serializeTable(rows: string[][]): string {
  const state = makeState();
  getSerialize()(state, table(rows));
  return state.output;
}

describe('TableMarkdown serialize — pipe escaping (round-trip)', () => {
  it('a cell containing "x|y" survives serialize → re-parse (table not destroyed)', () => {
    const out = serializeTable([['h1', 'h2'], ['x|y', 'b']]);

    // the literal pipe must be escaped in the serialized markdown, not left raw
    expect(out).toContain('x\\|y');
    // still one 2-col table: header, delimiter, body — exactly 3 lines
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('| --- | --- |');

    // re-parse with the same GFM parser notes load through
    const html = md.render(out);
    expect(count(html, 'table')).toBe(1); // not collapsed to a paragraph
    expect(count(html, 'th')).toBe(2);
    expect(count(html, 'td')).toBe(2); // 2 cols survive (pipe didn't add a column)
    expect(html).toContain('<td>x|y</td>'); // literal pipe restored in the cell
  });

  it('plain cells are unaffected (no stray escaping)', () => {
    const html = md.render(serializeTable([['이름', '값'], ['a', '1']]));
    expect(count(html, 'table')).toBe(1);
    expect(html).toContain('<td>a</td>');
    expect(html).toContain('<td>1</td>');
    expect(html).not.toContain('\\'); // no spurious backslash escapes
  });
});
