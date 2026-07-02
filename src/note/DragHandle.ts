import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { ResolvedPos } from '@tiptap/pm/model';

const dragHandleKey = new PluginKey<DragHandleState>('dragHandle');

interface DragHandleState {
  decorations: DecorationSet;
  dragFromPos: number | null;
}

/** Find the top-level (depth=1) node position that contains the given resolved pos. */
function findTopLevelNodePos(
  $pos: ResolvedPos
): { start: number; end: number; pos: number } | null {
  // depth=0 is the doc, depth=1 is the top-level block
  if ($pos.depth === 0) return null;
  const depth = 1;
  const start = $pos.start(depth);
  const end = $pos.end(depth);
  const pos = $pos.before(depth);
  return { start, end, pos };
}

/** Given a Y coordinate, find the nearest top-level node boundary for dropping. */
function findDropTarget(
  view: EditorView,
  event: DragEvent
): number | null {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;

  const $pos = view.state.doc.resolve(coords.pos);
  const info = findTopLevelNodePos($pos);
  if (!info) return null;

  // Decide whether to insert before or after the node based on vertical midpoint
  const domNode = view.nodeDOM(info.pos);
  if (!domNode || !(domNode instanceof HTMLElement)) {
    return info.pos;
  }
  const rect = domNode.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  return event.clientY < mid ? info.pos : info.pos + view.state.doc.nodeAt(info.pos)!.nodeSize;
}

function createHandleDOM(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'drag-handle';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('draggable', 'true');
  el.textContent = '⠿';
  return el;
}

function createDropIndicatorDOM(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'drop-indicator';
  return el;
}

