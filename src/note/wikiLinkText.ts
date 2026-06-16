// Pure text helpers for `[[note title]]` wiki-links — NO editor/tiptap deps, so
// stores and the workspace index can import these without pulling ProseMirror in.

/** Matches a `[[note title]]` span. Title is anything but brackets / newlines. */
export const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** The set of note titles a body links to (lowercased, de-duped) — powers
 *  backlinks: note B's backlinks are the notes whose targets include B's title. */
export function extractWikiTargets(body: string): string[] {
  const out = new Set<string>();
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body))) out.add(m[1].trim().toLowerCase());
  return [...out];
}
