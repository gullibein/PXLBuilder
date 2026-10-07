import { describe, expect, it } from 'vitest';
import { createTrace, TRACE_TEXT_MAX } from './trace';

describe('AI trace', () => {
  it('records steps in order with their time, and cuts huge texts (saying how long they were)', () => {
    const t = createTrace();
    t.add('sent', 'Claude through claude.ai');
    t.add('reply', 'x'.repeat(TRACE_TEXT_MAX + 50));
    expect(t.steps.map((s) => s.kind)).toEqual(['sent', 'reply']);
    expect(t.steps[0].ms).toBeGreaterThanOrEqual(0);
    expect(t.steps[1].text.length).toBeLessThan(TRACE_TEXT_MAX + 60);
    expect(t.steps[1].text).toMatch(/\[cut: 16050 characters in all\]$/);
  });
});
