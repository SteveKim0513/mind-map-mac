import { describe, it, expect } from 'vitest';
import { recentFiles } from './smartViews';
import type { TreeNode } from '../../electron/preload';

describe('recentFiles', () => {
  it('sorts files by mtime desc and excludes directories', () => {
    const tree: TreeNode[] = [
      { name: 'a.md', path: '/ws/a.md', type: 'file', mtimeMs: 100 },
      { name: 'b.md', path: '/ws/b.md', type: 'file', mtimeMs: 300 },
      {
        name: 'folder',
        path: '/ws/folder',
        type: 'dir',
        children: [{ name: 'c.mind', path: '/ws/folder/c.mind', type: 'file', mtimeMs: 200 }],
      },
    ];
    expect(recentFiles(tree).map((f) => f.name)).toEqual(['b.md', 'c.mind', 'a.md']);
  });

  it('caps results at the given limit', () => {
    const tree: TreeNode[] = Array.from({ length: 30 }, (_, i) => ({
      name: `n${i}.md`,
      path: `/ws/n${i}.md`,
      type: 'file' as const,
      mtimeMs: i,
    }));
    expect(recentFiles(tree, 5)).toHaveLength(5);
    expect(recentFiles(tree, 5)[0].name).toBe('n29.md');
  });

  it('ignores files missing mtime (e.g. templates dir stripped fields)', () => {
    const tree: TreeNode[] = [{ name: 'a.md', path: '/ws/a.md', type: 'file' }];
    expect(recentFiles(tree)).toEqual([]);
  });
});
