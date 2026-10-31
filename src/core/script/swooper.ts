/**
 * The ready-made "Swooper" script, for the enemies of a space shooter (Galaga-style): it flies in from the edge of
 * the screen along a curve, one after another (a stream on one path), to its place in the formation (where it was
 * put in the level); there it sways a little with the others; now and then it swoops down in a half circle toward
 * the player (or snakes down, or dives straight), flies off the bottom and comes back down from the top to its
 * place. Everything about it is a setting in Details. Sent to the AI with shooter requests (topics.ts).
 */
type Step = Record<string, unknown>;
const set = (v: string, value: string): Step => ({ do: 'set', var: v, value });
const when = (cond: string, then: Step[], otherwise: Step[] = []): Step => ({ do: 'if', cond, then, else: otherwise });
const at = (x: string, y: string): Step => ({ do: 'position', x, y, on: null });
const go = (state: string): Step => ({ do: 'state', name: state });
/** The distance between two points. */
const d2 = (a: string, b: string, c: string, d: string) => `sqrt((${a} - ${c}) * (${a} - ${c}) + (${b} - ${d}) * (${b} - ${d}))`;

export const SWOOPER_SCRIPT = {
  name: 'Swooper',
  description:
    'Flies in from the edge of the screen along a curve, one after another, to its place in the formation; sways there; now and then swoops down in a half circle toward the player (or snakes or dives down), flies off the bottom and comes back to its place from the top.',
  vars: [
    { name: 'speed', value: 200, setting: true },
    { name: 'entry', value: 'left', setting: true },
    { name: 'entry_gap', value: 0.08, setting: true },
    { name: 'dive_every', value: 6, setting: true },
    { name: 'dive', value: 'swoop', setting: true },
    { name: 'radius', value: 70, setting: true },
    { name: 'sway', value: 12, setting: true },
    { name: 'hx', value: 0 },
    { name: 'hy', value: 0 },
    { name: 'sx', value: 0 },
    { name: 'sy', value: 0 },
    { name: 'cx', value: 0 },
    { name: 'cy', value: 0 },
    { name: 'u', value: 0 },
    { name: 'len', value: 1 },
    { name: 'delay', value: 0 },
    { name: 'side', value: 0 },
    { name: 'ang', value: 0 },
    { name: 'dir', value: 1 },
    { name: 'tx', value: 0 },
    { name: 'k', value: 0 },
  ],
  states: ['enter', 'home', 'dive', 'fall', 'back'],
  handlers: [
    {
      when: { on: 'start' },
      do: [
        set('hx', 'self.x'),
        set('hy', 'self.y'),
        when(
          "entry == 'none'",
          [go('home')],
          [
            // From a top corner of the screen (or straight above, "top"), curving down past the middle and up into its place.
            set('side', "entry == 'right' ? 1 : (entry == 'left' ? -1 : 0)"),
            set('sx', 'side == 0 ? hx : view_x + side * (view_w / 2 + 48)'),
            set('sy', 'view_y - view_h / 2 - 48'),
            set('cx', 'side == 0 ? hx : view_x - side * view_w / 6'),
            set('cy', 'hy + view_h / 3'),
            set('len', `max(1, ${d2('sx', 'sy', 'cx', 'cy')} + ${d2('cx', 'cy', 'hx', 'hy')})`),
            // The ones nearest the way in go first, the rest follow along the same curve.
            set('delay', 'entry_gap * abs(hx - sx) / 32 + entry_gap * abs(hy - sy) / 64'),
            set('u', '0'),
            at('sx', 'sy'),
            go('enter'),
          ],
        ),
      ],
    },
    {
      when: { on: 'tick' },
      state: 'enter',
      do: [
        when('state_time >= delay', [
          set('u', 'min(1, u + speed * dt / len)'),
          // A curve through (cx, cy): (1-u)² start + 2(1-u)u middle + u² home.
          at('(1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * hx', '(1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * hy'),
          when('u >= 1', [go('home')]),
        ]),
      ],
    },
    {
      when: { on: 'tick' },
      state: 'home',
      do: [
        // The formation sways together (the same clock for all).
        at('hx + sin(time * 1.4) * sway', 'hy'),
        when('dive_every > 0 and player and chance(dt / dive_every)', [
          set('dir', 'player.x < self.x ? -1 : 1'),
          set('cx', 'self.x + dir * radius'),
          set('cy', 'self.y'),
          set('ang', 'dir > 0 ? pi : 0'),
          set('tx', 'player.x'),
          set('k', '0'),
          go('dive'),
        ]),
      ],
    },
    {
      when: { on: 'tick' },
      state: 'dive',
      do: [
        when(
          "dive == 'swoop'",
          [
            // A half circle down toward the player's side, then on down toward where the player was.
            set('ang', 'ang - dir * speed * dt / max(8, radius)'),
            at('cx + cos(ang) * radius', 'cy + sin(ang) * radius'),
            when('(dir > 0 and ang <= pi * 0.5) or (dir < 0 and ang >= pi * 0.5)', [set('sx', 'self.x'), set('sy', 'self.y'), go('fall')]),
          ],
          [
            when(
              "dive == 'snake'",
              [
                // Down in an S-curve.
                set('k', 'k + speed * dt'),
                at('cx - dir * radius + sin(k / max(8, radius) * 1.6) * radius', 'cy + k'),
              ],
              [set('k', 'k + speed * dt'), at('lerp(cx - dir * radius, tx, min(1, k / (view_h * 0.8)))', 'cy + k')],
            ),
            when('self.y > view_y + view_h / 2 + 48', [at('hx', 'view_y - view_h / 2 - 48'), go('back')]),
          ],
        ),
      ],
    },
    {
      when: { on: 'tick' },
      state: 'fall',
      do: [
        // Out of the half circle: on down toward where the player was.
        set('k', 'k + speed * dt'),
        at('lerp(sx, tx, min(1, k / (view_h * 0.6)))', 'sy + k'),
        when('self.y > view_y + view_h / 2 + 48', [at('hx', 'view_y - view_h / 2 - 48'), go('back')]),
      ],
    },
    {
      when: { on: 'tick' },
      state: 'back',
      do: [
        // Down from the top, back into its place.
        set('k', d2('self.x', 'self.y', 'hx + sin(time * 1.4) * sway', 'hy')),
        when(
          'k <= speed * dt',
          [go('home')],
          [at('self.x + (hx + sin(time * 1.4) * sway - self.x) / k * speed * dt', 'self.y + (hy - self.y) / k * speed * dt')],
        ),
      ],
    },
  ],
};

export const SWOOPER_JSON = JSON.stringify(SWOOPER_SCRIPT);
