import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  remindersAvailable,
  createReminder,
  updateReminder,
  deleteReminder,
  queryReminders,
  heartbeat,
} from './reminders';
import log, { logEvent, openLogsDir, type LogLevel } from './logger';
import { initAutoUpdate, checkForUpdatesManually, installUpdate } from './updater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test/E2E isolation: redirect userData (settings.json, localStorage session)
// so automated runs can never read or write the real user's state.
if (process.env.MINDMAP_USER_DATA) {
  app.setPath('userData', process.env.MINDMAP_USER_DATA);
}
// Test/E2E isolation: override the workspace directory directly.
const E2E_WORKSPACE = process.env.MINDMAP_WORKSPACE ?? null;

// vite-plugin-electron injects these env vars during dev
process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let win: BrowserWindow | null = null;

function send(channel: string, ...args: unknown[]) {
  win?.webContents.send(channel, ...args);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { label: '업데이트 확인…', click: () => checkForUpdatesManually() },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: '파일',
      submenu: [
        { label: '새로 만들기', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: '열기…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { type: 'separator' },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'saveAs') },
        { type: 'separator' },
        {
          label: '가져오기',
          submenu: [
            { label: 'Markdown (.md)…', click: () => send('menu', 'import-markdown') },
            { label: 'OPML (.opml)…', click: () => send('menu', 'import-opml') },
          ],
        },
        {
          label: '내보내기',
          submenu: [
            { label: 'Markdown (.md)…', click: () => send('menu', 'export-markdown') },
            { label: 'OPML (.opml)…', click: () => send('menu', 'export-opml') },
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { label: '실행 취소', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: '다시 실행', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { label: '찾기…', accelerator: 'CmdOrCtrl+F', click: () => send('menu', 'find') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '확대', accelerator: 'CmdOrCtrl+=', click: () => send('menu', 'zoom-in') },
        { label: '축소', accelerator: 'CmdOrCtrl+-', click: () => send('menu', 'zoom-out') },
        { label: '화면에 맞추기', accelerator: 'CmdOrCtrl+0', click: () => send('menu', 'zoom-fit') },
        { type: 'separator' },
        {
          label: '사이드바 토글',
          click: () => send('menu', 'toggle-sidebar'),
        },
        {
          label: '화면 분할 토글',
          click: () => send('menu', 'toggle-split'),
        },
        {
          label: '다크 모드 전환',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => send('menu', 'toggle-theme'),
        },
        { type: 'separator' },
        { label: '로그 폴더 열기', click: () => void openLogsDir() },
        // dev-only: keep DevTools out of distributed builds
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 440,
    backgroundColor: '#f6f5f4',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  });

  // Open external links in the browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Forward renderer warnings/errors to the log file, minus the noisy dev-only
  // Electron CSP security warning.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // level: 2 = warning, 3 = error — preserve the severity in the file log
    if (level >= 2 && !message.includes('Electron Security Warning'))
      log[level >= 3 ? 'error' : 'warn'](`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[renderer] process gone: ${details.reason}`);
  });

  // Refresh the sidebar when the window regains focus so external changes
  // made in Finder (rename, delete, add) are reflected immediately.
  win.on('focus', () => {
    win?.webContents.send('workspace:focus');
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.whenReady().then(() => {
  log.info(`[app] start v${app.getVersion()} on ${process.platform}`);
  buildMenu();
  createWindow();
  initAutoUpdate(() => win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Renderer → file log bridge (fire-and-forget). Renderer logs events/metadata only.
ipcMain.on('log:event', (_e, m: { level: LogLevel; scope: string; message: string }) => {
  logEvent(m.level, m.scope, m.message);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  win = null;
});

// ─── File IPC ────────────────────────────────────────────────────────────────

// Open a .mind file via dialog. Returns { path, content } or null if cancelled.
ipcMain.handle('dialog:open', async () => {
  const res = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'MindMap', extensions: ['mind', 'json'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const filePath = res.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  return { path: filePath, content };
});

// Save content to a known path, or prompt Save As when path is null.
// Returns the path written, or null if cancelled.
ipcMain.handle('file:save', async (_e, args: { path: string | null; content: string }) => {
  let target = args.path;
  if (!target) {
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: 'Untitled.mind',
      filters: [{ name: 'MindMap', extensions: ['mind'] }],
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  try {
    await fs.writeFile(target, args.content, 'utf-8');
  } catch (err) {
    log.error(`[file] save failed (${path.basename(target)}): ${(err as Error).message}`);
    throw err;
  }
  return target;
});

// Generic "save with dialog" used for exports (markdown / opml).
ipcMain.handle(
  'dialog:saveAs',
  async (_e, args: { defaultName: string; content: string; ext: string }) => {
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: args.defaultName,
      filters: [{ name: args.ext.toUpperCase(), extensions: [args.ext] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, args.content, 'utf-8');
    return res.filePath;
  },
);

// Generic "open with dialog" used for imports (markdown / opml).
ipcMain.handle('dialog:openAs', async (_e, ext: string) => {
  const res = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const content = await fs.readFile(res.filePaths[0], 'utf-8');
  return { path: res.filePaths[0], content };
});

// ─── Workspace + filesystem IPC ──────────────────────────────────────────────

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings(): Promise<{ workspace?: string }> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

async function writeSettings(s: { workspace?: string }) {
  await fs.writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf-8');
}

/** Resolve the workspace dir, creating a default one under ~/Documents on first run. */
async function getWorkspace(): Promise<string> {
  if (E2E_WORKSPACE) {
    await fs.mkdir(E2E_WORKSPACE, { recursive: true });
    return E2E_WORKSPACE;
  }
  const s = await readSettings();
  let ws = s.workspace;
  if (!ws) {
    // "MindMap Dev" test builds (npm run dist:dev) get their own default
    // workspace too — sharing ~/Documents/MindMaps with the real install
    // would mix test files into the user's actual maps.
    const wsName = app.getName() === 'MindMap Dev' ? 'MindMaps Dev' : 'MindMaps';
    ws = path.join(app.getPath('documents'), wsName);
    await writeSettings({ ...s, workspace: ws });
  }
  await fs.mkdir(ws, { recursive: true });
  return ws;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

/** Recursively list folders, .mind maps, and .md notes (hidden entries skipped). */
async function walk(dir: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      nodes.push({ name: ent.name, path: full, type: 'dir', children: await walk(full) });
    } else if (ent.name.endsWith('.mind') || ent.name.endsWith('.md')) {
      nodes.push({ name: ent.name, path: full, type: 'file' });
    }
  }
  // Natural sort so "제목 없음 3" comes before "제목 없음 21" (numeric-aware).
  nodes.sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : a.type === 'dir'
        ? -1
        : 1,
  );
  return nodes;
}

/** Append " 2", " 3", … to avoid clobbering an existing file/folder. */
async function uniquePath(dir: string, base: string, ext: string): Promise<string> {
  let name = `${base}${ext}`;
  let i = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const full = path.join(dir, name);
    try {
      await fs.access(full);
      name = `${base} ${i++}${ext}`;
    } catch {
      return full;
    }
  }
}

ipcMain.handle('workspace:get', () => getWorkspace());

ipcMain.handle('workspace:choose', async () => {
  const res = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const ws = res.filePaths[0];
  await writeSettings({ workspace: ws });
  return ws;
});

ipcMain.handle('workspace:tree', async () => {
  const root = await getWorkspace();
  return { root, tree: await walk(root) };
});

ipcMain.handle('fs:read', async (_e, filePath: string) => {
  return fs.readFile(filePath, 'utf-8');
});

ipcMain.handle(
  'fs:createFile',
  async (_e, args: { dir: string; name: string; content: string; ext?: string }) => {
    await fs.mkdir(args.dir, { recursive: true }); // auto-create dir (e.g. hidden .notes)
    const full = await uniquePath(args.dir, args.name, args.ext ?? '.mind');
    await fs.writeFile(full, args.content, 'utf-8');
    return full;
  },
);

// List the hidden attached-notes folder (.notes/*.md) — these never appear in the
// sidebar tree (walk skips dot-folders) but must still be indexed for node chips.
ipcMain.handle('attached:list', async () => {
  const dir = path.join(await getWorkspace(), '.notes');
  try {
    const ents = await fs.readdir(dir);
    return ents.filter((n) => n.endsWith('.md')).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
});

ipcMain.handle('fs:createFolder', async (_e, args: { dir: string; name: string }) => {
  const full = await uniquePath(args.dir, args.name, '');
  await fs.mkdir(full, { recursive: true });
  return full;
});

ipcMain.handle('fs:rename', async (_e, args: { path: string; newName: string }) => {
  const dir = path.dirname(args.path);
  let next = path.join(dir, args.newName);
  // Guard against clobbering an existing different file (fs.rename overwrites silently).
  // Skip when it's the same file (e.g. a case-only rename on a case-insensitive FS).
  if (next.toLowerCase() !== args.path.toLowerCase()) {
    const ext = args.newName.endsWith('.mind')
      ? '.mind'
      : args.newName.endsWith('.md')
        ? '.md'
        : '';
    const base = ext ? args.newName.slice(0, -ext.length) : args.newName;
    try {
      await fs.access(next);
      next = await uniquePath(dir, base, ext); // collision → de-dupe like create/move
      log.info(`[file] rename collision → de-duped to ${path.basename(next)}`);
    } catch {
      /* destination is free */
    }
  }
  await fs.rename(args.path, next);
  return next;
});

ipcMain.handle('fs:delete', async (_e, target: string) => {
  try {
    await fs.access(target);
  } catch {
    return true; // already gone — treat as success
  }
  try {
    await shell.trashItem(target);
  } catch (err) {
    log.error(`[file] trash failed (${path.basename(target)}): ${(err as Error).message}`);
    throw err;
  }
  return true;
});

// ── Trash (in-workspace .trash folder) ──────────────────────────────────────
// Delete = move into <root>/.trash and record where it came from, so it can be
// restored. "Empty trash" hands items to the OS Trash as a final safety net.
// .trash is a dot-folder, so walk() already hides it from the sidebar tree.
const TRASH_DIR = '.trash';
const TRASH_META = '.trashmeta.json';

interface TrashEntry {
  name: string; // basename inside .trash
  trashedPath: string; // absolute path inside .trash
  originalPath: string; // where it lived before deletion
  type: 'file' | 'dir';
  deletedAt: string; // ISO timestamp
}

async function trashLoc(): Promise<{ dir: string; metaFile: string }> {
  const dir = path.join(await getWorkspace(), TRASH_DIR);
  return { dir, metaFile: path.join(dir, TRASH_META) };
}
async function readTrash(metaFile: string): Promise<TrashEntry[]> {
  try {
    return JSON.parse(await fs.readFile(metaFile, 'utf-8'));
  } catch {
    return [];
  }
}
async function writeTrash(metaFile: string, items: TrashEntry[]): Promise<void> {
  await fs.writeFile(metaFile, JSON.stringify(items, null, 2), 'utf-8');
}

ipcMain.handle('trash:move', async (_e, target: string) => {
  const { dir, metaFile } = await trashLoc();
  await fs.mkdir(dir, { recursive: true });
  const stat = await fs.stat(target);
  const baseName = path.basename(target);
  const ext = stat.isDirectory() ? '' : path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  const dest = await uniquePath(dir, stem, ext); // never clobber inside .trash
  await fs.rename(target, dest);
  const items = await readTrash(metaFile);
  items.push({
    name: path.basename(dest),
    trashedPath: dest,
    originalPath: target,
    type: stat.isDirectory() ? 'dir' : 'file',
    deletedAt: new Date().toISOString(),
  });
  await writeTrash(metaFile, items);
  return { trashedPath: dest };
});

ipcMain.handle('trash:list', async () => {
  const { metaFile } = await trashLoc();
  const items = await readTrash(metaFile);
  const alive: TrashEntry[] = [];
  for (const it of items) {
    try {
      await fs.access(it.trashedPath);
      alive.push(it);
    } catch {
      /* file vanished (manual delete) — drop the stale entry */
    }
  }
  if (alive.length !== items.length) await writeTrash(metaFile, alive);
  return alive.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1)); // newest first
});

ipcMain.handle('trash:restore', async (_e, trashedPath: string) => {
  const { metaFile } = await trashLoc();
  const items = await readTrash(metaFile);
  const idx = items.findIndex((it) => it.trashedPath === trashedPath);
  if (idx === -1) return null;
  const it = items[idx];
  const parent = path.dirname(it.originalPath);
  await fs.mkdir(parent, { recursive: true }); // original folder may have been removed
  let dest = it.originalPath;
  try {
    await fs.access(dest);
    const ext = it.type === 'dir' ? '' : path.extname(it.originalPath);
    dest = await uniquePath(parent, path.basename(it.originalPath, ext), ext); // occupied → de-dupe
  } catch {
    /* original path is free */
  }
  await fs.rename(it.trashedPath, dest);
  items.splice(idx, 1);
  await writeTrash(metaFile, items);
  return dest;
});

ipcMain.handle('trash:deleteOne', async (_e, trashedPath: string) => {
  const { metaFile } = await trashLoc();
  const items = await readTrash(metaFile);
  try {
    await shell.trashItem(trashedPath);
  } catch {
    await fs.rm(trashedPath, { recursive: true, force: true });
  }
  await writeTrash(
    metaFile,
    items.filter((it) => it.trashedPath !== trashedPath),
  );
  return true;
});

ipcMain.handle('trash:empty', async () => {
  const { metaFile } = await trashLoc();
  const items = await readTrash(metaFile);
  for (const it of items) {
    try {
      await shell.trashItem(it.trashedPath);
    } catch {
      await fs.rm(it.trashedPath, { recursive: true, force: true });
    }
  }
  await writeTrash(metaFile, []);
  return true;
});

// Move a file/folder into destDir. Returns the new path (or null if it was a no-op
// or an illegal move, e.g. a folder into its own descendant).
ipcMain.handle('fs:move', async (_e, args: { src: string; destDir: string }) => {
  const { src, destDir } = args;
  const name = path.basename(src);
  if (path.dirname(src) === destDir) return null; // already there
  if (destDir === src || destDir.startsWith(src + path.sep)) return null; // into itself
  // recognize BOTH app extensions — a bare '' ext would make uniquePath emit
  // "foo.md 2" (no extension), invisible to the sidebar walk (= vanished note)
  const ext = name.endsWith('.mind') ? '.mind' : name.endsWith('.md') ? '.md' : '';
  const base = ext ? name.slice(0, -ext.length) : name;
  let target = path.join(destDir, name);
  try {
    await fs.access(target);
    target = await uniquePath(destDir, base, ext); // name clash → de-dupe
  } catch {
    /* target is free */
  }
  await fs.rename(src, target);
  return target;
});

ipcMain.handle(
  'dialog:message',
  async (_e, opts: { message: string; detail?: string; buttons: string[]; cancelId?: number }) => {
    const res = await dialog.showMessageBox(win!, {
      type: 'warning',
      message: opts.message,
      detail: opts.detail,
      buttons: opts.buttons,
      defaultId: 0,
      cancelId: opts.cancelId ?? opts.buttons.length - 1,
    });
    return res.response;
  },
);

// ─── macOS Reminders IPC (no-op off macOS) ───────────────────────────────────
const isMac = process.platform === 'darwin';
ipcMain.handle('reminders:available', async () => (isMac ? remindersAvailable() : false));
ipcMain.handle(
  'reminders:create',
  async (_e, opts: { title: string; dueDate: string | null; nodeId: string }) =>
    createReminder(opts),
);
ipcMain.handle(
  'reminders:update',
  async (_e, opts: { id: string; title: string; completed: boolean; dueDate: string | null }) =>
    updateReminder(opts),
);
ipcMain.handle('reminders:delete', async (_e, id: string) => deleteReminder(id));
ipcMain.handle('reminders:query', async () => (isMac ? queryReminders() : []));
ipcMain.handle('reminders:heartbeat', async () =>
  isMac ? heartbeat() : { ok: false, kind: 'denied' as const },
);

// In-app update check (Settings button / menu) — drives the renderer popup
ipcMain.handle('update:check', () => checkForUpdatesManually());
ipcMain.handle('update:install', () => installUpdate());

// ─── Web fetch (for "URL → note") — runs in main so there's no CORS ──────────
ipcMain.handle('web:fetch', async (_e, rawUrl: string) => {
  let url = (rawUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 MindMap/1.0',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    });
    const html = await res.text();
    return { ok: true as const, finalUrl: res.url || url, status: res.status, html };
  } catch (err) {
    log.warn(`[web] fetch failed (${url}): ${(err as Error).message}`);
    return { ok: false as const, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
});
