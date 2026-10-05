import { describe, expect, it } from 'vitest';
import { componentRegistry } from '../../core/components/builtin';
import { createProject, instantiateDefinition } from '../../core/model/factory';
import { resolveEntity } from '../../core/model/resolve';
import { addOverlays, checkOverlay, overlayEntities, readMetric } from './overlays';

const project = createProject(componentRegistry);
const scene = project.scenes[0];
const playerDef = project.definitions.find((d) => d.name === 'Player')!;
const player = resolveEntity(project, instantiateDefinition(playerDef, { x: 0, y: 0 }), componentRegistry);
const everyPlayer = { kind: 'object' as const, id: playerDef.id };

describe('editor overlays', () => {
  it('read values: jump height and distance from the controller and gravity, any Component.field', () => {
    expect(readMetric('jumpHeight', { e: player, scene })).toEqual({ label: 'Jump height', value: '44 px · 1.4 tiles' });
    expect(readMetric('jumpDistance', { e: player, scene })?.value).toBe('120 px · 3.8 tiles');
    expect(readMetric('health', { e: player, scene })?.value).toBe('3 / 3');
    expect(readMetric('CharacterController.speed', { e: player, scene })).toEqual({ label: 'Character Controller speed', value: '200' });
    expect(readMetric('damage', { e: player, scene })).toBeNull(); // the player has no Damage
  });

  it('are validated', () => {
    expect(checkOverlay({ kind: 'info', target: everyPlayer, show: ['jumpHeight'] })).toBeNull();
    expect(checkOverlay({ kind: 'jump_reach', target: everyPlayer, show: [] })).toBeNull();
    expect(checkOverlay({ kind: 'hologram', target: everyPlayer, show: [] })).toMatch(/Unknown overlay kind/);
    expect(checkOverlay({ kind: 'info', target: { kind: 'any' }, show: ['jumpHeight'] })).toMatch(/target/);
    expect(checkOverlay({ kind: 'info', target: everyPlayer, show: ['luck'] })).toMatch(/Unknown value "luck"/);
    expect(checkOverlay({ kind: 'info', target: everyPlayer, show: [] })).toMatch(/at least one/);
  });

  it('the same kind on the same target replaces the old overlay', () => {
    let n = 0;
    const id = () => `o${++n}`;
    const one = addOverlays([], [{ kind: 'info', target: everyPlayer, show: ['jumpHeight'] }], id);
    const two = addOverlays(one as never, [{ kind: 'info', target: everyPlayer, show: ['jumpHeight', 'health'] }], id);
    expect(two).toEqual([{ id: 'o1', kind: 'info', target: everyPlayer, show: ['jumpHeight', 'health'] }]);
    expect(overlayEntities((two as never)[0], [player])).toEqual([player]);
  });
});
