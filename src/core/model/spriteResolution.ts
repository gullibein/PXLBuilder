/**
 * Sprite size for the built-in objects: their pictures come in four
 * resolutions, 8, 16, 32 and 64 art pixels per 32 px tile (an 8×8, 16×16,
 * 32×32 or 64×64 sprite for a one-tile object; proportionally for others: the
 * 32×16 spikes get 16×8 at 16). 32 is how the objects ship.
 *
 * Every built-in object has one hand-made source drawing (its shipped picture;
 * new pixel art here for the ones that ship as plain boxes). The other sizes
 * are made from it: smaller by merging blocks of pixels (the color most of a
 * block has), larger with Scale2x, the pixel-art upscaler that rounds off
 * diagonal edges instead of just making the pixels bigger.
 *
 * Changing the size swaps only pictures that are still built-in ones (in any
 * size); objects that got their own drawing keep it.
 */
import type { AssetRecord, Project } from '../types';
import { eightBitArt } from './eightBitSet';
import { createAnimatedPixelArtAsset, pixelArtFields } from './factory';
import { MAX_PIXEL_SIDE, suggestedGrid, type PixelArt } from './pixelArt';

export const SPRITE_RESOLUTIONS = [8, 16, 32, 64] as const;
export type SpriteResolution = (typeof SPRITE_RESOLUTIONS)[number];
/** How the built-in objects ship. */
export const DEFAULT_SPRITE_RESOLUTION: SpriteResolution = 32;

/** Pixel art of one or more frames (all the same size). */
export interface Art {
  palette: PixelArt['palette'];
  frames: string[][];
  fps?: number;
}

/** Built-in objects that ship as plain colored boxes: their source drawings (16 pixels per tile). */
export const BOX_ART: Record<string, PixelArt> = {
  Platform: {
    palette: [{ key: 'g', color: '#5fa83f' }, { key: 'h', color: '#86d05c' }, { key: 'k', color: '#3f7d2a' }, { key: 'd', color: '#8a5a2b' }, { key: 'e', color: '#6e4521' }, { key: 's', color: '#a8743d' }],
    rows: [
      'hhhhhhhhhhhhhhhh',
      'gghggggghggggghg',
      'gggggggggggggggg',
      'kgkggkgggkgkggkg',
      'dkdddkdddddkdddk',
      'dddddddddddddddd',
      'ddsdddddedddddsd',
      'dddddeddddddsddd',
      'dddddddddddddddd',
      'ddeddddsdddddddd',
      'ddddddddddeddddd',
      'dsddddddddddddsd',
      'ddddeddddddddddd',
      'dddddddddsdddedd',
      'ddddddddddddddde',
      'eddddddeddddddde',
    ],
  },
  Stone: {
    palette: [{ key: 'a', color: '#8a8f9c' }, { key: 'b', color: '#a7acb8' }, { key: 'c', color: '#5f6470' }, { key: 'd', color: '#73788a' }],
    rows: [
      'bbbbbbbcbbbbbbbc',
      'baaaaaacbaaaaaac',
      'baaaadacbaaaaaac',
      'baaaaaacbaadaaac',
      'baaaaaacbaaaaaac',
      'baadaaacbaaaaaac',
      'baaaaaacbaaaaaac',
      'cccccccccccccccc',
      'bbbbbbbbbbbcbbbb',
      'baaaaaaaaaacbaaa',
      'baaadaaaaaacbaaa',
      'baaaaaaaaaacbada',
      'baaaaaaadaacbaaa',
      'baaaaaaaaaacbaaa',
      'baaaaaaaaaacbaaa',
      'cccccccccccccccc',
    ],
  },
  Coin: {
    palette: [{ key: 'o', color: '#b07d12' }, { key: 'a', color: '#f2c94c' }, { key: 'b', color: '#fff1a8' }],
    rows: ['..oooo..', '.oaaaao.', 'oabaaaao', 'oabaoaao', 'oaaaoaao', 'oaaaaaao', '.oaaaao.', '..oooo..'],
  },
  Key: {
    palette: [{ key: 'o', color: '#9a6a0c' }, { key: 'a', color: '#f0b429' }, { key: 'b', color: '#ffe08a' }],
    rows: ['.ooo......', 'oabooooooo', 'oa.aaaaaao', 'oabooooooo', '.ooo..o.o.', '......o.o.'],
  },
  Door: {
    palette: [{ key: 'o', color: '#4a2f17' }, { key: 'a', color: '#9b6a3c' }, { key: 'b', color: '#b8834f' }, { key: 'c', color: '#7c5129' }, { key: 'k', color: '#f2c94c' }],
    rows: [
      '....oooooooo....',
      '..ooaaaaaaaaoo..',
      '.oaaabbbbbbaaao.',
      '.oabbaaaaaabbao.',
      'oaabaaaaaaaabaao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaaaaaaaaaabao',
      'oabbbbbbbbbbbbao',
      'oaaaaaaaaaaaaaao',
      'oabbbbbbbbbbbbao',
      'oabaaaaaaaaaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacakbao',
      'oabaacaaaacakbao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaacaaaacaabao',
      'oabaaaaaaaaaabao',
      'oabbbbbbbbbbbbao',
      'oaaaaaaaaaaaaaao',
      'occcccccccccccco',
      'oooooooooooooooo',
    ],
  },
};

