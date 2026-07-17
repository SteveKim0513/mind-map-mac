// Auto-learned shortcuts for repeated ⌘K commands — Spotlight's "Quick Keys"
// (macOS Tahoe) pattern, REDESIGN-VISION §3-7. Frequently-run commands rise to
// the top of the empty-query list and get an ⌥1-9 slot for instant execution.
const STORAGE_KEY = 'cmdUsage';
const QUICK_KEY_STORE = 'cmdQuickKeys'; // persisted command→digit map (stable across rank changes)
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

function readAssignments(): Record<string, number> {
  try {
    const raw = localStorage.getItem(QUICK_KEY_STORE);
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

/**
 * Maps command id -> assigned quick-key digit (1-9), for ids that cleared the
 * threshold. Assignments are STABLE: a command keeps the digit it first earned
 * and is never reshuffled when usage ranks change (⌥1-9 is muscle memory). A
 * newly-eligible command takes the lowest free digit, in the caller's ranked
 * order; once all 9 are taken, later qualifiers get nothing. The map persists in
 * localStorage so it survives reloads.
 */
export function quickKeyAssignments(orderedIds: string[]): Map<string, number> {
  const counts = readCounts();
  const stored = readAssignments();

  const assigned: Record<string, number> = {};
  const usedDigits = new Set<number>();
  // Keep prior assignments whose command is still eligible — this is what makes
  // a digit "stick". A digit is only freed if its command truly falls away
  // (counts never decrease today, so in practice earned digits are permanent).
  for (const [id, digit] of Object.entries(stored)) {
    if (digit >= 1 && digit <= MAX_QUICK_KEYS && (counts[id] ?? 0) >= QUICK_KEY_THRESHOLD && !usedDigits.has(digit)) {
      assigned[id] = digit;
      usedDigits.add(digit);
    }
  }

  const nextFreeDigit = (): number => {
    for (let d = 1; d <= MAX_QUICK_KEYS; d++) if (!usedDigits.has(d)) return d;
    return 0;
  };
  // Assign the lowest free digit to newly-eligible commands, in ranked order.
  for (const id of orderedIds) {
    if (assigned[id] != null || (counts[id] ?? 0) < QUICK_KEY_THRESHOLD) continue;
    const d = nextFreeDigit();
    if (!d) break; // all slots taken
    assigned[id] = d;
    usedDigits.add(d);
  }

  // Persist only when the mapping actually changed (keeps steady-state renders
  // side-effect-free, since this runs during CommandPalette render).
  const changed =
    Object.keys(assigned).length !== Object.keys(stored).length ||
    Object.entries(assigned).some(([id, d]) => stored[id] !== d);
  if (changed) localStorage.setItem(QUICK_KEY_STORE, JSON.stringify(assigned));

  return new Map(Object.entries(assigned));
}
