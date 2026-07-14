import type { NodeType } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { liftListItem } from 'prosemirror-schema-list';

type ListCommand = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/**
 * Outdent (Shift+Tab) the current list item without ProseMirror's default
 * surprise: prosemirror-schema-list's liftListItem, when the outdented item
 * has a *following* sibling in the same nested list, re-parents that sibling
 * under the outdented item instead of leaving it where it was —
 *
 *   - b1            - b1              - b1
 *     - b2            - b2              - b2
 *     - b3   Shift+Tab on b3  →       - b3   (b4 got dragged along as b3's child!)
 *     - b4                              - b4
 *
 * This makes the item you just outdented look like it "became its own
 * parent" out of nowhere, and repeated indent/outdent quickly turns a flat
 * list into an unpredictable tree. When there's no following sibling (the
 * common case — outdenting the last item in a nested group), the library's
 * default already does the right thing, so this only takes a different path
 * when a following sibling is actually at risk.
 */
export function outdentListItem(itemType: NodeType): ListCommand {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === itemType);
    if (!range) return false;
    const { depth, startIndex, endIndex } = range;
    // Only nested list items can be outdented at all; a single collapsed
    // cursor always yields a one-item range — anything wider (an actual
    // multi-item selection) falls back to the library default untouched.
    if (depth < 2 || $from.node(depth - 1).type !== itemType || endIndex - startIndex !== 1) {
      return liftListItem(itemType)(state, dispatch);
    }

    const endOfList = range.$to.end(depth);
    if (range.end >= endOfList) {
      // No following sibling — nothing for the default behavior to get wrong.
      return liftListItem(itemType)(state, dispatch);
    }

    if (!dispatch) return true;

    const parentItemPos = $from.before(depth - 1);
    const parentItem = $from.node(depth - 1);
    const parentItemEnd = parentItemPos + parentItem.nodeSize;
    // Where the cursor sits relative to the start of the node being moved —
    // preserved across the move so it doesn't snap to the wrong sibling.
    const cursorOffsetInLifted = $from.pos - range.start;

    const tr = state.tr;
    const liftedContent = tr.doc.slice(range.start, range.end).content;
    tr.delete(range.start, range.end);
    const insertAt = tr.mapping.map(parentItemEnd);
    tr.insert(insertAt, liftedContent);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + cursorOffsetInLifted)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