/**
 * The few pictures that don't survive merging down to 8 pixels a tile (an X that turns into a smudge, round
 * things that turn square), drawn by hand at that size with their own colors. By the picture's name.
 */
export const HAND_DRAWN_8: Record<string, string[]> = {
  Crate: ['kkkkkkkk', 'klllllll', 'kldwwdlk', 'klwddwlk', 'klwddwlk', 'kldwwdlk', 'kldddddk', 'kkkkkkkk'],
  Enemy: ['.oooooo.', 'obbbbbbo', 'oaaaaaao', 'oadaadao', 'oaoaaoao', 'oaaaaaao', 'occcccco', 'oooooooo'],
  Barrel: ['..kkkk..', '.kiiiik.', 'kwlwwdwk', 'kiiiiiik', 'kwlwwdwk', 'kwlwwdwk', '.kiiiik.', '..kkkk..'],
  Coin: ['.oo.', 'obao', 'oaao', '.oo.'],
  'Floor spikes': ['kkkkkkkk', 'kphpphpk', 'khgphgpk', 'kppppppk', 'kphpphpk', 'khgphgpk', 'kppppppk', 'kkkkkkkk'],
};

/** Pixel art from a simple SVG of rectangles (the shipped ladder and lever pictures). */
export function svgRectsToArt(svg: string, width: number, height: number): PixelArt {
  const grid = Array.from({ length: height }, () => Array<string>(width).fill('.'));
  const keys = new Map<string, string>();
  const KEYS = 'abcdefghijklmnopqrstuvwxyz';
  for (const m of svg.matchAll(/<rect\s+([^>]*?)\/?>/g)) {
    const attr = (n: string) => Number(new RegExp(`\\b${n}="([\\d.]+)"`).exec(m[1])?.[1] ?? 0);
    const fill = /fill="(#[0-9a-fA-F]{6})"/.exec(m[1])?.[1];
    if (!fill) continue;
    if (!keys.has(fill)) keys.set(fill, KEYS[keys.size]);
    const key = keys.get(fill)!;
    for (let y = attr('y'); y < Math.min(height, attr('y') + attr('height')); y++) for (let x = attr('x'); x < Math.min(width, attr('x') + attr('width')); x++) grid[y][x] = key;
  }
  return { palette: [...keys].map(([color, key]) => ({ key, color })), rows: grid.map((r) => r.join('')) };
}

/** Twice the size, Scale2x: corners take a neighbour's color where two neighbours agree (smooth diagonals). */
export function scale2x(rows: string[]): string[] {
  const h = rows.length;
  const w = rows[0].length;
  const at = (x: number, y: number, p: string) => (x < 0 || y < 0 || x >= w || y >= h ? p : rows[y][x]);
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let top = '';
    let bottom = '';
    for (let x = 0; x < w; x++) {
      const p = rows[y][x];
      const a = at(x, y - 1, p);
      const b = at(x + 1, y, p);
      const c = at(x - 1, y, p);
      const d = at(x, y + 1, p);
      top += (c === a && c !== d && a !== b ? a : p) + (a === b && a !== c && b !== d ? b : p);
      bottom += (d === c && d !== b && c !== a ? c : p) + (b === d && b !== a && d !== c ? d : p);
    }
    out.push(top, bottom);
  }
  return out;
}

/**
 * `k` times smaller: each k×k block becomes the color most of it has (transparent when less than half of it is
 * drawn), so outlines and solid shapes survive.
 */
