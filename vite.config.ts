import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { aiPlugin } from './server/aiPlugin';

export default defineConfig(({ command, mode, isPreview }) => ({
  // GitHub Pages serves the app from /PXLBuilder/ (so do builds and `vite preview`); the dev server stays at the root.
  base: command === 'build' || isPreview ? '/PXLBuilder/' : '/',
  // Loads .env / .env.local without a VITE_ prefix filter; values stay on the server and are never exposed to the client bundle.
  plugins: [react(), aiPlugin(loadEnv(mode, process.cwd(), ''))],
  // `--mode single-file` builds one script (no lazy chunks), for hosting the app as a single page.
  build: mode === 'single-file' ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {},
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
