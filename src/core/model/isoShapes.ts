/**
 * An auto-tiled isometric block's shapes (Sprite.isoAuto, Sprite.isoPictures): what each of its pictures is, in
 * the order isoPictures holds them. `key` is how the AI names one (draw_sprite isoShape), `name` how the editor does.
 */
export type IsoAutoKind = 'road' | 'land' | 'water';

export interface IsoShape {
  key: string;
  name: string;
}

const corners = (word: string): IsoShape[] => [
  { key: 'corner_north', name: `${word} north` },
  { key: 'corner_east', name: `${word} east` },
  { key: 'corner_south', name: `${word} south` },
  { key: 'corner_west', name: `${word} west` },
];

export const ISO_SHAPES: Record<IsoAutoKind, IsoShape[]> = {
  road: [
    { key: 'variation', name: 'Variation' },
    { key: 'turn_se_sw', name: 'Turn SE–SW' },
    { key: 'turn_se_ne', name: 'Turn SE–NE' },
    { key: 'turn_nw_ne', name: 'Turn NW–NE' },
    { key: 'turn_nw_sw', name: 'Turn NW–SW' },
  ],
  land: [...corners('Corner'), { key: 'variation', name: 'Variation' }],
  water: [...corners('Shore'), { key: 'variation', name: 'Variation' }],
};

/** Every shape key the AI may name (draw_sprite isoShape). */
export const ISO_SHAPE_KEYS = ['variation', 'turn_se_sw', 'turn_se_ne', 'turn_nw_ne', 'turn_nw_sw', 'corner_north', 'corner_east', 'corner_south', 'corner_west'] as const;

export function isoShapesOf(kind: unknown): IsoShape[] {
  return kind === 'road' || kind === 'land' || kind === 'water' ? ISO_SHAPES[kind] : [];
}
