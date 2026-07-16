import { useEffect } from 'react';
import { useSession } from '../store/sessionStore';
import { useUi } from '../store/uiStore';

/**
 * Global keyboard shortcuts (standard mind-map scheme):
 *   Enter = sibling · Tab = child · Space/F2 = edit · Delete = remove
 *   arrows = navigate · ⌘/Ctrl+←/→ = collapse/expand
 * Disabled while editing (the textarea owns the keyboard then).
 */
export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = useSession.getState().activeStore();
      if (!store) return; // home screen — no active document
      const s = store.getState();

      // Never intercept while typing in a field. Check the event TARGET (not
      // document.activeElement): a field that blurs/closes on Enter (memo, link
      // input, pickers…) changes activeElement before this window handler runs,
      // which used to leak the Enter through to addSibling. e.target stays the field.
      if (s.editingId) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;

      const sel = s.selectedId;

      // ⌘C / ⌘V — copy / paste a subtree
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'v')) {
        if (e.key === 'c' && sel) {
          e.preventDefault();
          s.copyNode(sel);
          useUi.getState().toast('복사함');
        } else if (e.key === 'v') {
          e.preventDefault();
          if (s.hasClipboard()) {
            s.pasteNode(sel);
            useUi.getState().toast('붙여넣음');
          }
        }
        return;
      }

      // ⌘L — 선택 노드에 노트 연결. note↔node 통합(PRODUCT-DEFINITION 핵심경험 #2)을
      // 우클릭 메뉴 최하단이 아니라 키보드로 바로 도달하게 한다. 선택 없으면 무동작.
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        const node = sel ? s.doc.nodes[sel] : null;
        if (sel && node) {
          useUi.getState().openLinkNote({
            mapId: s.doc.id ?? '',
            nodeId: sel,
            nodeText: node.text,
            mapPath: s.filePath ?? '',
          });
        }
        return;
      }

      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          if (sel) s.addChild(sel);
          break;
        case 'Enter':
          e.preventDefault();
          // ⌘Enter — 결정 0014: 일반 노드는 할 일로 전환, 할 일 노드는 완료 토글.
          // (한 번 눌러 할 일로 만들고, 다시 눌러 완료)
          if (e.metaKey || e.ctrlKey) {
            if (sel) {
              const node = s.doc.nodes[sel];
              if (node && !node.todo) s.setTodo(sel, true);
              else if (node) s.toggleDone(sel);
            }
            break;
          }
          // Backup guard: ignore the Enter that just finished an edit (same key press
          // that committed the text), so the first Enter only selects the node.
          if (Date.now() - s.editCommittedAt < 50) break;
          // selected node → sibling below; empty canvas / no selection → new center topic
          if (sel) s.addSibling(sel);
          else s.addRoot();
          break;
        case ' ':
        case 'F2':
          e.preventDefault();
          if (sel) s.startEdit(sel);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelected();
          break;
        case 'ArrowUp':
          e.preventDefault();
          // ⌥↑ reorders among siblings; plain ↑ navigates
          if (e.altKey && sel) s.moveSibling(sel, 'up');
          else s.navigate('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.altKey && sel) s.moveSibling(sel, 'down');
          else s.navigate('down');
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          const n = sel ? s.doc.nodes[sel] : null;
          // ⌘/Ctrl+← collapses; plain ← navigates to parent
          if ((e.metaKey || e.ctrlKey) && n && n.children.length && !n.collapsed) s.toggleCollapse(sel!);
          else s.navigate('left');
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const n = sel ? s.doc.nodes[sel] : null;
          // ⌘/Ctrl+→ expands; plain → navigates to first child
          if ((e.metaKey || e.ctrlKey) && n && n.children.length && n.collapsed) s.toggleCollapse(sel!);
          else s.navigate('right');
          break;
        }
        case 'z':
        case 'Z':
          // Z (no modifier) → zoom to the selected subtree
          if (!e.metaKey && !e.ctrlKey && sel) {
            e.preventDefault();
            useUi.getState().zoomTo(sel);
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (s.focusRootId) s.setFocus(null);
          else if (s.colorFilter) s.setColorFilter(null);
          else s.select(null);
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
