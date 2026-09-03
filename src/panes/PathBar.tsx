import { useState } from 'react';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import { fileDisplayName } from '../io/fileKind';
import { Icon } from '../ui/Icon';
import { tabIconName } from './TabBar';
import type { Tab } from '../store/sessionStore';

interface Segment {
  label: string;
  fullPath: string;
  isFile: boolean;
}

// workspace-root-relative folder breadcrumb for `path` — [] when the tab has no
// real path yet (calendar) or sits outside the workspace root.
function segmentsFor(path: string, root: string): Segment[] {
  if (!root || !path.startsWith(`${root}/`)) return [];
  const parts = path.slice(root.length + 1).split('/');
  let cur = root;
  return parts.map((part, i) => {
    cur = `${cur}/${part}`;
    const isFile = i === parts.length - 1;
    return { label: isFile ? fileDisplayName(part) : part, fullPath: cur, isFile };
  });
}

// Deep paths would otherwise overflow the bar and push the filename (the part
// that actually matters) out of view. Keep the top-level folder and the
// immediate parent + filename always visible; collapse everything between
// them into a single "…" that expands inline on click.
function visibleSegments(segs: Segment[], expandedAll: boolean): (Segment | 'ellipsis')[] {
  if (expandedAll || segs.length <= 3) return segs;
  return [segs[0], 'ellipsis', segs[segs.length - 2], segs[segs.length - 1]];
}

function PathBarSide({ tab }: { tab: Tab | null }) {
  const root = useWorkspace((s) => s.root);
  const [expandedAll, setExpandedAll] = useState(false);
  const segs = tab && tab.kind !== 'calendar' ? segmentsFor(tab.path, root) : [];
  const shown = visibleSegments(segs, expandedAll);

  return (
    <div className="pathbar-side" title={tab?.kind !== 'calendar' ? tab?.path : undefined}>
      {shown.map((seg, i) => (
        <span key={seg === 'ellipsis' ? 'ellipsis' : seg.fullPath} className="pathbar-seg">
          {i > 0 && (
            <span className="pathbar-sep">
              <Icon name="chevronRight" />
            </span>
          )}
          {seg === 'ellipsis' ? (
            <button
              className="pathbar-crumb pathbar-ellipsis"
              title="전체 경로 보기"
              onClick={() => setExpandedAll(true)}
            >
              …
            </button>
          ) : (
            <button className="pathbar-crumb" onClick={() => useUi.getState().revealInSidebar(seg.fullPath)}>
              {seg.isFile && tab && (
                <span className={`pathbar-ic tab-ic--${tab.kind}`}>
                  <Icon name={tabIconName(tab.kind)} />
                </span>
              )}
              {seg.label || '제목 없음'}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

interface Props {
  leftTab: Tab | null;
  rightTab: Tab | null;
  split: boolean;
}

/** Finder-style path bar under the tab strip — shows the open file's folder
 *  location so files that share a name (e.g. duplicate 기획 문서 in different
 *  folders) stay distinguishable at a glance. Mirrors TabBar's split layout. */
export function PathBar({ leftTab, rightTab, split }: Props) {
  return (
    <div className={`pathbar${split ? ' split' : ''}`}>
      {/* keyed by path: switching tabs resets a side back to its collapsed state */}
      <PathBarSide key={leftTab?.path ?? 'left-empty'} tab={leftTab} />
      {split && <div className="pathbar-div" />}
      {split && <PathBarSide key={rightTab?.path ?? 'right-empty'} tab={rightTab} />}
    </div>
  );
}
