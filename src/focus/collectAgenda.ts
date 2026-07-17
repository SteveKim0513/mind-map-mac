// Collect every scheduled node across the workspace (open maps + on-disk .mind)
// into AgendaItems. Open maps win (freshest, with live done/text). I/O side of
// the "오늘" view; the grouping is pure in agenda.ts.

import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import type { MapStore } from '../store/mapStore';
import type { TreeNode } from '../../electron/preload';
import { deserialize } from '../io/formats';
import { parseSchedule, type AgendaItem } from './agenda';

function openMaps(): MapStore[] {
  return useSession.getState().tabs.filter((t) => t.kind === 'map').map((t) => t.store as MapStore);
}

function collectMindPaths(tree: TreeNode[], out: string[] = []): string[] {
  for (const n of tree) {
    if (n.type === 'dir' && n.children) collectMindPaths(n.children, out);
    else if (n.type === 'file' && n.path.endsWith('.mind')) out.push(n.path);
  }
  return out;
}

export async function collectAgenda(): Promise<AgendaItem[]> {
  const out: AgendaItem[] = [];
  const seen = new Set<string>();
  const add = (
    mapId: string,
    nodeId: string,
    text: string,
    scheduleAt: string,
    done: boolean,
    durationMin: number | undefined,
    allDay: boolean | undefined,
    mapPath?: string,
  ) => {
    const k = `${mapId} ${nodeId}`;
    if (seen.has(k)) return;
    seen.add(k);
    const { at, hasTime } = parseSchedule(scheduleAt, allDay);
    out.push({ mapId, nodeId, text: text || '(이름 없음)', scheduleAt, at, hasTime, done: !!done, durationMin, mapPath });
  };

  for (const st of openMaps()) {
    const s = st.getState();
    const doc = s.doc;
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      if (n.scheduled && n.scheduleAt)
        add(doc.id ?? '', id, n.text, n.scheduleAt, !!n.done, n.durationMin, n.allDay, s.filePath ?? undefined);
    }
  }
  for (const p of collectMindPaths(useWorkspace.getState().tree)) {
    try {
      const doc = deserialize(await window.api.readFile(p));
      for (const id in doc.nodes) {
        const n = doc.nodes[id];
        if (n.scheduled && n.scheduleAt) add(doc.id ?? '', id, n.text, n.scheduleAt, !!n.done, n.durationMin, n.allDay, p);
      }
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}
