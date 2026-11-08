/**
 * A song brief drawn at random for each new song the AI writes: a time signature, a scale, a chord progression,
 * melodic and rhythmic tricks, a drum feel and a form. Without it every "happy song" came out the same (one
 * progression, a melody on every step, the same beat). The AI keeps what fits the request and swaps what clashes for
 * another of the same kind (the lists are in the guidance), so the songs differ while still being what was asked.
 */
export interface SongIdea {
  meter: string;
  scale: string;
  progression: string;
  melody: string[];
  drums: string;
  form: string;
  /** Two ways to vary a part or fill a phrase end. */
  variations: string[];
  /** What the song's own instruments sound like. */
  sound: string;
  /** Unusual choices allowed (the user asked for an unusual or original song). */
  unusual: boolean;
}

/** Familiar, varied choices (every song) and unusual ones (only when the user asks for something unusual). */
const METERS = {
  usual: [
    '4/4: 16 steps a bar (4 a beat)',
    '4/4: 16 steps a bar (4 a beat), a bouncy feel: short notes on the beats, rests between',
    '3/4 (a waltz lilt): 12 steps a bar, the accent on step 0',
    '6/8 (two swaying beats of three): 12 steps a bar, accents on steps 0 and 6',
    '4/4 with a shuffle: 16 steps a bar, the off-beat 16ths late (play the swung notes on steps 3, 7, 11, 15 instead of 2, 6, 10, 14)',
  ],
  unusual: [
    '5/4 (lopsided, restless): 20 steps a bar, grouped 3+2 beats',
    '7/8 (skipping): 14 steps a bar, grouped 2+2+3 (eighths: 2 steps each)',
    '12/8 (a triplet feel): 12 steps a bar, four beats of three',
    'bars that change: a bar of 4/4 then a bar of 3/4 (patterns of 16 and 12 steps alternating in the order)',
  ],
};

const SCALES = {
  usual: [
    'major (bright, plain)',
    'major pentatonic (sunny, open; no half steps)',
    'Mixolydian: major with a flat 7th (cheeky, folk, rock; use the bVII chord)',
    'natural minor (melancholy)',
    'minor pentatonic (playful, bluesy)',
    'Dorian: minor with a raised 6th (cool, hopeful-sad; the IV chord is major)',
  ],
  unusual: [
    'Lydian: major with a raised 4th (dreamy, floating; lean on that #4)',
    'harmonic minor: the raised 7th (exotic, dramatic; the V chord is major)',
    'blues: the minor pentatonic with the flat 5th as a passing note (gritty)',
    'Phrygian: minor with a flat 2nd (tense, Spanish, desert)',
    'whole-tone in a passage (dreamy, magical, unsettled)',
  ],
};

const PROGRESSIONS = {
  usual: [
    'I – V – vi – IV',
    'vi – IV – I – V',
    'I – IV – V – IV',
    'I – vi – IV – V',
    'I – vi – ii – V (a circle)',
    'I – IV – ii – V with a turnaround',
    'I – bVII – IV – I (Mixolydian rock)',
    'I – iii – IV – V',
    'i – bVI – bIII – bVII (epic minor)',
    'i – iv – v – i',
    'a 12-bar blues (I I I I / IV IV I I / V IV I V)',
  ],
  unusual: [
    'I – iii – IV – iv (the minor iv: bittersweet)',
    'I – II – IV – I (Lydian: the major II)',
    'I – bIII – IV – I (a borrowed bIII)',
    'ii – V – I – vi with seventh chords (jazzy)',
    'a pedal: one bass note under changing chords for a whole pattern, then a sudden change',
    'chords a third apart (I – bVI – IV – bII): cinematic, surprising',
  ],
};

