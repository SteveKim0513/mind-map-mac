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
} from './reminders';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'saveAs') },
        { type: 'separator' },
        {
          label: 'Import',
          submenu: [
            { label: 'Markdown (.md)…', click: () => send('menu', 'import-markdown') },
            { label: 'OPML (.opml)…', click: () => send('menu', 'import-opml') },
          ],
        },
        {
          label: 'Export',
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
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => send('menu', 'find') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => send('menu', 'zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('menu', 'zoom-out') },
        { label: 'Fit to Screen', accelerator: 'CmdOrCtrl+0', click: () => send('menu', 'zoom-fit') },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          click: () => send('menu', 'toggle-sidebar'),
        },
        {
          label: 'Toggle Dark Mode',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => send('menu', 'toggle-theme'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
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

  // Forward renderer console warnings/errors to the terminal for diagnostics.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer gone]', details.reason);
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
  await fs.writeFile(target, args.content, 'utf-8');
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
  const s = await readSettings();
  let ws = s.workspace;
  if (!ws) {
    ws = path.join(app.getPath('documents'), 'MindMaps');
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

/** Recursively list folders and .mind files (hidden entries skipped). */
async function walk(dir: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      nodes.push({ name: ent.name, path: full, type: 'dir', children: await walk(full) });
    } else if (ent.name.endsWith('.mind')) {
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

ipcMain.handle('fs:createFile', async (_e, args: { dir: string; name: string; content: string }) => {
  const full = await uniquePath(args.dir, args.name, '.mind');
  await fs.writeFile(full, args.content, 'utf-8');
  return full;
});

ipcMain.handle('fs:createFolder', async (_e, args: { dir: string; name: string }) => {
  const full = await uniquePath(args.dir, args.name, '');
  await fs.mkdir(full, { recursive: true });
  return full;
});

ipcMain.handle('fs:rename', async (_e, args: { path: string; newName: string }) => {
  const dir = path.dirname(args.path);
  const next = path.join(dir, args.newName);
  await fs.rename(args.path, next);
  return next;
});

ipcMain.handle('fs:delete', async (_e, target: string) => {
  await shell.trashItem(target);
  return true;
});

// Move a file/folder into destDir. Returns the new path (or null if it was a no-op
// or an illegal move, e.g. a folder into its own descendant).
ipcMain.handle('fs:move', async (_e, args: { src: string; destDir: string }) => {
  const { src, destDir } = args;
  const name = path.basename(src);
  if (path.dirname(src) === destDir) return null; // already there
  if (destDir === src || destDir.startsWith(src + path.sep)) return null; // into itself
  const ext = name.endsWith('.mind') ? '.mind' : '';
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
ipcMain.handle('reminders:create', async (_e, opts: { title: string; dueDate: string | null }) =>
  createReminder(opts),
);
ipcMain.handle(
  'reminders:update',
  async (_e, opts: { id: string; title: string; completed: boolean; dueDate: string | null }) =>
    updateReminder(opts),
);
ipcMain.handle('reminders:delete', async (_e, id: string) => deleteReminder(id));
ipcMain.handle('reminders:query', async () => (isMac ? queryReminders() : []));
