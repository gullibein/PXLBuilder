/**
 * Builds the standalone game player (vite.player.config.ts) and turns it into
 * one HTML template, with its script and styles inline and a place for the
 * game. The editor's "Export game" fills that place: src/player/template.generated.ts.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

await build({ configFile: 'vite.player.config.ts', logLevel: 'warn' });
const dir = 'dist-player';
const html = readFileSync(join(dir, 'player.html'), 'utf8');
const assets = readdirSync(join(dir, 'assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
// Nothing in them may end the inline element early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const safeCss = css.replace(/<\/style/gi, '<\\/style');
let page = html
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => `<script type="module">\n${safeJs}\n</script>`)
  .replace(/<link rel="stylesheet"[^>]*href="[^"]*"[^>]*>/, () => `<style>\n${safeCss}\n</style>`);
if (!page.includes(safeJs)) throw new Error('The player script was not inlined');
if (!page.includes('<style>')) page = page.replace('</head>', () => `<style>\n${safeCss}\n</style>\n</head>`);
// Where the game goes (before the script, which reads it).
page = page.replace('</head>', '<!--PXL_GAME-->\n</head>');
writeFileSync(
  'src/player/template.generated.ts',
  `// Made by scripts/build-player.mjs (npm run build:player): the game player page, waiting for a game.\nexport const PLAYER_TEMPLATE = ${JSON.stringify(page)};\n`,
);
console.log(`Game player template: ${Math.round(page.length / 1024)} KB`);
