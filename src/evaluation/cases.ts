/**
 * The evaluation cases (docs/engine-architecture-proposal.md §25.10, §25.11, §33): eighteen kinds of game, each a
 * request as a person would type it, what the game must then be (Shape), what is expected of it running (Runs), the
 * parts of the engine it needs, and the script that plays it (Plays). Games are described by what they do, never by
 * the name of an existing game; chess is asked for in the user's own words.
 *
 * The card game is two cases, in English and in Icelandic, with the same requirements sentence for sentence, so a
 * difference between the two results is the language and not the game.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../core/components/registry';
import { projectFromPreset } from '../core/engine/profile';
import { instantiateDefinition } from '../core/model/factory';
import type { Project } from '../core/types';
import type { EnginePartId } from './engineParts';
import type { RunsAsk, ShapeAsk } from './layers';
import * as play from './plays';
import { run } from './watch';
import { failed, judged, notJudged, type Check } from './verdict';
import type { PlayCtx } from './watch';

/** What a play script is given beyond the game: the game before the request (an edit), and the operations the answers held. */
export interface CaseCtx extends PlayCtx {
  before?: Project;
  operations?: { op: string; [k: string]: unknown }[];
}

export interface FollowUp {
  prompt: string;
  /** What must hold after it (on top of the case's own checks, which are run again). */
  plays: (ctx: CaseCtx) => Check[];
}

export interface EvalCase {
  id: string;
  number: number;
  family: string;
  title: string;
  language: 'en' | 'is';
  prompt: string;
  followUps: FollowUp[];
  /** The New game window's choice: sprites drawn by the AI, or the engine's. */
  sprites: 'ai' | 'engine';
  /** The game the request is made to (an edit); none: a new game. */
  given?: (registry: ComponentRegistry) => Project;
  shape: ShapeAsk;
  runs: RunsAsk;
  /** Parts of the engine this kind of game needs to be what was asked (not a script standing in). */
  needs: EnginePartId[];
  plays: (ctx: CaseCtx) => Check[];
  /** In the first live run proposed (eight kinds of game furthest apart; the card game in both languages). */
  firstRun: boolean;
}

const CARD_EN =
  'Make a card game I play against the computer, with cards. It is a classic game played with cards. It is NOT a platformer. ' +
  'Cards are played one on top of another: a card fits when it has the colour or the number of the card on top of the pile. ' +
  'I want to see all the cards I have in my hand and to choose myself with the arrow keys which card I play, and D to draw a card. ' +
  'If the card I choose does not fit, a message must come up that says "not possible". ' +
  'There must be special cards: "skip a turn", "reverse" and "draw two". ' +
  'Players must START with 7 cards in hand, and it must always be possible to go on drawing cards, however many cards a player holds: there must be no limit on how many cards a player can have in hand. ' +
  'If a player does not play a card (or cannot play one), they must always draw a card. Whoever gets rid of all their cards first wins.';

const CARD_IS =
  'Búa til tölvuleik sem er spil sem ég spila á móti tölvunni, með spilum. Það er klassískt spil sem maður spilar með spilum. Það er EKKI platformer leikur. ' +
  'Spilin eru lögð hvert ofan á annað: spil passar þegar það er í sama lit eða með sömu tölu og efsta spilið í bunkanum. ' +
  'Ég vil sjá öll spilin sem ég er með á hendi og ég vil geta valið sjálfur með örvatökkunum hvaða spil ég legg út, og D til að draga spil. ' +
  'Ef spilið sem ég vel passar ekki þá eiga að koma upp skilaboð sem segja "ekki hægt". ' +
  'Það eiga að vera sérspil: "sleppa umferð", "snúa við" og "draga tvö". ' +
  'Leikmenn eiga að BYRJA með 7 spil á hendi og það verður að vera hægt að draga spil áfram, sama hvað leikmenn hafa mörg spil á hendi: það má ekki vera hámark á það hversu mörg spil leikmaður getur haft á hendi. ' +
  'Ef spilari leggur ekki út spil (eða getur ekki lagt út spil) þarf alltaf að draga spil. Sá sem losnar fyrst við öll spilin sín vinnur.';

