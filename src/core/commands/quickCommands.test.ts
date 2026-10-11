import { describe, expect, it } from 'vitest';
import { parseQuickCommand as p } from './quickCommands';

describe('parseQuickCommand', () => {
  it('understands deleting the selection in many words', () => {
    for (const t of ['delete', 'Delete.', 'erase', 'remove it', 'delete these', 'please delete them', 'get rid of this', 'Erase the selected objects', 'remove all of them', 'delete both', 'trash it']) {
      expect(p(t), t).toEqual({ kind: 'delete' });
    }
  });
  it('leaves anything more to the AI', () => {
    for (const t of ['delete the spikes and make the platform bigger', 'remove gravity', 'make it jump higher', 'copy the style of the player', 'move the door to the goal', 'delete all enemies on the left', 'select the enemy that walks']) {
      expect(p(t), t).toBeNull();
    }
  });
  it('copy, cut, paste, undo, redo, deselect, help', () => {
    expect(p('copy')).toEqual({ kind: 'copy' });
    expect(p('copy this')).toEqual({ kind: 'copy' });
    expect(p('cut them')).toEqual({ kind: 'cut' });
    expect(p('paste')).toEqual({ kind: 'paste' });
    expect(p('paste it here')).toEqual({ kind: 'paste' });
    expect(p('undo')).toEqual({ kind: 'undo' });
    expect(p('undo that')).toEqual({ kind: 'undo' });
    expect(p('redo')).toEqual({ kind: 'redo' });
    expect(p('deselect')).toEqual({ kind: 'deselect' });
    expect(p('help')).toEqual({ kind: 'help' });
  });
  it('duplicate, with how many and where', () => {
    expect(p('duplicate')).toEqual({ kind: 'duplicate', count: 1, direction: null });
    expect(p('clone it')).toEqual({ kind: 'duplicate', count: 1, direction: null });
    expect(p('duplicate 3 times')).toEqual({ kind: 'duplicate', count: 3, direction: null });
    expect(p('duplicate it three times to the right')).toEqual({ kind: 'duplicate', count: 3, direction: 'right' });
    expect(p('duplicate x4 up')).toEqual({ kind: 'duplicate', count: 4, direction: 'up' });
    expect(p('make 5 copies to the left')).toEqual({ kind: 'duplicate', count: 5, direction: 'left' });
    expect(p('make a copy')).toEqual({ kind: 'duplicate', count: 1, direction: null });
    expect(p('duplicate 500 times')).toBeNull();
  });
  it('move, by cells', () => {
    expect(p('move left')).toEqual({ kind: 'move', direction: 'left', cells: 1 });
    expect(p('move it up 3')).toEqual({ kind: 'move', direction: 'up', cells: 3 });
    expect(p('move them 2 squares to the right')).toEqual({ kind: 'move', direction: 'right', cells: 2 });
    expect(p('move down by four tiles')).toEqual({ kind: 'move', direction: 'down', cells: 4 });
    expect(p('nudge it higher')).toEqual({ kind: 'move', direction: 'up', cells: 1 });
  });
  it('rename keeps the name as typed', () => {
    expect(p('rename to Boss Bat')).toEqual({ kind: 'rename', name: 'Boss Bat' });
    expect(p('rename it to "P1"')).toEqual({ kind: 'rename', name: 'P1' });
    expect(p('call it Big Door')).toEqual({ kind: 'rename', name: 'Big Door' });
    expect(p('rename Gate')).toEqual({ kind: 'rename', name: 'Gate' });
  });
  it('select all, or all of a kind', () => {
    expect(p('select all')).toEqual({ kind: 'select_all', name: null });
    expect(p('select everything')).toEqual({ kind: 'select_all', name: null });
    expect(p('select all coins')).toEqual({ kind: 'select_all', name: 'coins' });
    expect(p('select all the spikes')).toEqual({ kind: 'select_all', name: 'spikes' });
  });
});
