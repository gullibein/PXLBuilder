import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations } from '../commands/operations';
import { topicsFor } from '../ai/topics';
import { stompScript } from './ruleScripts';
import { panelOf, panelValue, setPanel, setPanelValue, removePanel } from './panels';
import { createProject } from './factory';

const componentRegistry = createBuiltinRegistry();

function player() {
  const project = createProject(componentRegistry, 'Test', 'platformer');
  const def = project.definitions.find((d) => d.name === 'Player')!;
  return { project, def };
}

describe('object panels', () => {
  it('a panel changes the object it is on (fields, one of two numbers, script settings)', () => {
    const { project, def } = player();
    def.scripts = [...(def.scripts ?? []), stompScript({ by: [], bounce: 300, hits: 0 })];
    setPanel(project, def.id, { title: 'Tuning', controls: [{ label: 'Jump', target: 'CharacterController.jumpForce', min: 100, max: 700 }, { label: 'Bounce', target: 'script:Stomp.bounce', control: 'knob', min: 0, max: 600, step: 10 }] }, componentRegistry);
    const panel = panelOf(def)!;
    expect(panel.controls[0].control).toBe('slider');
    expect(panelValue(def, panel.controls[0], componentRegistry)).toBe(def.components.CharacterController.jumpForce ?? 350);
    setPanelValue(project, def.id, panel.controls[0], 420, componentRegistry);
    expect(def.components.CharacterController.jumpForce).toBe(420);
    setPanelValue(project, def.id, panel.controls[1], 500, componentRegistry);
    expect(def.scripts!.find((s) => s.name === 'Stomp')!.vars.find((v) => v.name === 'bounce')!.value).toBe(500);
    expect(panelValue(def, panel.controls[1], componentRegistry)).toBe(500);
    removePanel(project, def.id);
    expect(panelOf(def)).toBeNull();
  });

  it('refuses controls that change nothing a number can be', () => {
    const { project, def } = player();
    const bad = (target: string, min = 0, max = 10) => () => setPanel(project, def.id, { title: 'X', controls: [{ label: 'A', target, min, max }] }, componentRegistry);
    expect(bad('CharacterController.nothing')).toThrow();
    expect(bad('Transform.position.x')).toThrow(/Transform/);
    expect(bad('script:Nope.x')).toThrow(/no script/);
    expect(bad('CharacterController.speed', 10, 5)).toThrow(/max/);
    expect(bad('jumpForce')).toThrow();
    expect(panelOf(def)).toBeNull();
  });

  it('set_panel is an operation the AI can send', () => {
    const { project, def } = player();
    const panelJson = JSON.stringify({ title: 'Player', controls: [{ label: 'Run speed', target: 'CharacterController.speed', control: 'number', min: 50, max: 500 }] });
    applyOperations(project, [{ op: 'set_panel', id: def.id, panelJson }] as never, componentRegistry);
    expect(panelOf(def)!.controls[0].control).toBe('number');
    applyOperations(project, [{ op: 'remove_panel', id: def.id }] as never, componentRegistry);
    expect(panelOf(def)).toBeNull();
  });

  it('the panels guidance goes only with panel requests', () => {
    const { project, def } = player();
    const sceneId = project.scenes[0].id;
    expect(topicsFor({ kind: 'object', sceneId, definitionId: def.id, panel: true }, 'jump height', [])).toContain('panels');
    expect(topicsFor({ kind: 'object', sceneId, definitionId: def.id }, 'make it blue', [])).not.toContain('panels');
  });
});
