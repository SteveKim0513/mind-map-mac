import { create } from 'zustand';
import type { TemplateSummary } from '../../electron/preload';
import { useWorkspace } from './workspaceStore';
import { emptyNote, serializeNote } from '../io/noteFormat';

interface TemplateState {
  enabled: boolean;
  items: TemplateSummary[];
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  create: (title: string) => Promise<string>;
  remove: (name: string) => Promise<void>;
}

function templatesDir(): string {
  return `${useWorkspace.getState().root}/.templates`;
}

/** Note Template feature (.templates workspace folder). Sidebar badge + toolbar
 *  dropdown + settings toggle all read from here. */
export const useTemplates = create<TemplateState>((set, get) => ({
  enabled: true,
  items: [],
  refresh: async () => {
    try {
      const [enabled, items] = await Promise.all([
        window.api.templates.isEnabled(),
        window.api.templates.list(),
      ]);
      set({ enabled, items });
    } catch {
      set({ items: [] });
    }
  },
  setEnabled: async (enabled) => {
    await window.api.templates.setEnabled(enabled);
    set({ enabled, items: await window.api.templates.list().catch(() => []) });
  },
  create: async (title) => {
    const path = await window.api.createFile(
      templatesDir(),
      title,
      serializeNote(emptyNote(title)),
      '.md',
    );
    await get().refresh();
    return path;
  },
  remove: async (name) => {
    await window.api.remove(`${templatesDir()}/${name}`);
    await get().refresh();
  },
}));