const cards = (number: number, id: string, language: 'en' | 'is', prompt: string): EvalCase => ({
  id,
  number,
  family: 'Cards',
  title: `A card game against the computer (${language === 'en' ? 'asked in English' : 'asked in Icelandic'})`,
  language,
  prompt,
  followUps: [],
  sprites: 'ai',
  shape: { steered: 'none', view: 'any', rules: true },
  runs: { byItself: 'waits' },
  needs: ['script_lists'],
  // Seven to begin with, as asked; drawn up to ten, three past where the build on record stopped.
  plays: (ctx) => play.cardGame(ctx, 7, 10),
  firstRun: true,
});

/**
 * The game the two edits are made to: a short level of the platformer starter (a floor with a gap, a bridge over the
 * gap, a coin, a goal) whose bridge holds nothing up: the seeded fault.
 */
export function gameWithABrokenBridge(registry: ComponentRegistry): Project {
  return produce(projectFromPreset('classic-platformer', registry, 'Bridge game'), (d) => {
    const def = (name: string) => {
      const o = d.definitions.find((x) => x.name === name);
      if (!o) throw new Error(`The starter has no ${name}`);
      return o;
    };
    const at = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 });
    const list = [];
    for (let c = 0; c < 20; c++) list.push(c >= 8 && c <= 10 ? instantiateDefinition(def('Bridge'), at(c, 10)) : instantiateDefinition(def('Platform'), at(c, 10)));
    for (let c = 0; c < 20; c++) if (c < 8 || c > 10) list.push(instantiateDefinition(def('Platform'), at(c, 11)));
    list.push(instantiateDefinition(def('Player'), at(2, 9)), instantiateDefinition(def('Coin'), at(5, 8)), instantiateDefinition(def('Goal'), at(18, 9)));
    d.scenes[0].entities = list;
    const bridge = def('Bridge');
    if (bridge.components.Collider) bridge.components.Collider = { ...bridge.components.Collider, isTrigger: true, oneWay: false };
  });
}

const hue = (hex: string): { h: number; s: number; l: number } | null => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  const d = max - min;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, l: (max + min) / 2 };
};
const golden = (hex: string) => {
  const c = hue(hex);
  return !!c && c.h >= 30 && c.h <= 62 && c.s > 0.45 && c.l > 0.3;
};

