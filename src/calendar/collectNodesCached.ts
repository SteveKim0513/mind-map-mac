// Workspace-wide node scan for the SchedulePicker (§3.3) — every node in every
// open map + on-disk .mind, so an existing node can be searched and scheduled
// from the calendar. Mirrors collectAgendaCached but keeps ALL nodes (not just
// scheduled), and reuses the same shared mtime-keyed scan cache (io/scanCache),
// so opening the picker after the calendar re-parses nothing.

import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import type { MapStore } from '../store/mapStore';
import type { TreeNode } from '../../electron/preload';
import { loadMindDoc, pruneMindCache, type FileRef } from '../io/scanCache';

export interface NodeRef {
  mapId: string;
  nodeId: string;
  text: string;
  mapPath?: string;
  mapName: string; // file basename without extension, for the picker's map hint
  scheduled: boolean; // already on the calendar (shown de-emphasised)
}

function openMaps(): { store: MapStore; path: string | null }[] {
  return useSession
    .getState()
    .tabs.filter((t) => t.kind === 'map')
    .map((t) => ({ store: t.store as MapStore, path: t.path ?? null }));
}

function collectMindFiles(tree: TreeNode[], out: FileRef[] = []): FileRef[] {
  for (const n of tree) {
    if (n.type === 'dir' && n.children) collectMindFiles(n.children, out);
    else if (n.type === 'file' && n.path.endsWith('.mind')) out.push({ path: n.path, mtimeMs: n.mtimeMs });
  }
  return out;
}

const baseName = (path?: string): string =>
  path ? (path.split('/').pop() ?? '').replace(/\.mind$/, '') : '';

export async function collectNodesCached(): Promise<NodeRef[]> {
  const out: NodeRef[] = [];
  const seen = new Set<string>();
  const add = (mapId: string, nodeId: string, text: string, mapPath: string | undefined, scheduled: boolean) => {
    const k = `${mapId} ${nodeId}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ mapId, nodeId, text: text || '(이름 없음)', mapPath, mapName: baseName(mapPath), scheduled });
  };

  // Open maps first — their live state wins the dedup over the on-disk copy.
  for (const { store, path } of openMaps()) {
    const doc = store.getState().doc;
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      add(doc.id ?? '', id, n.text, path ?? undefined, !!n.scheduled);
    }
  }

  // On-disk .mind files via the mtime-keyed cache; drop entries for deleted files.
  const files = collectMindFiles(useWorkspace.getState().tree);
  pruneMindCache(files.map((f) => f.path));
  for (const f of files) {
    const doc = await loadMindDoc(f.path, f.mtimeMs);
    if (!doc) continue;
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      add(doc.id ?? '', id, n.text, f.path, !!n.scheduled);
    }
  }
  return out;
}