const MELODY = {
  usual: [
    'rests: whole beats of silence, phrases that breathe (a melody is not on every step)',
    'syncopation: some notes start on off-beats (odd steps) and are held across the beat',
    'a short motif (3-5 notes) repeated, each time a step higher (a sequence) or with its end changed',
    'call and response: the lead plays a phrase, a second instrument answers it',
    'a pickup: the phrase starts before the bar line (the last steps of the bar before)',
    'long notes against a busy accompaniment (and the other way round in the next part)',
    'repeated notes with a rhythm of their own (a rhythmic hook), then a run up to a high note',
    'an arpeggio melody: the chord tones broken up and down',
    'a countermelody: a second line moving against the lead (up when it goes down)',
    'staccato notes (length 1) against legato ones (long lengths)',
  ],
  unusual: [
    'wide leaps (a 6th, an octave or more) in the middle of stepwise lines',
    'chromatic passing and neighbour notes',
    'triplets in a 4/4 bar (three notes in the time of two: lengths of 2-3 steps, unevenly)',
    'phrases that end on an unexpected note (the 2nd, the 6th, the #4), not the root',
    'a key change up a step (or a third) for the last part',
    'odd note lengths: 3, 5 and 7 steps, notes that cross the bar line',
    'a melody in two registers at once, jumping between a low and a high line',
  ],
};

const DRUMS = {
  usual: [
    'a plain backbeat: kick on 1 and 3, snare on 2 and 4, hats in eighths (with a fill every 4 bars)',
    'four on the floor: a kick on every beat, open hats on the off-beats',
    'half-time: the snare only on beat 3, a sparse kick',
    'a shuffle: the hats swung, the snare on 2 and 4',
    'no drums in the first part; they come in for the second',
  ],
  unusual: [
    'a breakbeat: kicks on 0, 10 and 11, snares on 4 and 12, ghost notes (soft velocity)',
    'a march: a snare roll pattern with accents',
    'a bossa-nova-like pattern: the kick and the rim answering each other off the beat',
    'toms (low noise or triangle pitch drops) for fills at the end of every 2 bars',
    'only hand percussion: hats and a soft noise shaker, no kick',
  ],
};

const FORMS = {
  usual: [
    'A A B A (the B a contrast: other chords, other register)',
    'intro – A – B – A – B (the B a chorus: fuller, higher)',
    'A B A C (C a short new part before going round again)',
    'a short loop that builds: each time round an instrument joins',
    'verse – chorus – verse – chorus – bridge – chorus',
    'intro – verse – pre-chorus (rising, tension) – chorus',
    'A A B B (two parts, each played twice, the second time changed)',
    'a rondo: A B A C A (A always comes back, the others visit)',
    'a hook loop: a 2-bar hook over 4 different backings',
    'A1 A2 B A3 (A changes a little every time it comes back)',
    'a calm intro of 2 bars (one instrument), then the song',
    'a song that alternates a busy part and a sparse part',
  ],
  unusual: [
    'theme and variation: A, then A with the melody changed, then A with a new rhythm',
    'A – B with a 2-bar break where everything but one instrument stops',
    'intro – A – B – bridge (quiet, other key) – B',
    'through-composed: every part new, linked by one recurring motif',
    'phrases of 6 or 3 bars instead of 4 and 8',
    'a canon: the second instrument plays the lead\'s melody a bar later',
  ],
};

/**
 * Ways to vary a part when it comes back, or to fill the end of a phrase: there are many, so the second half of a
 * song is not always the first one with shorter notes.
 */
const VARIATIONS = {
  usual: [
    'the drums drop out for a bar, then come back with a crash',
    'the melody an octave higher (or lower) the second time',
    'a harmony line in thirds or sixths above the melody',
    'the same melody over new chords (a reharmonization)',
    'augmentation: the melody in notes twice as long, half as busy',
    'the bass takes the melody for a bar, the lead answers',
    'stop-time: everyone plays only on beat 1 for two bars, the melody alone in the gaps',
    'a breakdown: only the bass and the hats, then everything returns',
    'a countermelody joins the second time',
    'the accompaniment changes from held chords to arpeggios (or the other way)',
    'an echo: another instrument repeats the end of each phrase a beat later',
    'a pickup run of fast notes into the next part (only there)',
    'a whole bar of silence before the chorus',
    'a snare roll that grows louder over the last bar',
    'a tom run down the kit at the end of the phrase',
    'a fill of kick and snare answering each other on the last two beats',
    'no fill: the phrase just ends on a held note, the drums keep time',
    "the melody's rhythm the same but its notes moving the other way (up instead of down)",
    'half-time feel for the B part (the snare on 3), back to normal for A',
    'the chords played as short stabs on the off-beats instead of held',
  ],
  unusual: [
    'the melody displaced by an eighth note, so it lands off the beat',
    'diminution: the motif twice as fast, played twice',
    'the melody inverted (every interval upside down)',
    'a key change up a step for the last time round',
    'a sudden tempo-feel change: the drums in double time under the same melody',
    'a fill in triplets across the bar line',
  ],
};

