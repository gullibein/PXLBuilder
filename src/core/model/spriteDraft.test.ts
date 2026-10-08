import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from './factory';
import * as m from './mutations';
import { addColor, addFrame, blankDraft, draftFromAsset, draftFromPixels, drawLine, fill, moveFrame, recolor, removeFrame, resize, setPixel, usedPalette } from './spriteDraft';

describe('sprite editor drafts', () => {
  it('pixels, lines without gaps, and fill of a connected area', () => {
    let d = blankDraft(4, 3);
    d = setPixel(d, 0, 1, 1, 'a');
    expect(d.frames[0]).toEqual(['....', '.a..', '....']);
    d = drawLine(blankDraft(4, 3), 0, 0, 0, 3, 2, 'a');
    expect(d.frames[0]).toEqual(['a...', '.aa.', '...a']);
    // A wall of "a" splits the picture: fill only reaches the left part.
    d = { ...blankDraft(4, 2), frames: [['.a..', '.a..']] };
    d = fill(d, 0, 0, 0, 'b');
    expect(d.frames[0]).toEqual(['ba..', 'ba..']);
    // Off the picture: nothing happens.
    expect(setPixel(d, 0, 9, 9, 'b')).toBe(d);
  });

  it('colors: added once, changed everywhere at once, and only used ones are saved', () => {
    let d = blankDraft(2, 1);
    const r = addColor(d, '#FF0000');
    if ('error' in r) throw new Error(r.error);
    expect(r.key).toBe('g');
    d = setPixel(r.draft, 0, 0, 0, r.key);
    const again = addColor(d, '#ff0000');
    expect('key' in again && again.key).toBe('g');
    d = recolor(d, 'g', '#00ff00');
    expect(d.palette.find((p) => p.key === 'g')!.color).toBe('#00ff00');
    expect(usedPalette(d)).toEqual([{ key: 'g', color: '#00ff00' }]);
  });

  it('frames: duplicate, add empty, move and delete (never the last one)', () => {
    let d = setPixel(blankDraft(2, 1), 0, 0, 0, 'a');
    d = addFrame(d, 0, true);
    expect(d.frames).toEqual([['a.'], ['a.']]);
    d = addFrame(d, 1, false);
    d = setPixel(d, 2, 1, 0, 'b');
    expect(d.frames).toEqual([['a.'], ['a.'], ['.b']]);
    d = moveFrame(d, 2, -1);
    expect(d.frames).toEqual([['a.'], ['.b'], ['a.']]);
    d = removeFrame(removeFrame(removeFrame(d, 0), 0), 0);
    expect(d.frames).toHaveLength(1);
  });

  it('resizing keeps pixels from the top left and pads with transparency', () => {
    const d = resize({ ...blankDraft(2, 2), frames: [['ab', 'ba']] }, 3, 1);
    expect(d.frames[0]).toEqual(['ab.']);
  });

  it('an imported image becomes pixel art (each color a palette key), unless too big', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255]);
    const d = draftFromPixels(px, 2, 2);
    if ('error' in d) throw new Error(d.error);
    expect(d.palette).toEqual([{ key: 'a', color: '#ff0000' }, { key: 'b', color: '#0000ff' }]);
    expect(d.frames[0]).toEqual(['a.', 'ab']);
    expect(draftFromPixels(new Uint8ClampedArray(100 * 100 * 4), 100, 100)).toMatchObject({ error: expect.stringMatching(/up to 64×64/) });
  });

  it('saving updates the sprite in place: a picture becomes an animation and back, same id', () => {
    const registry = createBuiltinRegistry();
    let project = createProject(registry);
    const asset = project.assets.find((a) => a.name === 'Player')!;
    const draft = draftFromAsset(asset)!;
    expect(draft.frames).toHaveLength(1);
    const two = addFrame(draft, 0, true);
    project = produce(project, (p) => m.updatePixelArtAsset(p, asset.id, usedPalette(two), two.frames, 6));
    const animated = project.assets.find((a) => a.id === asset.id)!;
    expect(animated).toMatchObject({ kind: 'spritesheet', animation: { frames: [1, 2], fps: 6 }, width: draft.width * 2 });
    expect(draftFromAsset(animated)!.frames).toHaveLength(2);
    project = produce(project, (p) => m.updatePixelArtAsset(p, asset.id, usedPalette(draft), draft.frames, 8));
    const still = project.assets.find((a) => a.id === asset.id)!;
    expect(still.kind).toBe('image');
    expect(still.animation).toBeUndefined();
    expect(still.grid).toBeUndefined();
  });
});

describe('selections', () => {
  const d0 = { ...blankDraft(4, 3), frames: [['ab..', 'c...', '....']] };

  it('a rectangle between two corners, clipped to the picture', async () => {
    const { rectBetween } = await import('./spriteDraft');
    expect(rectBetween(d0, { x: 2, y: 2 }, { x: 0, y: 1 })).toEqual({ x: 0, y: 1, w: 3, h: 2 });
    expect(rectBetween(d0, { x: -3, y: 0 }, { x: 9, y: 0 })).toEqual({ x: 0, y: 0, w: 4, h: 1 });
  });

  it('copy, clear, move (transparent pixels keep what is under them) and flip', async () => {
    const { copyRect, clearRect, moveRect, flipRect, stamp } = await import('./spriteDraft');
    const r = { x: 0, y: 0, w: 2, h: 2 };
    expect(copyRect(d0, 0, r)).toEqual(['ab', 'c.']);
    expect(clearRect(d0, 0, r).frames[0]).toEqual(['....', '....', '....']);
    expect(moveRect(d0, 0, r, 2, 1).frames[0]).toEqual(['....', '..ab', '..c.']);
    // Moved over other pixels: its transparent pixel doesn't erase what is there.
    const busy = { ...d0, frames: [['ab..', 'c...', '...d']] };
    expect(moveRect(busy, 0, r, 2, 1).frames[0]).toEqual(['....', '..ab', '..cd']);
    expect(flipRect(d0, 0, r, 'x').frames[0]).toEqual(['ba..', '.c..', '....']);
    expect(flipRect(d0, 0, r, 'y').frames[0]).toEqual(['c...', 'ab..', '....']);
    // Pasting past the edge is clipped.
    expect(stamp(d0, 0, ['xy'], 3, 2).frames[0]).toEqual(['ab..', 'c...', '...x']);
  });
});
