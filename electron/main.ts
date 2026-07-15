import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell, globalShortcut } from 'electron';
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
// E2E quiet mode: Playwright drives the renderer over CDP, which doesn't need
// a real OS-focused/visible window — so when this is set, windows open
// off-screen and un-activated instead of popping to the front and stealing
// focus from whatever else is on screen. `make dev-safe` never sets this
// (a human needs to actually see and click that window).
const E2E_QUIET = process.env.MINDMAP_E2E_QUIET === '1';

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
    ...(E2E_QUIET ? { x: -3000, y: -3000, show: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  });

  if (E2E_QUIET) {
    // showInactive() skips the OS-level "activate this app" step that a
    // normal show() does — the window exists (Playwright can still drive it
    // over CDP) but never jumps in front of or steals focus from other apps.
    win.once('ready-to-show', () => win?.showInactive());
  }

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

// ─── Global quick capture (REDESIGN-VISION §3-1) ───────────────────────────
// A small always-on-top window, toggled by a global OS shortcut, that stays
// alive for the app's whole session (hidden, not destroyed, between uses) so
// re-showing it is instant. The renderer (not this file) owns the .mind
// schema via src/io/formats.ts — main only hands it a target file path.
let captureWin: BrowserWindow | null = null;
let captureShortcutRegistered = false;
const CAPTURE_ACCELERATOR = 'Alt+Space';

function createCaptureWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 560,
    height: 76,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  });
  if (VITE_DEV_SERVER_URL) {
    w.loadURL(`${VITE_DEV_SERVER_URL}?capture=1`);
  } else {
    w.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { capture: '1' } });
  }
  // Clicking away dismisses it, same as Spotlight — a quick-capture surface
  // isn't a window you manage, it's a prompt you answer or ignore.
  w.on('blur', () => w.hide());
  w.on('closed', () => {
    captureWin = null;
  });
  return w;
}

function showCaptureWindow() {
  if (!captureWin || captureWin.isDestroyed()) captureWin = createCaptureWindow();
  captureWin.center();
  if (E2E_QUIET) {
    captureWin.showInactive();
  } else {
    captureWin.show();
    captureWin.focus();
  }
  captureWin.webContents.send('capture:shown');
}

