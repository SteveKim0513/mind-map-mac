import { contextBridge, ipcRenderer } from 'electron';

type FileResult = { path: string; content: string } | null;

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

export interface TrashItem {
  name: string;
  trashedPath: string;
  originalPath: string;
  type: 'file' | 'dir';
  deletedAt: string; // ISO timestamp
}

export interface ReminderInfo {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string | null; // local-time ISO, or null
  modifiedAt: string; // local-time ISO
  tag: string | null; // owning node id, or null
}

const api = {
  /** Open a .mind file through a native dialog. */
  open: (): Promise<FileResult> => ipcRenderer.invoke('dialog:open'),
  /** Save .mind content; pass null path to trigger Save As. Returns written path. */
  save: (path: string | null, content: string): Promise<string | null> =>
    ipcRenderer.invoke('file:save', { path, content }),
  /** Save arbitrary text through a native dialog (exports). */
  saveAs: (defaultName: string, content: string, ext: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveAs', { defaultName, content, ext }),
  /** Open arbitrary text through a native dialog (imports). */
  openAs: (ext: string): Promise<FileResult> => ipcRenderer.invoke('dialog:openAs', ext),
  // ── workspace / filesystem ──
  workspaceGet: (): Promise<string> => ipcRenderer.invoke('workspace:get'),
  workspaceChoose: (): Promise<string | null> => ipcRenderer.invoke('workspace:choose'),
  workspaceTree: (): Promise<{ root: string; tree: TreeNode[] }> =>
    ipcRenderer.invoke('workspace:tree'),
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:read', filePath),
  imagesWrite: (args: { notePath: string; filename: string; buffer: number[] }): Promise<string> =>
    ipcRenderer.invoke('images:write', args),
  imagesRead: (args: { notePath: string; filepath: string }): Promise<string> =>
    ipcRenderer.invoke('images:read', args),
  /** Hidden attached-notes (.notes/*.md) — indexed but not shown in the sidebar. */
  attachedNotes: (): Promise<string[]> => ipcRenderer.invoke('attached:list'),
  createFile: (dir: string, name: string, content: string, ext?: string): Promise<string> =>
    ipcRenderer.invoke('fs:createFile', { dir, name, content, ext }),
  createFolder: (dir: string, name: string): Promise<string> =>
    ipcRenderer.invoke('fs:createFolder', { dir, name }),
  rename: (filePath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke('fs:rename', { path: filePath, newName }),
  remove: (target: string): Promise<boolean> => ipcRenderer.invoke('fs:delete', target),
  move: (src: string, destDir: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:move', { src, destDir }),
  // ── in-workspace trash (.trash) ──
  /** Move a file/folder into the workspace trash. Returns its path inside .trash. */
  trashMove: (target: string): Promise<{ trashedPath: string }> =>
    ipcRenderer.invoke('trash:move', target),
  /** List trashed items (newest first). */
  trashList: (): Promise<TrashItem[]> => ipcRenderer.invoke('trash:list'),
  /** Restore one item to its original location. Returns the restored path (or null). */
  trashRestore: (trashedPath: string): Promise<string | null> =>
    ipcRenderer.invoke('trash:restore', trashedPath),
  /** Permanently remove one trashed item (→ OS Trash). */
  trashDeleteOne: (trashedPath: string): Promise<boolean> =>
    ipcRenderer.invoke('trash:deleteOne', trashedPath),
  /** Empty the whole trash (each item → OS Trash). */
  trashEmpty: (): Promise<boolean> => ipcRenderer.invoke('trash:empty'),
  message: (opts: {
    message: string;
    detail?: string;
    buttons: string[];
    cancelId?: number;
  }): Promise<number> => ipcRenderer.invoke('dialog:message', opts),

  // ── macOS Reminders sync ──
  remindersAvailable: (): Promise<boolean> => ipcRenderer.invoke('reminders:available'),
  reminderCreate: (opts: {
    title: string;
    dueDate: string | null;
    nodeId: string;
  }): Promise<ReminderInfo> => ipcRenderer.invoke('reminders:create', opts),
  reminderUpdate: (opts: {
    id: string;
    title: string;
    completed: boolean;
    dueDate: string | null;
  }): Promise<string | null> => ipcRenderer.invoke('reminders:update', opts),
  reminderDelete: (id: string): Promise<void> => ipcRenderer.invoke('reminders:delete', id),
  reminderQuery: (): Promise<ReminderInfo[]> => ipcRenderer.invoke('reminders:query'),
  reminderHeartbeat: (): Promise<{ ok: boolean; kind?: 'timeout' | 'denied' | 'error' }> =>
    ipcRenderer.invoke('reminders:heartbeat'),

  /** Write a scoped event to the app log file (metadata only — never user content). */
  log: (level: 'error' | 'warn' | 'info' | 'debug', scope: string, message: string): void =>
    ipcRenderer.send('log:event', { level, scope, message }),

  /** Fetch a web page's HTML in the main process (no CORS), for "URL → note". */
  webFetch: (
    url: string,
  ): Promise<
    { ok: true; finalUrl: string; status: number; html: string } | { ok: false; error: string }
  > => ipcRenderer.invoke('web:fetch', url),

  /** Subscribe to window-focus events (for sidebar refresh). Returns an unsubscribe function. */
  onWorkspaceFocus: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('workspace:focus', handler);
    return () => {
      ipcRenderer.off('workspace:focus', handler);
    };
  },

  /** Subscribe to native menu commands. Returns an unsubscribe function. */
  onMenu: (cb: (action: string) => void) => {
    const handler = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on('menu', handler);
    return () => {
      ipcRenderer.off('menu', handler);
    };
  },

  // ── auto-update (manual check drives an in-app popup) ──────────────────────
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  /** Subscribe to update status pushes. Returns an unsubscribe function. */
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const handler = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on('update:status', handler);
    return () => {
      ipcRenderer.off('update:status', handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
