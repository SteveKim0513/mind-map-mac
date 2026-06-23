/**
 * Pure predicate: should auto-update run for this app identity?
 *
 * Kept dependency-free (no electron import) so it is unit-testable —
 * `electron/updater.ts` wires it to the live `app.*` values.
 *
 * History: v0.7.5–0.7.7 shipped without `productName` in the asar, so
 * `app.getName()` fell back to the lowercase package name ('mind-map') and the
 * old `=== 'MindMap'` check silently disabled auto-update on real builds. The
 * rule below is therefore *fail-open for production*: any packaged build updates
 * EXCEPT the "MindMap Dev" test build (which always carries the 'Dev' suffix).
 */
export function shouldEnableUpdates(o: {
  packaged: boolean;
  name: string;
  feedOverride?: boolean;
}): boolean {
  if (o.feedOverride) return true; // MINDMAP_UPDATE_URL test hook
  if (!o.packaged) return false; // `npm run dev`
  return !o.name.endsWith('Dev'); // exclude "MindMap Dev"; prod stays enabled
}
