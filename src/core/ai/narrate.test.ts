import { describe, expect, it } from 'vitest';
import { answerPreview, narrateOperation } from './narrate';
import { DrawingScanner } from './streamDrawings';

describe('what the AI is doing, in words, while it writes', () => {
  const answer = JSON.stringify({
    kind: 'preview',
    message: 'Ember, a clumsy little dragon, is having the worst morning.',
    changes: ['Player: drawn as a little green dragon', 'New enemy Flying Bill'],
    operations: [
      { op: 'rename', target: 'definition', id: 'def_1', name: 'Dust Bunny' },
      { op: 'create_definition', ref: 'bill', name: 'Flying Bill', description: 'A runaway bill with wings that flutters in a wave. Stomp it.', components: [{ component: 'Sprite', propsJson: '{}' }] },
      { op: 'set_script', target: 'definition', id: 'bill', scriptJson: '{"ready":"Wave flyer"}' },
      { op: 'add_component', target: 'definition', id: 'def_p', component: 'LedgeGrab', propsJson: '{}' },
      { op: 'make_background', sceneId: 'scn_1', kind: 'mountains', colors: ['#8ec5ff'], variant: 1, parallax: 0.3 },
      { op: 'draw_map', sceneId: 'scn_1', col: 0, row: 0, legend: [], rows: ['####', '#..#', '####'], clear: true },
    ],
  });

  it('the idea and the plan, as far as they have come (a line still being written is left out)', () => {
    const cut = answer.indexOf('New enemy') + 5;
    expect(answerPreview(answer.slice(0, 40))).toEqual({ message: 'Ember, a cl', changes: [] });
    expect(answerPreview(answer.slice(0, cut))).toEqual({ message: 'Ember, a clumsy little dragon, is having the worst morning.', changes: ['Player: drawn as a little green dragon'] });
  });

  it('a line for each operation as soon as it is complete, with names for ids and refs', () => {
    const names = new Map([['def_1', 'Enemy'], ['def_p', 'Player'], ['scn_1', 'Level 1']]);
    const lines: string[] = [];
    const scanner = new DrawingScanner(() => {}, (op) => {
      const l = narrateOperation(op, names);
      if (l) lines.push(l);
    });
    // Fed bit by bit, as it comes.
    for (let i = 0; i <= answer.length; i += 37) scanner.feed(answer.slice(0, i));
    scanner.feed(answer);
    expect(lines).toEqual([
      'Turning Enemy into Dust Bunny',
      'Making Flying Bill: A runaway bill with wings that flutters in a wave',
      'Giving Flying Bill the Wave flyer behavior',
      'Giving Player the ability to grab ledges',
      'Making the background: mountains in #8ec5ff',
      'Building Level 1: 4 by 3 cells',
    ]);
  });
});