/** The instruments' character: what the AI's own instruments for this song sound like. */
const SOUNDS = {
  usual: [
    'soft and round: triangle or sine-like waves, gentle attack, a little vibrato',
    'bright and plucky: short decays, pulse or pluck leads, crisp hats',
    'warm: a mellow lead with a filter (16-bit) or pulse50 with smooth volume (8-bit), a fat bass',
    'airy: echo on the lead, a pad (16-bit) or slow arpeggios (8-bit) behind it',
    'punchy: snappy attacks, a pitch-dropping kick, a tight snare',
    'thin and nostalgic: pulse12 / pulse25 leads, a Game Boy feel',
    'bell-like: FM bells (16-bit) or a fast-decaying pulse25 with vibrato (8-bit)',
    'bouncy: a bass with a small pitch drop, staccato leads',
  ],
  unusual: [
    'gritty: noisy, detuned, metallic hits',
    'glassy: very high FM ratios, long releases',
    'wobbly: deep slow vibrato everywhere, a lo-fi tape feel',
  ],
};

/** Words of a request that asks for something unusual: only then are the unusual choices drawn. */
export const UNUSUAL_SONG_WORDS = /\b(unusual|original|experimental|weird|strange|odd|quirky|unique|unconventional|avant|creative|surprising|surprise me|crazy|wild|exotic|complex|progressive|prog|jazzy|jazz)\b/i;

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length) % list.length];

/**
 * A song brief: one of each, and two melodic tricks. Familiar (if varied) choices, unless the user asked for something
 * unusual or original (`unusual`): then the unusual ones too.
 */
export function songIdea(random: () => number = Math.random, unusual = false): SongIdea {
  const from = <T>(lists: { usual: readonly T[]; unusual: readonly T[] }) => (unusual ? [...lists.usual, ...lists.unusual] : lists.usual);
  const melody = from(MELODY);
  const first = pick(melody, random);
  let second = pick(melody, random);
  for (let n = 0; n < 5 && second === first; n++) second = pick(melody, random);
  const vars = from(VARIATIONS);
  const v1 = pick(vars, random);
  let v2 = pick(vars, random);
  for (let n = 0; n < 5 && v2 === v1; n++) v2 = pick(vars, random);
  return { meter: pick(from(METERS), random), scale: pick(from(SCALES), random), progression: pick(from(PROGRESSIONS), random), melody: [first, second], drums: pick(from(DRUMS), random), form: pick(from(FORMS), random), variations: [v1, v2], sound: pick(from(SOUNDS), random), unusual };
}

/** The lists the brief is drawn from (the guidance gives them, to swap what clashes with a request). */
export const SONG_IDEA_LISTS = { METERS, SCALES, PROGRESSIONS, MELODY, DRUMS, FORMS, VARIATIONS, SOUNDS };

/**
 * A new song (make_song, not a rewrite) without an instrument of its own in the same answer: sent back, so each
 * song gets instruments that fit its mood (the kit's drums may be reused). Null when it is fine.
 */
export function songInstrumentsProblem(operations: { op: string; replaceId?: string | null }[]): string | null {
  const newSong = operations.some((o) => o.op === 'make_song' && !o.replaceId);
  if (!newSong || operations.some((o) => o.op === 'make_instrument')) return null;
  return 'a new song needs instruments of its own that fit its mood (context.songIdea.sound): make at least its lead and one more with make_instrument in the same answer (named for their role and character), reusing existing instruments only for what fits as it is (drums, often)';
}
