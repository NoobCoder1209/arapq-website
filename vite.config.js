import { defineConfig } from 'vite';

// On GitHub Pages the site is served from /arapq-website/, so we set the base
// to that subpath only when building for production. In dev (npm run dev)
// it stays at /, so localhost works without prefixing every URL.
export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? '/arapq-website/' : '/',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
}));
