import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { makeAutotileFrames, rampFromAutotile } from './autotile';
import { createProject } from './factory';
import * as m from './mutations';

const registry = createBuiltinRegistry();
const dirt = { palette: [{ key: 'd', color: '#8a5a2b' }, { key: 'k', color: '#6b421e' }], rows: Array.from({ length: 8 }, (_, y) => (y % 3 ? 'dddddddd' : 'ddkddddk')) };

describe('ramps in the look of the ground', () => {
  it("the ground's top edge (its grass) runs along the slope, its earth under it; nothing above the slope", () => {
    const { frames } = makeAutotileFrames(dirt, { edge: 'none', top: 'grass', round: false });
    const { rows, band } = rampFromAutotile(frames, 1);
    expect(band).toBeGreaterThan(0);
    // Rising to the right: column 0's surface is the bottom row, column 7's the top row.
    expect(rows.map((r) => r[0]).join('')).toBe('.......' + frames[14][0][0]);
    expect(rows[0][7]).toBe(frames[14][0][7]);
    // Under the surface, the same rows of grass as the flat ground's top, slanted.
    for (let k = 0; k < band; k++) expect(rows[7 - 3 + k]?.[3]).toBe(frames[14][k][3]);
    // Rising to the left: the mirror image of where the surface is.
    const left = rampFromAutotile(frames, -1).rows;
    expect(left.map((r) => r[7]).join('')).toBe('.......' + frames[14][0][7]);
  });

  it('making the ground an autotile gives the starter ramps its look (and how thick its grass is)', () => {
    const p0 = createProject(registry);
    const ground = p0.definitions.find((d) => d.name === 'Platform')!.id;
    const p = produce(p0, (d) => void m.makeAutotile(d, ground, { edge: 'none', top: 'grass', round: false }, registry));
    for (const name of ['Ramp', 'Ramp left']) {
      const ramp = p.definitions.find((d) => d.name === name)!;
      const asset = p.assets.find((a) => a.id === ramp.components.Sprite!.assetId)!;
      expect(JSON.parse(asset.description!)).toEqual({ rampOf: ground });
      expect(ramp.components.Sprite!.rampBand).toBeGreaterThan(0);
    }
    // Made again (another style): the ramps follow, the old pictures go.
    const q = produce(p, (d) => void m.makeAutotile(d, ground, { edge: 'outline', top: 'light', round: false }, registry));
    const before = p.definitions.find((d) => d.name === 'Ramp')!.components.Sprite!.assetId;
    const after = q.definitions.find((d) => d.name === 'Ramp')!.components.Sprite!.assetId;
    expect(after).not.toBe(before);
    expect(q.assets.some((a) => a.id === before)).toBe(false);
  });
});
