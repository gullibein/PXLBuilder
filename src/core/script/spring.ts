/**
 * The ready-made Spring: a spring, a bouncy mushroom, a bubble… whatever fits the game. Coming down on it bounces
 * the player up about half its jump; holding Jump as it lands (or pressing it just before or after) launches it twice as high
 * as its jump. Worked out from the player's own jump (its Character Controller), so it suits any game: a bounce's
 * height grows with the square of its speed, so half a jump is the jump's speed × √0.5, two jumps × √2.
 */
export const SPRING_SCRIPT = {
  name: 'Spring',
  description:
    "Bounces the player half a jump high, or two jumps high holding Jump. Coming down on it bounces anything with a Character Controller half its jump; holding Jump as the player lands (or pressing it just before or after) launches it twice its jump. Settings: bounce and launch (in the player's own jumps), timing (how close to landing a press of Jump still launches).",
  vars: [
    { name: 'bounce', value: 0.5, setting: true },
    { name: 'launch', value: 2, setting: true },
    { name: 'timing', value: 0.15, setting: true },
    { name: 'jump', value: 0 },
    { name: 'launch_until', value: 0 },
    { name: 'pressed_at', value: -9 },
  ],
  states: [],
  handlers: [
    {
      when: { on: 'landed_on' },
      if: 'field(other, "CharacterController.jumpForce") > 0',
      do: [
        { do: 'set', var: 'jump', value: 'field(other, "CharacterController.jumpForce")', on: null },
        {
          do: 'if',
          cond: 'has_tag(other, "player") and (key("jump") or time - pressed_at < timing)',
          then: [
            { do: 'bounce', speed: 'jump * sqrt(launch)', on: 'other' },
            { do: 'set', var: 'launch_until', value: '0', on: null },
          ],
          else: [
            { do: 'bounce', speed: 'jump * sqrt(bounce)', on: 'other' },
            { do: 'set', var: 'launch_until', value: 'pick(has_tag(other, "player"), time + timing, 0)', on: null },
          ],
        },
      ],
    },
    {
      // (When Jump was last pressed: a press just before landing launches too.)
      when: { on: 'tick' },
      if: 'pressed("jump")',
      do: [{ do: 'set', var: 'pressed_at', value: 'time', on: null }],
    },
    {
      // Jump pressed just after the bounce: the launch after all.
      when: { on: 'tick' },
      if: 'time < launch_until and pressed("jump") and exists(player)',
      do: [
        { do: 'bounce', speed: 'jump * sqrt(launch)', on: 'player' },
        { do: 'set', var: 'launch_until', value: '0', on: null },
      ],
    },
  ],
};
