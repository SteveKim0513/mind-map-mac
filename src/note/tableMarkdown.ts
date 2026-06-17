import { Table } from '@tiptap/extension-table';

/**
 * A Table that ALWAYS serializes to valid GFM markdown.
 *
 * tiptap-markdown's default table serializer drops the whole table to the literal
 * text `[table]` whenever the table isn't "markdown-serializable" — most commonly
 * when a cell holds more than one block (the user pressed Enter inside a cell) or
 * the header row isn't pure header cells. That silently destroyed the table on the
 * next save / tab switch (round-trip). GFM table cells are single-line, so we
 * flatten each cell's blocks onto one line instead of bailing out.
 */
// the tiptap-markdown serialize `state` isn't typed in this project
type SerState = {
  write: (s: string) => void;
  renderInline: (node: unknown) => void;
  ensureNewLine: () => void;
  closeBlock: (node: unknown) => void;
  inTable?: boolean;
};
interface PMNode {
  childCount: number;
  textContent: string;
  forEach: (fn: (child: PMNode, offset: number, index: number) => void) => void;
}

export const TableMarkdown = Table.extend({
  addStorage() {
    const parent = (this.parent?.() ?? {}) as Record<string, unknown>;
    return {
      ...parent,
      markdown: {
        serialize(state: SerState, node: PMNode) {
          state.inTable = true;
          node.forEach((row, _o, rowIdx) => {
            state.write('| ');
            row.forEach((cell, _o2, colIdx) => {
              if (colIdx) state.write(' | ');
              // GFM cells are single-line → render every block child on one line
              let wrote = false;
              cell.forEach((block) => {
                if (!block.textContent.trim()) return;
                if (wrote) state.write(' ');
                state.renderInline(block);
                wrote = true;
              });
            });
            state.write(' |');
            state.ensureNewLine();
            if (rowIdx === 0) {
              const delim = Array.from({ length: row.childCount }, () => '---').join(' | ');
              state.write(`| ${delim} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {}, // GFM tables are parsed by markdown-it (unchanged)
      },
    };
  },
});
