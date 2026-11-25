/**
 * What the engine takes today, as numbers in one place: each is either a limit an operation enforces or a size
 * measured (docs §30.3), and the guidance the AI is given quotes them from here, so what it is told is what the
 * engine does. (The start of §30.5's limits module: only the numbers that existed, named.)
 */
export const ENGINE_LIMITS = {
  /** Cells one draw_tiles fills (all its rectangles together). */
  drawTilesCells: 3000,
  /** Cells one draw_map holds (its width times its rows). */
  drawMapCells: 6000,
  /**
   * Placed things (every tile is one) a level plays smoothly with: measured at a step of 4-5 ms with 2,630 things
   * and 15-19 ms with 5,600 (a step has 16.7 ms at 60 frames a second). Advice, not enforced.
   */
  smoothThings: 4000,
} as const;
