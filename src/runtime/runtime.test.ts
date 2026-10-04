import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Project, Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** A level: a row of ground tiles at y=48 (top at 32) from x=-160..160, a player above it. */
function level(extra: (p: Project, sceneId: string, def: (n: string) => string) => void = () => {}) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  const def = (name: string) => project.definitions.find((d) => d.name === name)!.id;
  project = produce(project, (d) => {
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = -144; x <= 144; x += 32) place('Platform', { x, y: 48 });
    place('Player', { x: 0, y: -100 });
    extra(d, sceneId, def);
  });
  return { project, sceneId };
}

function run(rt: Runtime, input: InputState, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    rt.update(1 / 60, input);
  }
}

describe('runtime', () => {
  it('the player falls with gravity and lands exactly on the platform', () => {
    const { project, sceneId } = level();
    const rt = new Runtime(project, sceneId, registry);
    const player = rt.find('Player')!;
    run(rt, new InputState(), 1.5);
    expect(player.grounded).toBe(true);
    expect(player.vy).toBe(0);
    expect(player.y).toBeCloseTo(32 - 16, 5); // tile top 32; the player is one tile (32px) tall
  });

  it('weaker gravity makes the fall slower', () => {
    const fallAfter = (gy: number) => {
      const { project, sceneId } = level((p, sid) => m.setWorldSettings(p, sid, { gravity: { x: 0, y: gy } }));
      const rt = new Runtime(project, sceneId, registry);
      run(rt, new InputState(), 0.25);
      return rt.find('Player')!.y;
    };
    expect(fallAfter(490)).toBeLessThan(fallAfter(980));
  });

  it('runs right while the key is held, at the controller speed', () => {
    const { project, sceneId } = level();
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    run(rt, input, 1);
    input.press('right');
    run(rt, input, 0.5);
    const p = rt.find('Player')!;
    expect(p.vx).toBeCloseTo(200, 0);
    expect(p.x).toBeGreaterThan(60);
    input.release('right');
    run(rt, input, 0.5);
    expect(Math.abs(p.vx)).toBeLessThan(1);
  });

  it('jumps about jumpForce²/(2g) high and lands again', () => {
    const { project, sceneId } = level();
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    run(rt, input, 1);
    const p = rt.find('Player')!;
    const floorY = p.y;
    input.press('jump');
    let top = floorY;
    run(rt, input, 1.2, () => (top = Math.min(top, p.y)));
    const expected = (p.controller!.jumpForce ** 2) / (2 * 980);
    expect(floorY - top).toBeGreaterThan(expected * 0.9);
    expect(floorY - top).toBeLessThan(expected * 1.05);
    expect(p.grounded).toBe(true);
  });

  it('a short tap makes a lower jump than holding', () => {
    const height = (holdSteps: number) => {
      const { project, sceneId } = level();
      const rt = new Runtime(project, sceneId, registry);
      const input = new InputState();
      run(rt, input, 1);
      const p = rt.find('Player')!;
      const floor = p.y;
      let top = floor;
      let n = 0;
      input.press('jump');
      run(rt, input, 1, () => {
        if (++n === holdSteps) input.release('jump');
        top = Math.min(top, p.y);
      });
      return floor - top;
    };
    expect(height(3)).toBeLessThan(height(60) * 0.7);
  });

  it('cannot walk through a wall, and does not snag on tile seams', () => {
    const { project, sceneId } = level((p, sid) => {
      const stone = p.definitions.find((d) => d.name === 'Stone')!;
      m.addEntity(p, sid, instantiateDefinition(stone, { x: 112, y: 16 }));
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    run(rt, input, 1);
    input.press('right');
    run(rt, input, 2);
    const p = rt.find('Player')!;
    // Wall's left face at 96; player half-width 14.
    expect(p.x).toBeCloseTo(96 - 14, 5);
    expect(p.grounded).toBe(true);
    input.release('right');
    input.press('left');
    run(rt, input, 0.5);
    expect(p.x).toBeLessThan(0); // crossed several tile seams without stopping
  });

  it('climbs a ladder, stands on its top, and climbs back down', () => {
    // Ladder column at x=80 from y=16 up to y=-112 (5 pieces) standing on the ground row.
    const { project, sceneId } = level((p, sid) => {
      const ladder = p.definitions.find((d) => d.name === 'Ladder')!;
      for (let y = 16; y >= -112; y -= 32) m.addEntity(p, sid, instantiateDefinition(ladder, { x: 80, y }));
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    const p = rt.find('Player')!;
    run(rt, input, 1);
    input.press('right');
    run(rt, input, 0.4, () => {
      if (p.x > 76) input.release('right');
    });
    input.release('right');
    input.press('up');
    run(rt, input, 2.5);
    input.release('up');
    run(rt, input, 0.5);
    // Top of the ladder is at -128; standing on it puts the player's center 16px above.
    expect(p.climbing).toBe(false);
    expect(p.y).toBeCloseTo(-128 - 16, 0);
    input.press('down');
    run(rt, input, 0.3);
    expect(p.climbing).toBe(true);
    expect(p.y).toBeGreaterThan(-144 + 20);
  });

  /** Player standing on the ground right at a 5-piece ladder (x=80, from the ground up to y=-128). */
  function atLadder() {
    const { project, sceneId } = level((p, sid) => {
      const ladder = p.definitions.find((d) => d.name === 'Ladder')!;
      for (let y = 16; y >= -112; y -= 32) m.addEntity(p, sid, instantiateDefinition(ladder, { x: 80, y }));
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    const p = rt.find('Player')!;
    run(rt, input, 1);
    input.press('right');
    run(rt, input, 0.4, () => {
      if (p.x > 76) input.release('right');
    });
    input.release('right');
    return { rt, input, p };
  }

  it('climbing down to the floor ends the climb, and you can walk away', () => {
    const { rt, input, p } = atLadder();
    input.press('up');
    run(rt, input, 0.5);
    input.release('up');
    expect(p.climbing).toBe(true);
    input.press('down');
    run(rt, input, 1.5);
    input.release('down');
    expect(p.climbing).toBe(false);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(16, 0);
    const x = p.x;
    input.press('left');
    run(rt, input, 0.5);
    expect(p.x).toBeLessThan(x - 40);
  });

  it('a small sideways move keeps you on the ladder; moving half off it lets go and you fall', () => {
    const { rt, input, p } = atLadder();
    input.press('up');
    run(rt, input, 0.4);
    input.release('up');
    expect(p.climbing).toBe(true);
    const y = p.y;
    expect(y).toBeLessThan(-40);
    input.press('right');
    run(rt, input, 1 / 30); // a tap
    input.release('right');
    run(rt, input, 0.2);
    expect(p.climbing).toBe(true);
    expect(p.y).toBeCloseTo(y, 0); // still holding on, not falling
    input.press('right');
    run(rt, input, 0.15);
    input.release('right');
    expect(p.climbing).toBe(false); // less than half of the player is on the ladder now
    run(rt, input, 1);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(16, 0); // fell to the floor
  });

  it('Left/Right at the bottom of the ladder walks off it', () => {
    const { rt, input, p } = atLadder();
    input.press('up');
    run(rt, input, 0.1);
    input.release('up');
    expect(p.climbing).toBe(true);
    input.press('left');
    run(rt, input, 0.5);
    expect(p.climbing).toBe(false);
    expect(p.x).toBeLessThan(80 - 40);
    expect(p.grounded).toBe(true);
  });

  it('climbs at the same speed as it runs', () => {
    const { rt, input, p } = atLadder();
    input.press('up');
    run(rt, input, 0.2);
    expect(p.climbing).toBe(true);
    expect(Math.abs(p.vy)).toBe(p.controller!.speed);
  });

  it('grabs a ladder only when at least half of the player is inside the ladder tile', () => {
    // Ladder tile at x=80 covers 64..96; the player is 28px wide.
    const grabAt = (x: number) => {
      const { project, sceneId } = level((p, sid) => {
        const ladder = p.definitions.find((d) => d.name === 'Ladder')!;
        for (let y = 16; y >= -48; y -= 32) m.addEntity(p, sid, instantiateDefinition(ladder, { x: 80, y }));
        const player = p.scenes[0].entities.find((e) => e.name === 'Player')!;
        player.transform.position = { x, y: 0 };
      });
      const rt = new Runtime(project, sceneId, registry);
      const input = new InputState();
      run(rt, input, 0.5);
      input.press('up');
      run(rt, input, 0.2);
      return rt.find('Player')!.climbing;
    };
    expect(grabAt(64)).toBe(true); // exactly half inside (64..78 of 50..78)
    expect(grabAt(80)).toBe(true);
    expect(grabAt(59)).toBe(false); // only 9px of 28 inside
    expect(grabAt(101)).toBe(false);
  });

  it('climbing up or down eases the player into the middle of the ladder, unless Left/Right is held', () => {
    const climbFrom = (x: number, withRight: boolean) => {
      const { project, sceneId } = level((p, sid) => {
        const ladder = p.definitions.find((d) => d.name === 'Ladder')!;
        for (let y = 16; y >= -144; y -= 32) m.addEntity(p, sid, instantiateDefinition(ladder, { x: 80, y }));
        p.scenes[0].entities.find((e) => e.name === 'Player')!.transform.position = { x, y: 0 };
      });
      const rt = new Runtime(project, sceneId, registry);
      const input = new InputState();
      run(rt, input, 0.5);
      input.press('up');
      run(rt, input, 0.1);
      if (withRight) input.press('right');
      run(rt, input, 0.1);
      return rt.find('Player')!;
    };
    const p = climbFrom(66, false); // grabbed with exactly half inside, left of the middle
    expect(p.climbing).toBe(true);
    expect(Math.abs(p.x - 80)).toBeLessThan(2);
    const q = climbFrom(66, true);
    expect(q.x).toBeGreaterThan(66 + 10); // moved by the Right key, not pulled to 80 and held there
    expect(Math.abs(q.x - 80)).toBeGreaterThan(2);
  });

  it('climbing to the top of a ladder stops there: no bounce, and holding Up does nothing more', () => {
    const { rt, input, p } = atLadder();
    input.press('up');
    let highest = Infinity;
    run(rt, input, 2.5, () => {
      highest = Math.min(highest, p.y);
    });
    // Top at -128: the feet stop exactly there, never above it.
    expect(highest).toBeGreaterThanOrEqual(-144 - 0.01);
    expect(p.y).toBeCloseTo(-144, 1);
    expect(p.vy).toBe(0);
    expect(p.climbing).toBe(false);
    expect(p.grounded).toBe(true);
    input.release('up');
    run(rt, input, 0.5);
    expect(p.y).toBeCloseTo(-144, 1);
  });

  it('a ladder above a gap cannot be reached by climbing, only by jumping', () => {
    // Lower ladder from the ground up to -64 (tops at -64), a gap of one tile, then one piece at -112 (-128..-96).
    const { project, sceneId } = level((p, sid) => {
      const ladder = p.definitions.find((d) => d.name === 'Ladder')!;
      for (const y of [16, -16, -48, -112]) m.addEntity(p, sid, instantiateDefinition(ladder, { x: 0, y }));
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    const p = rt.find('Player')!;
    run(rt, input, 1);
    input.press('up');
    let highest = Infinity;
    run(rt, input, 2.5, () => {
      highest = Math.min(highest, p.y);
    });
    expect(highest).toBeGreaterThanOrEqual(-64 - 16 - 0.01); // stopped on top of the lower ladder
    expect(p.y).toBeCloseTo(-80, 1);
    expect(p.climbing).toBe(false);
    // Jumping (still holding Up) grabs the upper ladder.
    input.press('jump');
    run(rt, input, 0.3);
    input.release('jump');
    expect(p.climbing || p.y <= -128 - 16 + 0.01).toBe(true);
    run(rt, input, 1);
    expect(p.y).toBeCloseTo(-128 - 16, 1); // climbed it, standing on its top
  });

  it('Up does not jump (it only climbs)', () => {
    const { project, sceneId } = level();
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    run(rt, input, 1);
    const p = rt.find('Player')!;
    const y = p.y;
    input.press('up');
    run(rt, input, 0.5);
    expect(p.y).toBe(y);
    expect(p.grounded).toBe(true);
  });

  it('jumps onto a platform one row higher, but not two rows', () => {
    const endX = (rows: number) => {
      const { project, sceneId } = level((p, sid) => {
        const stone = p.definitions.find((d) => d.name === 'Stone')!;
        for (let r = 1; r <= rows; r++) for (const x of [112, 144]) m.addEntity(p, sid, instantiateDefinition(stone, { x, y: 48 - 32 * r }));
      });
      const rt = new Runtime(project, sceneId, registry);
      const input = new InputState();
      run(rt, input, 1);
      const p = rt.find('Player')!;
      input.press('right');
      let held = 0;
      run(rt, input, 1, () => {
        // One full jump: press when close to the step, hold for a third of a second, then stop running.
        if (held === 0 && p.x > 60 && p.grounded) {
          input.press('jump');
          held = 1;
        } else if (held > 0 && ++held === 20) {
          input.release('jump');
        } else if (held > 0 && p.x > 112) {
          input.release('right');
        }
      });
      return { x: p.x, y: p.y, grounded: p.grounded };
    };
    const one = endX(1);
    expect(one.x).toBeGreaterThan(96); // up on the step
    expect(one.y).toBeCloseTo(16 - 32, 0);
    expect(one.grounded).toBe(true);
    const two = endX(2);
    expect(two.x).toBeLessThanOrEqual(96 - 14 + 0.01); // stopped by the two-row wall
  });

  it('falling out of the level puts the player back at the start', () => {
    const { project, sceneId } = level();
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    const p = rt.find('Player')!;
    let maxY = -Infinity;
    input.press('right');
    run(rt, input, 3, () => (maxY = Math.max(maxY, p.y)));
    expect(maxY).toBeGreaterThan(300); // it did fall off the edge...
    expect(p.respawns).toBeGreaterThan(0); // ...and was put back at its start
    input.release('right');
    run(rt, input, 2);
    expect(Math.abs(p.x)).toBeLessThan(160); // back on the platform...
    expect(p.grounded).toBe(true); // ...standing on it
  });

  it('never changes the project', () => {
    const { project, sceneId } = level();
    const before = JSON.stringify(project);
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    input.press('right');
    input.press('jump');
    run(rt, input, 2);
    expect(JSON.stringify(project)).toBe(before);
    expect(rt.renderList().find((e) => e.name === 'Player')!.transform.position.x).not.toBe(0);
  });

  it('the camera follows the camera target', () => {
    const { project, sceneId } = level();
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    input.press('right');
    run(rt, input, 1);
    const p = rt.find('Player')!;
    expect(rt.camera.x).toBeGreaterThan(p.x - 60);
  });
});
