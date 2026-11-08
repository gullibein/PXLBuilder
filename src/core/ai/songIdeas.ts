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
}

const METERS = [
  '4/4: 16 steps a bar (4 a beat)',
  '3/4 (a waltz lilt): 12 steps a bar, the accent on step 0',
  '6/8 (two swaying beats of three): 12 steps a bar, accents on steps 0 and 6',
  '5/4 (lopsided, restless): 20 steps a bar, grouped 3+2 beats',
  '7/8 (skipping): 14 steps a bar, grouped 2+2+3 (eighths: 2 steps each)',
  '4/4 with a shuffle: 16 steps a bar, the off-beat 16ths late (play the swung notes on steps 3, 7, 11, 15 instead of 2, 6, 10, 14)',
  '12/8 (a triplet feel): 12 steps a bar, four beats of three',
];

const SCALES = [
  'major (bright, plain)',
  'Lydian: major with a raised 4th (dreamy, floating; lean on that #4)',
  'Mixolydian: major with a flat 7th (cheeky, folk, rock; use the bVII chord)',
  'major pentatonic (sunny, open; no half steps)',
  'Dorian: minor with a raised 6th (cool, hopeful-sad; the IV chord is major)',
  'natural minor (melancholy)',
  'harmonic minor: the raised 7th (exotic, dramatic; the V chord is major)',
  'minor pentatonic / blues: with the flat 5th as a passing note (gritty, playful)',
  'Phrygian: minor with a flat 2nd (tense, Spanish, desert)',
  'whole-tone in a short passage (a dreamy or magical moment)',
];

const PROGRESSIONS = [
  'I – V – vi – iii – IV – I – IV – V',
  'I – iii – IV – iv (the minor iv: bittersweet)',
  'I – bVII – IV – I (Mixolydian rock)',
  'vi – IV – I – V',
  'I – IV – ii – V with a turnaround',
  'ii – V – I – vi (jazzy)',
  'I – II – IV – I (Lydian: the major II)',
  'i – bVI – bIII – bVII (epic minor)',
  'i – iv – v – i, then bVI – bVII – i',
  'I – vi – ii – V (doo-wop circle)',
  'a pedal: one bass note under changing chords for a whole pattern, then a sudden change',
  'I – bIII – IV – I (a borrowed bIII: brighter rock)',
  'a 12-bar blues (I I I I / IV IV I I / V IV I V)',
];

const MELODY = [
  'rests: whole beats of silence, phrases that breathe (a melody is not on every step)',
  'syncopation: notes that start on off-beats (odd steps) and are held across the beat',
  'a short motif (3-5 notes) repeated, each time a step higher (a sequence) or with its end changed',
  'call and response: the lead plays a phrase, a second instrument answers it',
  'wide leaps (a 6th, an octave) in the middle of stepwise lines',
  'a chromatic passing or neighbour note now and then',
  'a pickup: the phrase starts before the bar line (the last steps of the bar before)',
  'long notes against a busy accompaniment (and the other way round in the next part)',
  'repeated notes with a rhythm of their own (a rhythmic hook), then a run up to a high note',
  'an arpeggio melody: the chord tones broken up and down',
  'a countermelody: a second line moving against the lead (up when it goes down)',
  'triplets in a 4/4 bar (three notes in the time of two: lengths of 2-3 steps, unevenly)',
  'a melody that ends a phrase on an unexpected note (the 2nd, the 6th, the #4), not always the root',
  'a key change up a step for the last part',
  'staccato notes (length 1) against legato ones (long lengths)',
];

const DRUMS = [
  'half-time: the snare only on beat 3, a sparse kick',
  'four on the floor: a kick on every beat, open hats on the off-beats',
  'a breakbeat: kicks on 0, 10 and 11, snares on 4 and 12, ghost notes (soft velocity)',
  'no drums in the first part; they come in for the second',
  'a march: a snare roll pattern with accents',
  'a shuffle: the hats swung, the snare on 2 and 4',
  'a bossa-nova-like pattern: the kick and the rim answering each other off the beat',
  'toms (low noise or triangle pitch drops) for fills at the end of every 4 bars',
  'only hand percussion: hats and a soft noise shaker, no kick',
];

const FORMS = [
  'A A B A (the B a contrast: other chords, other register)',
  'intro – A – B – A – B – bridge – B (the bridge quieter, fewer instruments)',
  'A B A C (C a surprise: a new key or a breakdown)',
  'a short loop that builds: each time round an instrument joins',
  'theme and variation: A, then A with the melody changed, then A with a new rhythm',
  'A – B with a 2-bar break where everything but one instrument stops',
];

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length) % list.length];

/** A song brief: one of each, and two melodic tricks. */
export function songIdea(random: () => number = Math.random): SongIdea {
  const first = pick(MELODY, random);
  let second = pick(MELODY, random);
  for (let n = 0; n < 5 && second === first; n++) second = pick(MELODY, random);
  return { meter: pick(METERS, random), scale: pick(SCALES, random), progression: pick(PROGRESSIONS, random), melody: [first, second], drums: pick(DRUMS, random), form: pick(FORMS, random) };
}

/** The lists the brief is drawn from (the guidance gives them, to swap what clashes with a request). */
export const SONG_IDEA_LISTS = { METERS, SCALES, PROGRESSIONS, MELODY, DRUMS, FORMS };