/** The two edits: the coin made gold and nothing else touched; a body set on the bridge is held by it. */
function edits(ctx: CaseCtx): Check[] {
  const out: Check[] = [];
  const { project, before } = ctx;
  const coinNow = project.definitions.find((d) => /coin/i.test(d.name));
  const coinWas = before?.definitions.find((d) => d.id === coinNow?.id);
  const whatGold = 'The coin is gold, and nothing else was changed for it';
  if (!before || !coinNow || !coinWas) out.push(notJudged(P, whatGold, !before ? 'The game as it was before the request was not given.' : 'The game has no coin.'));
  else {
    const drawn = (ctx.operations ?? []).filter((o) => o.op === 'draw_sprite' && (o.id === coinNow.id || /coin/i.test(String(o.name ?? ''))));
    const colours = drawn.flatMap((o) => (Array.isArray(o.palette) ? (o.palette as { color?: string }[]).map((p) => String(p.color ?? '')) : []));
    const tint = String((coinNow.components.Sprite as { color?: string } | undefined)?.color ?? '');
    const changed = JSON.stringify(coinNow) !== JSON.stringify(coinWas) || JSON.stringify(project.assets) !== JSON.stringify(before.assets);
    const others = project.definitions.filter((d) => d.id !== coinNow.id && JSON.stringify(d) !== JSON.stringify(before.definitions.find((x) => x.id === d.id))).map((d) => d.name);
    const placedSame = JSON.stringify(project.scenes.map((s) => s.entities.length)) === JSON.stringify(before.scenes.map((s) => s.entities.length));
    if (!changed) out.push(failed(P, whatGold, 'Neither the coin nor any picture changed.'));
    else if (others.filter((n) => !/bridge/i.test(n)).length || !placedSame) out.push(failed(P, whatGold, `Changed besides the coin: ${others.join(', ') || 'what is placed in the levels'}.`));
    else if (colours.length) out.push(judged(P, whatGold, colours.some(golden), `The coin was drawn again in ${colours.slice(0, 5).join(', ')}; nothing else changed.`));
    else if (tint && tint !== String((coinWas.components.Sprite as { color?: string } | undefined)?.color ?? '')) out.push(judged(P, whatGold, golden(tint), `The coin's colour was set to ${tint}; nothing else changed.`));
    else out.push(notJudged(P, whatGold, 'The coin changed and nothing else did, but its new picture is not one a script reads the colours of (no drawing in the answer, no colour set).'));
  }
  const whatBridge = 'The bridge holds the player up';
  out.push(
    run(ctx, (g) => {
      g.wait(0.3);
      const who = g.steered()[0];
      const bridge = g.things().find((e) => /bridge/i.test(e.name)) ?? g.things().find((e) => e.collider?.oneWay);
      if (!who || !bridge) return notJudged(P, whatBridge, !who ? 'No steered character.' : 'No bridge is placed in the level Play starts, so none could be stood on.');
      who.x = bridge.x;
      who.y = bridge.y - 80;
      who.vx = who.vy = 0;
      const back = who.respawns;
      g.wait(1.5);
      // (Standing on it, there: fallen through, the player is put back at its start, which is also "on the ground".)
      const held = who.grounded && who.y < bridge.y && Math.abs(who.x - bridge.x) < 24 && who.respawns === back;
      return judged(P, whatBridge, held, held ? `Dropped onto ${bridge.name} from two and a half cells up, the player stood on it. (The player was set above it.)` : `Dropped onto ${bridge.name}, the player did not come to stand on it${who.respawns !== back ? ' (it fell through and out of the level)' : ''}.`);
    }),
  );
  return out;
}
const P = 'plays' as const;

