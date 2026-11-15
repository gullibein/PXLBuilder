/**
 * The ready-made Pressure plate: a plate on the floor that is on while something heavy is on it (the player, or a
 * crate pushed onto it) and off again when it leaves. Whatever it controls (a door: "Plate controls Door") is open
 * only while it is held down, so a door far from its plate needs a crate left on the plate. Its pressed look is
 * its "used" image (SpriteStates.used), when it has one.
 */
export const PRESSURE_PLATE_SCRIPT = {
  name: 'Pressure plate',
  description:
    'On while the player or a crate (anything tagged pushable or crate) is on it, off when it leaves: "switch_activated" happens each time, so what it controls opens while it is held down and closes after. Shows its used look (SpriteStates.used) while pressed.',
  takesOver: 'switching',
  vars: [
    { name: 'up', value: '' },
  ],
  states: [],
  handlers: [
    {
      when: { on: 'start' },
      if: null,
      do: [{ do: 'set', var: 'up', value: 'field(self, "Sprite.assetId")', on: null }],
    },
    {
      when: { on: 'tick' },
      if: '(touching("player") or touching("pushable") or touching("crate")) != self.on',
      do: [
        { do: 'set_switch', target: 'self', value: 'not self.on' },
        {
          do: 'if',
          cond: 'field(self, "SpriteStates.used") != ""',
          then: [{ do: 'set_field', component: 'Sprite', field: 'assetId', value: 'pick(self.on, field(self, "SpriteStates.used"), up)', on: null }],
          else: [],
        },
        { do: 'emit', event: 'switch_activated', other: null },
      ],
    },
  ],
};
