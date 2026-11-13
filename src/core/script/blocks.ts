/**
 * The ready-made blocks hit from below: a ? block (bumping it from underneath gives what is in it, once, and it
 * shows its used look) and a brick block (bumping it breaks it). Both answer the "hit_from_below" trigger: the
 * player jumping up into its underside.
 */
export const QUESTION_BLOCK_SCRIPT = {
  name: 'Question block',
  description:
    'Gives a Coin when the player bumps it from below, then shows its used look (SpriteStates.used). times: how many bumps give one.',
  vars: [
    { name: 'times', value: 1, setting: true },
    { name: 'given', value: 0 },
  ],
  states: [],
  handlers: [
    {
      when: { on: 'hit_from_below' },
      if: 'has_tag(other, "player") and given < times',
      do: [
        { do: 'spawn', object: 'Coin', x: 'self.x', y: 'self.y - 32', tag: null },
        { do: 'set', var: 'given', value: 'given + 1', on: null },
        {
          do: 'if',
          cond: 'given >= times and field(self, "SpriteStates.used") != ""',
          then: [{ do: 'set_field', component: 'Sprite', field: 'assetId', value: 'field(self, "SpriteStates.used")', on: null }],
          else: [],
        },
      ],
    },
  ],
};

export const BRICK_BLOCK_SCRIPT = {
  name: 'Brick block',
  description: 'Breaks when the player bumps it from below.',
  vars: [],
  states: [],
  handlers: [
    {
      when: { on: 'hit_from_below' },
      if: 'has_tag(other, "player")',
      do: [{ do: 'remove', target: null }],
    },
  ],
};
