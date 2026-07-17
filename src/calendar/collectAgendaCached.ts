// IF-10 — cached workspace agenda scan for the calendar.
//
// Same result as focus/collectAgenda: open maps win (freshest, live done/text),
// then every on-disk .mind contributes its scheduled nodes (deduped by
// mapId/nodeId so a closed copy never doubles an open map). The only difference
// is the disk reads go through the shared mtime-keyed scan cache (src/search/
// scanCache), so re-opening the calendar only re-parses .mind files whose mtime
// changed. The cache is shared with global search, so opening one warms the
// other.

import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import type { MapStore } from '../store/mapStore';
import type { TreeNode } from '../../electron/preload';
import { parseSchedule, type AgendaItem } from '../focus/agenda';
import { loadMindDoc, pruneMindCache, type FileRef } from '../io/scanCache';

function openMaps(): MapStore[] {
  return useSession.getState().tabs.filter((t) => t.kind === 'map').map((t) => t.store as MapStore);
}

function collectMindFiles(tree: TreeNode[], out: FileRef[] = []): FileRef[] {
  for (const n of tree) {
    if (n.type === 'dir' && n.children) collectMindFiles(n.children, out);
    else if (n.type === 'file' && n.path.endsWith('.mind')) out.push({ path: n.path, mtimeMs: n.mtimeMs });
  }
  return out;
}

export async function collectAgendaCached(): Promise<AgendaItem[]> {
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

  // Open maps are AUTHORITATIVE for their own nodes — record their path + doc id so
  // we don't also read the on-disk copy. The per-node dedup below can't protect a
  // node the open pass intentionally OMITS: e.g. a schedule just cleared in the live
  // map isn't added here, so a stale/unsaved on-disk copy (still `scheduled`) would
  // re-add it and the item would linger on the calendar. Skipping the whole file for
  // any open map fixes that.
  const openPaths = new Set<string>();
  const openMapIds = new Set<string>();
  for (const st of openMaps()) {
    const s = st.getState();
    const doc = s.doc;
    if (s.filePath) openPaths.add(s.filePath);
    if (doc.id) openMapIds.add(doc.id);
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      if (n.scheduled && n.scheduleAt)
        add(doc.id ?? '', id, n.text, n.scheduleAt, !!n.done, n.durationMin, n.allDay, s.filePath ?? undefined);
    }
  }

  // On-disk .mind files via the mtime-keyed cache; drop entries for deleted files.
  const files = collectMindFiles(useWorkspace.getState().tree);
  pruneMindCache(files.map((f) => f.path));
  for (const f of files) {
    if (openPaths.has(f.path)) continue; // this map is open → live state already used
    const doc = await loadMindDoc(f.path, f.mtimeMs);
    if (!doc) continue; // unreadable / corrupt → skip (same as before)
    if (doc.id && openMapIds.has(doc.id)) continue; // same open map via a different path
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      if (n.scheduled && n.scheduleAt) add(doc.id ?? '', id, n.text, n.scheduleAt, !!n.done, n.durationMin, n.allDay, f.path);
    }
  }
  return out;
}