app.whenReady().then(() => {
  log.info(`[app] start v${app.getVersion()} on ${process.platform}`);
  if (E2E_QUIET && process.platform === 'darwin') app.dock?.hide();
  buildMenu();
  createWindow();
  initAutoUpdate(() => win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  captureShortcutRegistered = globalShortcut.register(CAPTURE_ACCELERATOR, showCaptureWindow);
  if (!captureShortcutRegistered) {
    log.warn(`[capture] ${CAPTURE_ACCELERATOR} already in use by another app — quick capture disabled`);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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

function metaTemplatesPath() {
  return path.join(app.getPath('userData'), 'meta-templates.json');
}

interface AppSettings {
  workspace?: string;
  templatesEnabled?: boolean;
}

async function readSettings(): Promise<AppSettings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

async function writeSettings(s: AppSettings) {
  await fs.writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf-8');
}

const TEMPLATES_DIR = '.templates';

/** Note Template folder is a permanent system folder — recreate it whenever the feature is on. */
async function ensureTemplatesDir(ws: string): Promise<void> {
  const s = await readSettings();
  if (s.templatesEnabled === false) return; // explicitly turned off — don't recreate
  await fs.mkdir(path.join(ws, TEMPLATES_DIR), { recursive: true });
}

/** Resolve the workspace dir, creating a default one under ~/Documents on first run. */
async function getWorkspace(): Promise<string> {
  if (E2E_WORKSPACE) {
    await fs.mkdir(E2E_WORKSPACE, { recursive: true });
    await ensureTemplatesDir(E2E_WORKSPACE);
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
  await ensureTemplatesDir(ws);
  return ws;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
  mtimeMs?: number; // files only — powers the "최근 수정" smart view (REDESIGN-VISION §3-3)
}

/** Recursively list folders, .mind maps, and .md notes (hidden entries skipped). */
async function walk(dir: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (ent.name.endsWith('.assets')) continue; // image asset dirs — hide from sidebar
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      nodes.push({ name: ent.name, path: full, type: 'dir', children: await walk(full) });
    } else if (ent.name.endsWith('.mind') || ent.name.endsWith('.md')) {
      const stat = await fs.stat(full);
      nodes.push({ name: ent.name, path: full, type: 'file', mtimeMs: stat.mtimeMs });
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

/** Local image attachments live in a dot-prefixed sibling folder so they stay out
 *  of Finder/other file browsers — only the app itself needs to see them. */
function assetsDirName(stem: string): string {
  return `.${stem}.assets`;
}
/** Pre-0.8.3 folders used this visible name. Still recognized so notes created by
 *  older versions keep working; upgraded to the hidden name the next time their
 *  companion folder is touched (rename/move/trash/restore). */
function legacyAssetsDirName(stem: string): string {
  return `${stem}.assets`;
}
/** Find a note's companion image-assets folder under either naming convention. */
async function findAssetsDir(dir: string, stem: string): Promise<{ path: string; name: string } | null> {
  for (const name of [assetsDirName(stem), legacyAssetsDirName(stem)]) {
    const p = path.join(dir, name);
    try {
      await fs.access(p);
      return { path: p, name };
    } catch {
      /* try next convention */
    }
  }
  return null;
}
/** Move `found` to the canonical hidden name inside `destDir`, rewriting `notePath`'s
 *  embedded "./<old-dir-name>/…" image links to match. Used by every note lifecycle
 *  operation (rename/move/trash/restore) so a pre-0.8.3 visible folder gets upgraded
 *  the first time it's touched, instead of needing a dedicated migration pass. */
async function relocateAssetsDir(
  found: { path: string; name: string },
  destDir: string,
  newStem: string,
  notePath: string,
): Promise<void> {
  const newName = assetsDirName(newStem);
  const dest = path.join(destDir, newName);
  if (found.path === dest) return;
  try {
    await fs.rename(found.path, dest);
    if (found.name !== newName) {
      const oldRef = `./${found.name}/`;
      const newRef = `./${newName}/`;
      const body = await fs.readFile(notePath, 'utf-8');
      if (body.includes(oldRef)) await fs.writeFile(notePath, body.split(oldRef).join(newRef), 'utf-8');
    }
  } catch {
    /* rename failed — leave the assets dir where it was */
  }
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

/** Resolve `p` and reject it if it escapes the current workspace — path-traversal
 *  guard for every IPC handler that writes, renames, moves, or deletes on disk.
 *  Note: a bare `resolved.startsWith(ws)` is NOT enough — "/ws-evil" would pass
 *  a check against "/ws" without the separator. */
async function assertInsideWorkspace(p: string): Promise<string> {
  const ws = await getWorkspace();
  const resolved = path.resolve(p);
  if (resolved !== ws && !resolved.startsWith(ws + path.sep)) {
    throw new Error('Path outside workspace');
  }
  return resolved;
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

ipcMain.handle('capture:show', () => {
  showCaptureWindow();
});

ipcMain.handle('capture:targetPath', async () => {
  const root = await getWorkspace();
  return path.join(root, '오늘의 생각.mind');
});

ipcMain.handle('capture:hide', () => {
  captureWin?.hide();
});

// Tells the main window a capture was just written to disk — if that file
// happens to be open in a tab there, its stale in-memory copy would otherwise
// win the next autosave and silently erase the capture (§3-1 known risk).
ipcMain.handle('capture:notifyAppended', (_e, targetPath: string) => {
  win?.webContents.send('capture:appended', targetPath);
});

ipcMain.handle('capture:status', () => ({ registered: captureShortcutRegistered, accelerator: CAPTURE_ACCELERATOR }));

ipcMain.handle('fs:read', async (_e, filePath: string) => {
  return fs.readFile(filePath, 'utf-8');
});

ipcMain.handle(
  'images:write',
  async (_e, args: { notePath: string; filename: string; buffer: number[] }) => {
    const resolved = await assertInsideWorkspace(args.notePath);
    const base = path.basename(resolved, path.extname(resolved));
    const dir = path.dirname(resolved);
    // Reuse an existing (possibly pre-0.8.3, visible) folder if this note already
    // has one, so its images stay together in one place; otherwise create the
    // canonical hidden folder.
    const existing = await findAssetsDir(dir, base);
    const dirName = existing?.name ?? assetsDirName(base);
    const assetsDir = path.join(dir, dirName);
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, args.filename), Buffer.from(args.buffer));
    return `./${dirName}/${args.filename}`;
  },
);

ipcMain.handle(
  'images:read',
  async (_e, args: { notePath: string; filepath: string }) => {
    const resolved = await assertInsideWorkspace(
      path.join(path.dirname(args.notePath), args.filepath),
    );
    const buf = await fs.readFile(resolved);
    const ext = path.extname(args.filepath).toLowerCase().slice(1);
    const mime: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    };
    return `data:${mime[ext] ?? 'image/jpeg'};base64,${buf.toString('base64')}`;
  },
);

ipcMain.handle(
  'fs:createFile',
  async (_e, args: { dir: string; name: string; content: string; ext?: string }) => {
    const dir = await assertInsideWorkspace(args.dir);
    await fs.mkdir(dir, { recursive: true }); // auto-create dir (e.g. hidden .notes)
    const full = await assertInsideWorkspace(await uniquePath(dir, args.name, args.ext ?? '.mind'));
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
  const dir = await assertInsideWorkspace(args.dir);
  const full = await assertInsideWorkspace(await uniquePath(dir, args.name, ''));
  await fs.mkdir(full, { recursive: true });
  return full;
});

ipcMain.handle('fs:rename', async (_e, args: { path: string; newName: string }) => {
  const src = await assertInsideWorkspace(args.path);
  const dir = path.dirname(src);
  let next = await assertInsideWorkspace(path.join(dir, args.newName));
  // Guard against clobbering an existing different file (fs.rename overwrites silently).
  // Skip when it's the same file (e.g. a case-only rename on a case-insensitive FS).
  if (next.toLowerCase() !== src.toLowerCase()) {
    const ext = args.newName.endsWith('.mind')
      ? '.mind'
      : args.newName.endsWith('.md')
        ? '.md'
        : '';
    const base = ext ? args.newName.slice(0, -ext.length) : args.newName;
    try {
      await fs.access(next);
      next = await assertInsideWorkspace(await uniquePath(dir, base, ext)); // collision → de-dupe like create/move
      log.info(`[file] rename collision → de-duped to ${path.basename(next)}`);
    } catch {
      /* destination is free */
    }
  }
  await fs.rename(src, next);

  // Keep the companion image-assets directory in sync with the renamed note
  // (also upgrades a pre-0.8.3 visible folder to the hidden naming convention).
  if (path.extname(next) === '.md') {
    const oldStem = path.basename(src, path.extname(src));
    const newStem = path.basename(next, path.extname(next));
    const found = await findAssetsDir(path.dirname(src), oldStem);
    if (found) await relocateAssetsDir(found, path.dirname(next), newStem, next);
  }

  return next;
});

ipcMain.handle('fs:delete', async (_e, target: string) => {
  const resolved = await assertInsideWorkspace(target);
  try {
    await fs.access(resolved);
  } catch {
    return true; // already gone — treat as success
  }
  try {
    await shell.trashItem(resolved);
  } catch (err) {
    log.error(`[file] trash failed (${path.basename(resolved)}): ${(err as Error).message}`);
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

  // Move the companion image-assets folder into trash alongside the .md file.
  if (ext === '.md') {
    const found = await findAssetsDir(path.dirname(target), stem);
    if (found) await relocateAssetsDir(found, dir, path.basename(dest, ext), dest);
  }

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

  // Restore the companion image-assets folder if it was trashed alongside the note.
  if (path.extname(it.trashedPath) === '.md') {
    const trashedStem = path.basename(it.trashedPath, '.md');
    const found = await findAssetsDir(path.dirname(it.trashedPath), trashedStem);
    if (found) await relocateAssetsDir(found, path.dirname(dest), path.basename(dest, path.extname(dest)), dest);
  }

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
  // Also permanently delete the companion image-assets folder if present.
  if (path.extname(trashedPath) === '.md') {
    const stem = path.basename(trashedPath, '.md');
    const found = await findAssetsDir(path.dirname(trashedPath), stem);
    if (found) {
      try {
        await shell.trashItem(found.path);
      } catch {
        await fs.rm(found.path, { recursive: true, force: true });
      }
    }
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
    // Also delete the companion image-assets folder if present.
    if (path.extname(it.trashedPath) === '.md') {
      const stem = path.basename(it.trashedPath, '.md');
      const found = await findAssetsDir(path.dirname(it.trashedPath), stem);
      if (found) {
        try {
          await shell.trashItem(found.path);
        } catch {
          await fs.rm(found.path, { recursive: true, force: true });
        }
      }
    }
  }
  await writeTrash(metaFile, []);
  return true;
});

// Move a file/folder into destDir. Returns the new path (or null if it was a no-op
// or an illegal move, e.g. a folder into its own descendant).
ipcMain.handle('fs:move', async (_e, args: { src: string; destDir: string }) => {
  const src = await assertInsideWorkspace(args.src);
  const destDir = await assertInsideWorkspace(args.destDir);
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

  // Move the companion image-assets folder when moving a .md note.
  if (name.endsWith('.md')) {
    const srcStem = name.slice(0, -'.md'.length);
    const found = await findAssetsDir(path.dirname(src), srcStem);
    if (found) await relocateAssetsDir(found, destDir, path.basename(target, '.md'), target);
  }

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

// ─── AI API key (safeStorage — OS keychain encryption) ───────────────────────
const AI_KEY_PATH = path.join(app.getPath('userData'), 'ai-key.bin');

function maskKey(key: string): string {
  const prefix = 'sk-ant-';
  const tail = key.slice(-4);
  const dots = '••••••••';
  return key.startsWith(prefix) ? `${prefix}${dots}${tail}` : `••••${tail}`;
}

ipcMain.handle('ai:setKey', async (_e, key: string) => {
  const buf = safeStorage.encryptString(key);
  await fs.writeFile(AI_KEY_PATH, buf);
});

ipcMain.handle('ai:hasKey', async () => {
  try { await fs.access(AI_KEY_PATH); return true; } catch { return false; }
});

ipcMain.handle('ai:getMasked', async () => {
  try {
    const buf = await fs.readFile(AI_KEY_PATH);
    const key = safeStorage.decryptString(buf);
    return maskKey(key);
  } catch { return null; }
});

ipcMain.handle('ai:getKey', async () => {
  try {
    const buf = await fs.readFile(AI_KEY_PATH);
    return safeStorage.decryptString(buf);
  } catch { return null; }
});

ipcMain.handle('ai:clearKey', async () => {
  try { await fs.unlink(AI_KEY_PATH); } catch { /* already gone */ }
});

// ─── OpenAI API key ──────────────────────────────────────────────────────────
const OPENAI_KEY_PATH = path.join(app.getPath('userData'), 'openai-key.bin');

function maskOpenAiKey(key: string): string {
  const tail = key.slice(-4);
  if (key.startsWith('sk-proj-')) return `sk-proj-••••••••${tail}`;
  return `sk-••••••••${tail}`;
}

ipcMain.handle('ai:openai:setKey', async (_e, key: string) => {
  const buf = safeStorage.encryptString(key);
  await fs.writeFile(OPENAI_KEY_PATH, buf);
});

ipcMain.handle('ai:openai:getMasked', async () => {
  try {
    const buf = await fs.readFile(OPENAI_KEY_PATH);
    return maskOpenAiKey(safeStorage.decryptString(buf));
  } catch { return null; }
});

ipcMain.handle('ai:openai:getKey', async () => {
  try {
    const buf = await fs.readFile(OPENAI_KEY_PATH);
    return safeStorage.decryptString(buf);
  } catch { return null; }
});

ipcMain.handle('ai:openai:clearKey', async () => {
  try { await fs.unlink(OPENAI_KEY_PATH); } catch { /* already gone */ }
});

// ─── Active AI provider ────────────────────────────────────────────────────
const ACTIVE_PROVIDER_PATH = path.join(app.getPath('userData'), 'ai-active.json');

ipcMain.handle('ai:getActive', async () => {
  try {
    const data = JSON.parse(await fs.readFile(ACTIVE_PROVIDER_PATH, 'utf-8')) as { provider: string };
    if (data.provider === 'claude' || data.provider === 'openai') return data.provider as 'claude' | 'openai';
    return null;
  } catch { return null; }
});

ipcMain.handle('ai:setActive', async (_e, provider: 'claude' | 'openai') => {
  await fs.writeFile(ACTIVE_PROVIDER_PATH, JSON.stringify({ provider }));
});

// ─── Shell ────────────────────────────────────────────────────────────────
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  if (!url.startsWith('https://')) return;
  await shell.openExternal(url);
});

// ─── Meta templates ───────────────────────────────────────────────────────
ipcMain.handle('meta:getTemplates', async () => {
  try {
    return JSON.parse(await fs.readFile(metaTemplatesPath(), 'utf-8'));
  } catch {
    return [];
  }
});

// ─── Favorites (pinned files) ───────────────────────────────────────────────
// A hidden <workspace>/.pins.json list of absolute paths, mirroring the
// .trashmeta.json pattern. Dead paths (deleted/moved files) are filtered out
// on every read rather than treated as an error — a stale pin isn't a bug.
const PINS_FILE = '.pins.json';

async function pinsPath(): Promise<string> {
  return path.join(await getWorkspace(), PINS_FILE);
}
async function readPins(): Promise<string[]> {
  try {
    const raw = JSON.parse(await fs.readFile(await pinsPath(), 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
async function writePins(paths: string[]): Promise<void> {
  await fs.writeFile(await pinsPath(), JSON.stringify(paths, null, 2), 'utf-8');
}

ipcMain.handle('pins:list', async () => {
  const paths = await readPins();
  const alive: string[] = [];
  for (const p of paths) {
    try {
      await fs.access(p);
      alive.push(p);
    } catch { /* file gone — drop the stale pin */ }
  }
  if (alive.length !== paths.length) await writePins(alive);
  return alive;
});

ipcMain.handle('pins:toggle', async (_e, target: string) => {
  const resolved = await assertInsideWorkspace(target);
  const paths = await readPins();
  const next = paths.includes(resolved)
    ? paths.filter((p) => p !== resolved)
    : [...paths, resolved];
  await writePins(next);
  return next;
});

ipcMain.handle('meta:saveTemplates', async (_e, templates: unknown) => {
  await fs.writeFile(metaTemplatesPath(), JSON.stringify(templates, null, 2), 'utf-8');
});

// ─── Note templates ─────────────────────────────────────────────────────────
// Templates live in the hidden <workspace>/.templates folder — a permanent system
// folder (walk() already hides dot-folders from the sidebar tree; ensureTemplatesDir()
// recreates it whenever the feature is on, including right after the user deletes it).

ipcMain.handle('settings:getTemplatesEnabled', async () => {
  const s = await readSettings();
  return s.templatesEnabled !== false; // default on
});

ipcMain.handle('settings:setTemplatesEnabled', async (_e, enabled: boolean) => {
  const s = await readSettings();
  await writeSettings({ ...s, templatesEnabled: enabled });
  if (enabled) await ensureTemplatesDir(await getWorkspace());
});

ipcMain.handle('templates:list', async () => {
  const dir = path.join(await getWorkspace(), TEMPLATES_DIR);
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    const files = ents.filter((e) => e.isFile() && e.name.endsWith('.md'));
    return await Promise.all(
      files.map(async (e) => {
        const full = path.join(dir, e.name);
        const stat = await fs.stat(full);
        return {
          name: e.name,
          title: e.name.slice(0, -3),
          updatedAt: stat.mtime.toISOString(),
        };
      }),
    );
  } catch {
    return [];
  }
});
