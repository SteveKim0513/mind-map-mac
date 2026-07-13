// Auto-learned shortcuts for repeated ⌘K commands — Spotlight's "Quick Keys"
// (macOS Tahoe) pattern, REDESIGN-VISION §3-7. Frequently-run commands rise to
// the top of the empty-query list and get an ⌥1-9 slot for instant execution.
const STORAGE_KEY = 'cmdUsage';
const QUICK_KEY_THRESHOLD = 2; // must have been run at least this many times to earn a slot
const MAX_QUICK_KEYS = 9;

function readCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function recordCommandUsage(id: string): void {
  const counts = readCounts();
  counts[id] = (counts[id] ?? 0) + 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
}

/** Sort ids by usage count desc, stable for ties (keeps the caller's original order). */
export function sortByUsage<T extends { id: string }>(items: T[]): T[] {
  const counts = readCounts();
  return items
    .map((item, i) => ({ item, i, n: counts[item.id] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.item);
}

/** Maps command id -> assigned quick-key digit (1-9), for ids that cleared the threshold. */
export function quickKeyAssignments(orderedIds: string[]): Map<string, number> {
  const counts = readCounts();
  const eligible = orderedIds.filter((id) => (counts[id] ?? 0) >= QUICK_KEY_THRESHOLD);
  const map = new Map<string, number>();
  eligible.slice(0, MAX_QUICK_KEYS).forEach((id, i) => map.set(id, i + 1));
  return map;
}
