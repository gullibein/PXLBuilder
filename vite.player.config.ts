import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The game player: a page that only plays a game (the runtime and the play
 * screen, no editor), built into one file that "Export game" fills with a game.
 * Built by scripts/build-player.mjs.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-player',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: 'player.html', output: { inlineDynamicImports: true } },
  },
});