export const DragHandle = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    let dragFromPos: number | null = null;
    let dropTargetPos: number | null = null;
    let hoveredNodePos: number | null = null;

    const plugin: Plugin<DragHandleState> = new Plugin<DragHandleState>({
      key: dragHandleKey,

      state: {
        init() {
          return { decorations: DecorationSet.empty, dragFromPos: null };
        },
        apply(tr, value) {
          const meta = tr.getMeta(dragHandleKey) as Partial<DragHandleState> | undefined;
          if (meta) {
            return {
              decorations: meta.decorations ?? value.decorations,
              dragFromPos: meta.dragFromPos !== undefined ? meta.dragFromPos : value.dragFromPos,
            };
          }
          if (tr.docChanged) {
            return {
              decorations: value.decorations.map(tr.mapping, tr.doc),
              dragFromPos: value.dragFromPos,
            };
          }
          return value;
        },
      },

      props: {
        decorations(state) {
          return dragHandleKey.getState(state)?.decorations ?? DecorationSet.empty;
        },

        handleDOMEvents: {
          mousemove(view, event) {
            const coords = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (!coords) return false;

            const $pos = view.state.doc.resolve(coords.pos);
            const info = findTopLevelNodePos($pos);

            if (!info) {
              // Clear decorations if we leave all nodes
              if (hoveredNodePos !== null) {
                hoveredNodePos = null;
                view.dispatch(
                  view.state.tr.setMeta(dragHandleKey, {
                    decorations: DecorationSet.empty,
                    dragFromPos: null,
                  })
                );
              }
              return false;
            }

            if (hoveredNodePos === info.pos) return false;
            hoveredNodePos = info.pos;

            const handleEl = createHandleDOM();
            const nodePos = info.pos;

            // Attach drag start on mousedown (inside the handle element)
            handleEl.addEventListener('mousedown', (e) => {
              e.preventDefault(); // prevent text selection
              dragFromPos = nodePos;
            });

            const deco = Decoration.widget(info.start, handleEl, {
              side: -1,
              key: `drag-handle-${info.pos}`,
            });

            view.dispatch(
              view.state.tr.setMeta(dragHandleKey, {
                decorations: DecorationSet.create(view.state.doc, [deco]),
                dragFromPos: null,
              })
            );

            return false;
          },

          mouseleave(view) {
            hoveredNodePos = null;
            view.dispatch(
              view.state.tr.setMeta(dragHandleKey, {
                decorations: DecorationSet.empty,
                dragFromPos: null,
              })
            );
            return false;
          },

          dragstart(view, event) {
            if (dragFromPos === null) return false;

            const dragEvent = event as DragEvent;
            const node = view.state.doc.nodeAt(dragFromPos);
            if (!node) {
              dragFromPos = null;
              return false;
            }

            // Set drag data for the HTML drag API
            if (dragEvent.dataTransfer) {
              dragEvent.dataTransfer.effectAllowed = 'move';
              dragEvent.dataTransfer.setData('text/plain', node.textContent);
            }

            // Create an invisible ghost element so the default drag image doesn't show text
            const ghost = document.createElement('div');
            ghost.style.cssText =
              'position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0';
            document.body.appendChild(ghost);
            dragEvent.dataTransfer?.setDragImage(ghost, 0, 0);
            setTimeout(() => ghost.remove(), 0);

            return false;
          },

          dragover(view, event) {
            if (dragFromPos === null) return false;

            const dragEvent = event as DragEvent;
            dragEvent.preventDefault();
            if (dragEvent.dataTransfer) {
              dragEvent.dataTransfer.dropEffect = 'move';
            }

            const target = findDropTarget(view, dragEvent);
            if (target === null || target === dropTargetPos) return false;
            dropTargetPos = target;

            // Build combined decorations: hover handle + drop indicator
            const pluginState = dragHandleKey.getState(view.state);
            const existingDecos = pluginState?.decorations ?? DecorationSet.empty;

            const indicatorEl = createDropIndicatorDOM();
            const indicatorDeco = Decoration.widget(target, indicatorEl, {
              side: -1,
              key: 'drop-indicator',
            });

            // Rebuild with existing handle + new indicator
            const allDecos = existingDecos.find().filter((d) => d.spec.key !== 'drop-indicator');
            allDecos.push(indicatorDeco);

            view.dispatch(
              view.state.tr.setMeta(dragHandleKey, {
                decorations: DecorationSet.create(view.state.doc, allDecos),
              })
            );

            return false;
          },

          dragleave(view) {
            if (dragFromPos === null) return false;

            dropTargetPos = null;
            // Keep handle deco, remove only indicator
            const pluginState = dragHandleKey.getState(view.state);
            const decos = (pluginState?.decorations ?? DecorationSet.empty)
              .find()
              .filter((d) => d.spec.key !== 'drop-indicator');

            view.dispatch(
              view.state.tr.setMeta(dragHandleKey, {
                decorations: DecorationSet.create(view.state.doc, decos),
              })
            );

            return false;
          },

          drop(view, event) {
            if (dragFromPos === null) return false;

            const dragEvent = event as DragEvent;
            dragEvent.preventDefault();

            const from = dragFromPos;
            const target = findDropTarget(view, dragEvent);

            // Reset state regardless of success
            dragFromPos = null;
            dropTargetPos = null;
            hoveredNodePos = null;

            // Clear all decorations
            view.dispatch(
              view.state.tr.setMeta(dragHandleKey, {
                decorations: DecorationSet.empty,
                dragFromPos: null,
              })
            );

            if (target === null) return false;

            const node = view.state.doc.nodeAt(from);
            if (!node) return false;

            const nodeSize = node.nodeSize;
            const to = from + nodeSize;

            // Don't drop onto itself
            if (target >= from && target <= to) return false;

            // Compute adjusted insert position after deletion
            let insertAt = target > to ? target - nodeSize : target;

            const tr = view.state.tr;
            // Delete the source node then insert at target
            tr.delete(from, to);
            tr.insert(insertAt, node);
            tr.scrollIntoView();
            view.dispatch(tr);

            return true;
          },
        },
      },
    });

    return [plugin];
  },
});
