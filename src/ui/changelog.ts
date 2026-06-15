// Release history, bundled from CHANGELOG.md at build time (no network). The app
// only ever needs history up to its own version; a newer build brings a newer
// CHANGELOG. The top entry is the current version.
import CHANGELOG from '../../CHANGELOG.md?raw';

export interface Release {
  version: string;
  date: string;
  body: string; // markdown (### sections + lists), rendered via renderMarkdown
}

/** Parse Keep-a-Changelog "## [x.y.z] - date" sections (newest first). Pure. */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  let cur: Release | null = null;
  let body: string[] = [];
  const flush = () => {
    if (cur) {
      cur.body = body.join('\n').trim();
      out.push(cur);
      body = [];
    }
  };
  for (const line of md.split('\n')) {
    const m = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+?)\s*$/);
    if (m) {
      flush();
      cur = { version: m[1], date: m[2], body: '' };
    } else if (cur) {
      body.push(line);
    }
  }
  flush();
  return out;
}

/** semver-ish: is `a` strictly newer than `b`? */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export const RELEASES = parseChangelog(CHANGELOG);
export const CURRENT_VERSION = RELEASES[0]?.version ?? '';
