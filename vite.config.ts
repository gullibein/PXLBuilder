import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { aiPlugin } from './server/aiPlugin';

/** Which build this is (commit and build time), shown in the ⋯ menu so you can tell whether a page is up to date. */
function buildVersion(): string {
  let commit = 'dev';
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    // Not a git checkout.
  }
  return `${commit} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default defineConfig(({ command, mode, isPreview }) => ({
  define: { __PXL_VERSION__: JSON.stringify(buildVersion()) },
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
