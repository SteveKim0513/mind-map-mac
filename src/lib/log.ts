// Renderer → main log bridge. Writes scoped EVENTS/metadata to the app log file.
// Never pass user content (node text, notes, file contents) here.
type Level = 'error' | 'warn' | 'info' | 'debug';

export function log(level: Level, scope: string, message: string): void {
  try {
    window.api?.log?.(level, scope, message);
  } catch {
    /* logging must never throw */
  }
}
