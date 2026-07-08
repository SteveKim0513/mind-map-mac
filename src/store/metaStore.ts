import { create } from 'zustand';
import type { MetaTemplate } from '../types';

interface MetaState {
  templates: MetaTemplate[];
  loaded: boolean;
  load: () => Promise<void>;
  addTemplate: (t: MetaTemplate) => Promise<void>;
  updateTemplate: (t: MetaTemplate) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
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
  },
}));