export function shrink(rows: string[], k: number): string[] {
  const h = Math.ceil(rows.length / k);
  const w = Math.ceil(rows[0].length / k);
  const out: string[] = [];
  for (let by = 0; by < h; by++) {
    let line = '';
    for (let bx = 0; bx < w; bx++) {
      const counts = new Map<string, number>();
      let drawn = 0;
      let cells = 0;
      for (let y = by * k; y < Math.min(rows.length, by * k + k); y++) {
        for (let x = bx * k; x < Math.min(rows[0].length, bx * k + k); x++) {
          cells++;
          const key = rows[y][x];
          if (key === '.') continue;
          drawn++;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      if (drawn * 2 < cells) line += '.';
      else line += [...counts].sort((p, q) => q[1] - p[1])[0][0];
    }
    out.push(line);
  }
  return out;
}

/** The resolution a drawing has for a sprite of this size (art pixels per 32 px tile, by its width). */
export function resolutionOf(gridWidth: number, spriteWidth: number): number {
  return (gridWidth * 32) / Math.max(1, spriteWidth);
}

/**
 * A drawing at another resolution: halved or doubled as many times as it takes (frames alike), never past the
 * largest sprite (64 pixels a side): then as close as fits.
 */
export function artAtResolution(art: Art, from: number, to: number): Art {
  let steps = Math.round(Math.log2(to / from));
  const w = art.frames[0][0].length;
  const h = art.frames[0].length;
  while (steps > 0 && Math.max(w, h) * 2 ** steps > MAX_PIXEL_SIDE) steps--;
  if (steps === 0) return art;
  const frames = art.frames.map((rows) => {
    let r = rows;
    if (steps > 0) for (let i = 0; i < steps; i++) r = scale2x(r);
    else r = shrink(r, 2 ** -steps);
    return r;
  });
  // Colors a smaller picture no longer uses are dropped.
  const used = new Set(frames.flatMap((f) => [...f.join('')]));
  return { palette: art.palette.filter((p) => used.has(p.key)), frames, fps: art.fps };
}

/** The drawing an asset holds, or null for a picture that isn't pixel art. */
function artOf(asset: AssetRecord): Art | null {
  if (!asset.pixelArt) return null;
  return { palette: asset.pixelArt.palette, frames: asset.pixelArt.frames ?? [asset.pixelArt.rows], fps: asset.animation?.fps };
}

/** A built-in picture at a resolution, as asset fields (the data string tells sizes apart). */
function variantFields(source: Art, sourceRes: number, res: number, name: string) {
  const hand = res === 8 && source.frames.length === 1 ? HAND_DRAWN_8[name] : undefined;
  const fitsHand = hand && hand[0].length === Math.ceil((source.frames[0][0].length * 8) / sourceRes);
  const art = fitsHand ? { palette: source.palette.filter((p) => hand.join('').includes(p.key)), frames: [hand] } : artAtResolution(source, sourceRes, res);
  return pixelArtFields(art.palette, art.frames, art.fps ?? 8);
}

export interface StarterLook {
  /** What it is (the object's name and, for a situation's look, which one). */
  name: string;
  /** The shipped picture, or null for an object that ships as a plain box. */
  shipped: AssetRecord | null;
  /** Its source drawing and that drawing's resolution. */
  source: Art;
  sourceRes: number;
  /** Its own drawing for the 8-pixel size (the hand-drawn 8-pixel set), when it has one. */
  eight?: Art;
}

/** A starter object's look (its picture, or a situation's) with its source drawing. */
export function starterLook(name: string, shipped: AssetRecord | null, spriteWidth: number): StarterLook | null {
  if (shipped) {
    const art = artOf(shipped);
    if (art) return { name, shipped, source: art, sourceRes: resolutionOf(art.frames[0][0].length, spriteWidth) };
    if (shipped.data.startsWith('data:image/svg+xml')) {
      const svg = decodeURIComponent(shipped.data.slice(shipped.data.indexOf(',') + 1));
      const drawn = svgRectsToArt(svg, shipped.width, shipped.height);
      return { name, shipped, source: { palette: drawn.palette, frames: [drawn.rows] }, sourceRes: resolutionOf(shipped.width, spriteWidth) };
    }
    return null;
  }
  const box = BOX_ART[name];
  return box ? { name, shipped: null, source: { palette: box.palette, frames: [box.rows] }, sourceRes: resolutionOf(box.rows[0].length, spriteWidth) } : null;
}

/** The look at a resolution: the shipped picture (or plain box: null) at 32, else a made one. */
export function lookAt(look: StarterLook, res: SpriteResolution): Pick<AssetRecord, 'kind' | 'data' | 'width' | 'height' | 'grid' | 'pixelArt' | 'animation'> | null {
  if (res === DEFAULT_SPRITE_RESOLUTION) return look.shipped ?? null;
  if (res === 8 && look.eight) return pixelArtFields(look.eight.palette, look.eight.frames, look.eight.fps ?? 8);
  return variantFields(look.source, look.sourceRes, res, look.shipped?.name ?? look.name);
}

/** Every data string the look has in any size (to tell whether an object still has its built-in look). */
export function lookData(look: StarterLook): Set<string> {
  const out = new Set<string>();
  for (const r of SPRITE_RESOLUTIONS) {
    const f = lookAt(look, r);
    if (f) out.add(f.data);
  }
  // The earlier 8-pixel pictures (made from the 16-pixel ones) count as built-in too, so they get replaced.
  out.add(variantFields(look.source, look.sourceRes, 8, look.shipped?.name ?? look.name).data);
  return out;
}

/**
 * Gives every built-in object that still has a built-in look the pictures of that resolution (its normal look and
 * its situations' looks), and remembers the choice for the game. Objects with their own drawings are left alone.
 * Returns the names of the objects changed.
 */
export function setSpriteResolution(
  project: Project,
  res: SpriteResolution,
  starters: { name: string; sprite: { width: number; assetId: string | null }; states: Record<string, string>; assets: AssetRecord[] }[],
): string[] {
  project.settings.spriteResolution = res;
  const changed: string[] = [];
  for (const s of starters) {
    const def = project.definitions.find((d) => (typeof d.metadata.starter === 'string' ? d.metadata.starter : d.name) === s.name);
    const sprite = def?.components.Sprite as Record<string, unknown> | undefined;
    if (!def || !sprite) continue;
    let touched = false;
    // The normal look, then each situation's.
    const slots: { get: () => unknown; set: (id: string | null) => void; shipped: AssetRecord | null; label: string; situation: string | null }[] = [
      { get: () => sprite.assetId, set: (id) => (sprite.assetId = id), shipped: s.assets.find((a) => a.id === s.sprite.assetId) ?? null, label: s.name, situation: null },
      ...Object.entries(s.states).map(([situation, id]) => {
        const states = def.components.SpriteStates as Record<string, unknown> | undefined;
        return { get: () => states?.[situation], set: (v: string | null) => states && (states[situation] = v), shipped: s.assets.find((a) => a.id === id) ?? null, label: `${s.name} (${situation})`, situation };
      }),
    ];
    for (const slot of slots) {
      const found = starterLook(slot.label, slot.shipped, Number(sprite.width) || s.sprite.width);
      if (!found) continue;
      const look: StarterLook = { ...found, eight: eightBitArt(project.settings.gameType ?? 'platformer', s.name, slot.situation) ?? undefined };
      const current = project.assets.find((a) => a.id === slot.get()) ?? null;
      const builtIn = lookData(look);
      // Still a built-in look: no picture yet (a shipped plain box), or one of the built-in pictures.
      const isBuiltIn = current ? builtIn.has(current.data) : slot.get() == null && look.shipped === null;
      if (!isBuiltIn) continue;
      const fields = lookAt(look, res);
      let id: string | null = null;
      if (fields) {
        const existing = project.assets.find((a) => a.data === fields.data);
        if (existing) id = existing.id;
        else {
          const name = res === DEFAULT_SPRITE_RESOLUTION ? look.name : `${look.name} ${res}`;
          const asset = look.shipped && res === DEFAULT_SPRITE_RESOLUTION ? structuredClone(look.shipped) : createAnimatedPixelArtAsset(name, fields.pixelArt!.palette, fields.pixelArt!.frames ?? [fields.pixelArt!.rows], fields.animation?.fps ?? 8);
          project.assets.push(asset);
          id = asset.id;
        }
      }
      if (slot.get() !== id) {
        slot.set(id);
        touched = true;
      }
    }
    if (touched) changed.push(def.name);
  }
  return changed;
}

/** The grid to draw a new picture on for an object of this size in a game of this sprite size (as shipped: the usual one). */
export function gridFor(size: { x: number; y: number }, res: number | undefined): { width: number; height: number } {
  if (!res || res === DEFAULT_SPRITE_RESOLUTION) return suggestedGrid(size);
  return suggestedGrid({ x: (size.x * res) / 32, y: (size.y * res) / 32 }, MAX_PIXEL_SIDE);
}
