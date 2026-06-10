import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // Keep node-side deps external (required from node_modules at runtime) rather
        // than bundled — electron-log relies on internal requires that don't bundle well.
        vite: { build: { rollupOptions: { external: ['electron-log', 'electron-log/main'] } } },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
  base: './',
  build: {
    outDir: 'dist',
  },
});
