import { defineConfig } from 'vite';

/** Lärversionen publiceras på /runornas-kall-laro/. */
export default defineConfig({
  base: '/runornas-kall-laro/',
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
});
