import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aiResponseSchema } from './protocol';
import { compactSchema, expandReply, schemaCost } from './compactSchema';

const full = z.toJSONSchema(aiResponseSchema) as Record<string, unknown>;

describe('the compact reply format (for models with a small strict-format budget, such as Sonnet)', () => {
  it('stays within the limits: at most 16 union-typed and 24 optional parameters', () => {
    const before = schemaCost(full);
    const after = schemaCost(compactSchema(full));
    expect(before.unions).toBeGreaterThan(16);
    expect(after.unions).toBeLessThanOrEqual(16);
    expect(after.optional).toBeLessThanOrEqual(24);
  });

  it('a compact answer reads back as the normal form ("" and left-out fields are null) and passes the same check', () => {
    const compact = {
      kind: 'apply',
      message: 'Placed a coin and moved the player.',
      changes: ['Coin', 'Player moved'],
      needCode: undefined,
      starter: '',
      operations: [
        { op: 'place_instance', sceneId: 's1', definitionRef: 'd1', x: 16, y: 16, name: '', ref: 'c1' },
        { op: 'set_transform', entityId: 'e1', x: 32 },
        { op: 'make_sound', name: 'Ding', description: 'a ding', soundJson: '{}', replaceId: '' },
      ],
    };
    const expanded = expandReply(compact, full) as Record<string, unknown>;
    expect(expanded.needCode).toBeNull();
    expect(expanded.starter).toBeNull();
    const ops = expanded.operations as Record<string, unknown>[];
    expect(ops[0]).toMatchObject({ name: null, ref: 'c1', onTop: null });
    expect(ops[1]).toMatchObject({ x: 32, y: null, rotation: null, scaleX: null, scaleY: null });
    expect(ops[2]).toMatchObject({ replaceId: null });
    expect(aiResponseSchema.safeParse(expanded).success).toBe(true);
    // A normal answer is left as it is.
    const normal = { kind: 'answer', message: 'Hi', changes: [], operations: [], needCode: null, starter: null };
    expect(expandReply(normal, full)).toEqual(normal);
  });
});
