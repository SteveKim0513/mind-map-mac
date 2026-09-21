import { create } from 'zustand';
import type { MetaTemplate } from '../types';
import { parseNote, serializeNote } from '../io/noteFormat';
import { patchNoteFile } from './sharedNoteSave';
import { useWorkspace } from './workspaceStore';

interface MetaState {
  templates: MetaTemplate[];
  loaded: boolean;
  load: () => Promise<void>;
  addTemplate: (t: MetaTemplate) => Promise<void>;
  updateTemplate: (t: MetaTemplate) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
}

function collectMdPaths(tree: import('../../electron/preload').TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: typeof tree) => {
    for (const n of nodes) {
      if (n.type === 'dir' && n.children) walk(n.children);
      else if (n.type === 'file' && n.path.endsWith('.md')) out.push(n.path);
    }
  };
  walk(tree);
  return out;
}

export const useMetaStore = create<MetaState>((set, get) => ({
  templates: [],
  loaded: false,

  load: async () => {
    const templates = await window.api.meta.getTemplates();
    set({ templates, loaded: true });
  },

  addTemplate: async (t) => {
    const templates = [...get().templates, t];
    set({ templates });
    await window.api.meta.saveTemplates(templates);
  },

  updateTemplate: async (t) => {
    const templates = get().templates.map((x) => (x.id === t.id ? t : x));
    set({ templates });
    await window.api.meta.saveTemplates(templates);
  },

  removeTemplate: async (id) => {
    const templates = get().templates.filter((x) => x.id !== id);
    set({ templates });
    await window.api.meta.saveTemplates(templates);

    // Cascade: remove this template's blocks from every note file
    const { tree } = useWorkspace.getState();
    const paths = collectMdPaths(tree);
    const attached = await window.api.attachedNotes().catch(() => [] as string[]);
    await Promise.allSettled([...paths, ...attached].map(async (path) => {
      try {
        // 공유 폴더의 노트라면 복제 매니저의 큐 안에서 고친다(원격 편집을 옛 본문으로 되돌리지 않게).
        const shared = await patchNoteFile(path, (n) => {
          if (!n.metaBlocks?.some((b) => b.templateId === id)) return null;
          return { ...n, metaBlocks: n.metaBlocks.filter((b) => b.templateId !== id) };
        });
        if (shared.status !== 'not_shared') return;
        const raw = await window.api.readFile(path);
        const note = parseNote(raw, '');
        if (!note.metaBlocks?.some((b) => b.templateId === id)) return;
        const filtered = note.metaBlocks.filter((b) => b.templateId !== id);
        await window.api.save(path, serializeNote({ ...note, metaBlocks: filtered }));
      } catch { /* skip unreadable files */ }
    }));

  },
}));
