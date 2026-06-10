// App logging — file logs for post-hoc diagnostics, console in dev.
//
// Location (macOS): ~/Library/Logs/<appName>/main.log (electron-log default).
// Privacy: log EVENTS and metadata only — never node text/notes/file contents.
import log from 'electron-log/main';
import { shell } from 'electron';
import path from 'node:path';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// Console: verbose in dev, silent in production. File: info+ always (warn/error are
// the point of having a file users can attach to a bug report), debug while developing.
log.transports.console.level = isDev ? 'debug' : false;
log.transports.file.level = isDev ? 'debug' : 'info';
log.transports.file.maxSize = 1024 * 1024; // 1 MB, then rotates to main.old.log

export type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug';

/** Log a scoped event, e.g. logEvent('info', 'sync', 'created 1, pushed 0'). */
export function logEvent(level: LogLevel, scope: string, message: string) {
  log[level](`[${scope}] ${message}`);
}

/** Directory that holds the log files (created lazily by electron-log). */
export function logsDir(): string {
  return path.dirname(log.transports.file.getFile().path);
}

export async function openLogsDir(): Promise<void> {
  await shell.openPath(logsDir());
}

export default log;