export const CASES: readonly EvalCase[] = [
  {
    id: 'platformer',
    number: 1,
    family: 'Platformer',
    title: 'A classic platformer of two levels',
    language: 'en',
    prompt:
      'Make a classic side-scrolling platformer with two levels. The player runs and jumps across platforms and gaps, collects coins, avoids walking enemies and spikes, and reaches a flag at the end of each level. Finishing the first level starts the second.',
    followUps: [{ prompt: 'Add a double jump.', plays: (ctx) => play.secondJumpLifts(ctx) }],
    sprites: 'ai',
    shape: { steered: 'character', view: 'side', levels: 2 },
    runs: { byItself: 'any' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'side'), ...play.levelsCanBeFinished(ctx), ...play.goalWins(ctx, true)],
    firstRun: true,
  },
  {
    id: 'precision',
    number: 2,
    family: 'Platformer (abilities)',
    title: 'A precision platformer with a dash and a wall jump',
    language: 'en',
    prompt: 'Make a precision platformer: a small character with a dash and a wall jump, in one tight level with walls to climb by wall jumping and gaps that need the dash. Spikes send you back to the start of the level.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'side', abilities: ['Dash', 'WallJump'] },
    runs: { byItself: 'any' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'side'), ...play.abilityKeyActs(ctx, /dash/i, 'The dash key sends the character further than running'), ...play.wallJumpLifts(ctx), ...play.levelsCanBeFinished(ctx), ...play.goalWins(ctx, false)],
    firstRun: false,
  },
  {
    id: 'adventure',
    number: 3,
    family: 'Top-down',
    title: 'A top-down adventure with keys, doors and wandering enemies',
    language: 'en',
    prompt: 'Make a top-down adventure: a hero walks in four directions through rooms. Some doors are locked and need a key found elsewhere. Enemies wander the rooms and hurt the hero on touch. Reaching the treasure wins.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'top' },
    runs: { byItself: 'acts' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'top'), ...play.thingsActAlone(ctx, 1, 'Enemies go about by themselves'), ...play.doorNeedsKey(ctx), ...play.levelsCanBeFinished(ctx), ...play.goalWins(ctx, false)],
    firstRun: false,
  },
  {
    id: 'falling-blocks',
    number: 4,
    family: 'Board (falling pieces)',
    title: 'A falling-block puzzle where full rows clear',
    language: 'en',
    prompt: 'Make a falling-block puzzle. Pieces made of four squares fall one at a time into a well ten squares wide. Left and right move the piece, up turns it, down drops it faster. A full row disappears and scores; the game is over when the pieces reach the top.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'any', view: 'any', rules: true },
    runs: { byItself: 'acts' },
    needs: [],
    plays: (ctx) => play.fallingPieces(ctx, 'A full row disappears, and the game goes on'),
    firstRun: true,
  },
  {
    id: 'falling-pairs',
    number: 5,
    family: 'Board (falling pieces)',
    title: 'A falling-pairs puzzle where four of a colour clear',
    language: 'en',
    prompt: 'Make a falling-pairs puzzle. Pairs of coloured blobs fall into a well; left and right move the pair, up turns it, down drops it faster. Four or more of the same colour touching disappear and score, and what was above them falls down.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'any', view: 'any', rules: true },
    runs: { byItself: 'acts' },
    needs: [],
    plays: (ctx) => play.fallingPieces(ctx, 'Four of a colour touching disappear, and the game goes on'),
    firstRun: false,
  },
  {
    id: 'shooter',
    number: 6,
    family: 'Shooter',
    title: 'A scrolling space shooter',
    language: 'en',
    prompt: 'Make a vertically scrolling space shooter. The ship moves with the arrow keys and fires with X. Waves of enemies come down from the top; a shot destroys an enemy and scores; an enemy touching the ship costs a life. Three lives; show the score and the lives.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'any', view: 'any' },
    runs: { byItself: 'acts' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'any'), ...play.shooting(ctx), ...play.thingsActAlone(ctx, 1, 'Enemies come by themselves')],
    firstRun: true,
  },
  {
    id: 'mining',
    number: 7,
    family: 'Digging',
    title: 'A mining game dug downward',
    language: 'en',
    prompt: 'Make a mining game. The miner digs down through earth with the arrow keys and collects ore buried in the ground; the deeper it goes, the more the ore is worth. Show the depth and the money on the screen.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'any' },
    runs: { byItself: 'any' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'any'), ...play.digging(ctx, false)],
    firstRun: false,
  },
  {
    id: 'boulders',
    number: 8,
    family: 'Digging',
    title: 'A digging game with falling boulders and gems',
    language: 'en',
    prompt: 'Make a digging game: the player tunnels through dirt in any direction, boulders fall when the dirt under them is dug away and crush the player, gems are collected and counted, and the exit opens when enough gems are collected.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'any' },
    runs: { byItself: 'any' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'any'), ...play.digging(ctx, true)],
    firstRun: false,
  },
  {
    id: 'chess',
    number: 9,
    family: 'Board',
    title: 'Chess, in the user\'s own words',
    language: 'en',
    prompt: "Let's make a cool retro looking chess game where the user can either compete against another human player or a computer with four different difficulty levels",
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'none', view: 'top', rules: true },
    runs: { byItself: 'waits' },
    needs: [],
    plays: (ctx) => play.chess(ctx),
    firstRun: true,
  },
  {
    id: 'tic-tac-toe',
    number: 10,
    family: 'Board (small)',
    title: 'Tic-tac-toe against the computer',
    language: 'en',
    prompt: 'Make a tic-tac-toe game against the computer. I am X and go first; the arrow keys choose a square and Space places my mark. The computer answers with an O. Three in a row wins; say who won, or that it is a draw.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'none', view: 'any', rules: true },
    runs: { byItself: 'waits' },
    needs: [],
    plays: (ctx) => play.marksOnABoard(ctx),
    firstRun: false,
  },
  {
    id: 'tactics',
    number: 11,
    family: 'Turn-based',
    title: 'A turn-based tactics skirmish',
    language: 'en',
    prompt: 'Make a turn-based tactics skirmish on a grid: I command three units (a knight, an archer, a mage) against four enemy units. On my turn I pick a unit with the cursor, move it, and attack an enemy in range; then the enemy side takes its turn. A side with no units left loses.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'any', view: 'top' },
    runs: { byItself: 'waits' },
    needs: [],
    plays: (ctx) => play.tactics(ctx),
    firstRun: true,
  },
  {
    id: 'rpg',
    number: 12,
    family: 'Turn-based',
    title: 'A small role-playing game with a map and battles',
    language: 'en',
    prompt: 'Make a small role-playing game: a map to walk around, wandering monsters that start a turn-based battle when touched, a battle screen with a menu (attack, magic, item, run), experience and gold for winning, and back to the map afterwards.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'top', levels: 2 },
    runs: { byItself: 'acts' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'top'), ...play.rolePlaying(ctx)],
    firstRun: false,
  },
  {
    id: 'roguelike',
    number: 13,
    family: 'Random levels',
    title: 'A roguelike with a new dungeon each play',
    language: 'en',
    prompt: 'Make a roguelike: a new dungeon of rooms and corridors every time you play, monsters that move when you move, treasure to pick up, and stairs down to a deeper, harder floor.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'top' },
    runs: { byItself: 'waits' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'top'), ...play.newLevelEachPlay(ctx)],
    firstRun: false,
  },
  {
    id: 'isometric',
    number: 14,
    family: 'Isometric',
    title: 'An isometric room',
    language: 'en',
    prompt: 'Make an isometric room: a character walks around a room drawn in isometric view, with furniture it cannot walk through, and a door that ends the level when reached.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'iso' },
    runs: { byItself: 'any' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'top'), ...play.goalWins(ctx, false)],
    firstRun: false,
  },
  {
    id: 'city',
    number: 15,
    family: 'Open world',
    title: 'An open city seen from above, with cars and people',
    language: 'en',
    prompt: 'Make an open city seen from above: streets and buildings covering at least six screens, cars driving along the streets, people walking on the pavements. The player walks anywhere, can get into a car with E and drive it, and get out again.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'character', view: 'top', minScreens: 6 },
    runs: { byItself: 'acts' },
    needs: [],
    plays: (ctx) => [...play.characterMoves(ctx, 'top'), ...play.thingsActAlone(ctx, 2, 'Cars and people go about by themselves (two kinds of thing at least)'), ...play.vehicleCanBeTaken(ctx)],
    firstRun: true,
  },
  {
    id: 'edits',
    number: 16,
    family: 'Edits',
    title: 'Two edits to a given game',
    language: 'en',
    prompt: 'make the coin gold',
    followUps: [{ prompt: 'the player falls through the bridge', plays: () => [] }],
    sprites: 'engine',
    given: gameWithABrokenBridge,
    shape: { steered: 'character', view: 'side' },
    runs: { byItself: 'any' },
    needs: [],
    plays: edits,
    firstRun: false,
  },
  {
    id: 'pinball',
    number: 17,
    family: 'A table with a ball',
    title: 'A pinball table',
    language: 'en',
    prompt: 'Make a pinball table: a ball, two flippers (the left and right arrow keys), a plunger (hold Space and let go to launch the ball), three bumpers that kick the ball away and score, and a drain at the bottom. Three balls; show the score and the balls left; game over after the last ball.',
    followUps: [],
    sprites: 'ai',
    shape: { steered: 'none', view: 'any' },
    runs: { byItself: 'any' },
    needs: ['bounce', 'round_bodies', 'turning_solids', 'solids_strike'],
    plays: (ctx) => play.pinball(ctx),
    firstRun: true,
  },
  cards(18, 'cards-en', 'en', CARD_EN),
  cards(18, 'cards-is', 'is', CARD_IS),
];

export const caseById = (id: string): EvalCase => {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`No evaluation case "${id}"`);
  return c;
};
