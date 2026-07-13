import type { TreeNode } from '../../electron/preload';

export interface RecentFile {
  name: string;
  path: string;
  mtimeMs: number;
}

/** Flatten the tree to files only, sorted by mtime desc, capped at `limit`. */
export function recentFiles(tree: TreeNode[], limit = 20): RecentFile[] {
  const out: RecentFile[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === 'file' && typeof n.mtimeMs === 'number') {
        out.push({ name: n.name, path: n.path, mtimeMs: n.mtimeMs });
      } else if (n.type === 'dir' && n.children) {
        walk(n.children);
      }
    }
  };
  walk(tree);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}
