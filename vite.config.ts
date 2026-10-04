import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { aiPlugin } from './server/aiPlugin';

export default defineConfig(({ mode }) => ({
  // Loads .env / .env.local without a VITE_ prefix filter; values stay on the server and are never exposed to the client bundle.
  plugins: [react(), aiPlugin(loadEnv(mode, process.cwd(), ''))],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
