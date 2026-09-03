// Shared file-kind helpers, derived from a path's extension alone — the one
// thing every "list of files" screen has in common (RecentFile, favorite
// path, trash item, quick-open entry…), even when it has no TreeNode to hand.
// Sidebar.tsx has its own TreeNode-based variants (it also needs `dir`), but
// delegates the file-extension part to these so a new file type only needs
// to be taught here once. Extracted 2026-09-03 after "새 보드가 최근 파일/
// 즐겨찾기/휴지통/Quick Open/경로 바에서 전부 마인드맵으로 보인다" — each of
// those screens had re-implemented its own `.md`-only binary check.

export type FileKind = 'note' | 'board' | 'map';

/** File kind from its extension. Anything that isn't `.md`/`.board` is
 *  treated as a map — matches every existing binary check this replaces. */
export function fileExtKind(path: string): FileKind {
  if (path.endsWith('.md')) return 'note';
  if (path.endsWith('.board')) return 'board';
  return 'map';
}

/** Base file name with its `.mind`/`.md`/`.board` extension stripped. */
export function fileDisplayName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.(mind|md|board)$/, '');
}

/** Icon name for a file's extension (see ui/Icon.tsx). */
export function fileIconName(path: string): 'note' | 'board' | 'mindmap' {
  const kind = fileExtKind(path);
  return kind === 'map' ? 'mindmap' : kind;
}
