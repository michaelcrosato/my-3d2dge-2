/**
 * Generative music as data: a mood is a tempo, a mode, a root and a few voices (bass, pad,
 * melody) with densities. The engine walks bars and steps, drawing notes from a seeded RNG per
 * bar, so the score never loops audibly but always stays in key. Moods follow the game: town,
 * the dungeons (one per theme root), and boss fights.
 */
import { Rng } from '../sim/rng';

export interface Voice {
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth';
  /** Octave offset from the root. */
  octave: number;
  gain: number;
  /** Seconds the note rings (scaled by the step length for short voices). */
  length: number;
  attack: number;
  /** Lowpass cutoff, Hz. */
  cutoff: number;
}

export interface Mood {
  bpm: number;
  /** Scale degrees in semitones. */
  scale: number[];
  /** Root note, Hz. */
  root: number;
  /** Chord progression as scale-degree indices, one per bar. */
  progression: number[];
  bass: Voice & { pattern: number[] };
  pad: Voice;
  melody: Voice & { density: number; leap: number };
  /** Optional steady pulse (eighths) for tension. */
  pulse?: Voice;
}

const PENTA_MAJOR = [0, 2, 4, 7, 9];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

const v = (wave: Voice['wave'], octave: number, gain: number, length: number, attack: number, cutoff: number): Voice => ({ wave, octave, gain, length, attack, cutoff });

export const MOODS: Record<string, Mood> = {
  town: {
    bpm: 78, scale: PENTA_MAJOR, root: 196, progression: [0, 3, 4, 2],
    bass: { ...v('sine', -1, 0.16, 1.6, 0.02, 600), pattern: [0, 8] },
    pad: v('triangle', 0, 0.045, 3.2, 0.8, 1400),
    melody: { ...v('triangle', 1, 0.075, 0.7, 0.01, 2600), density: 0.42, leap: 2 },
  },
  dungeon: {
    bpm: 64, scale: AEOLIAN, root: 110, progression: [0, 5, 3, 4],
    bass: { ...v('sine', -1, 0.18, 2.4, 0.05, 400), pattern: [0] },
    pad: v('sawtooth', 0, 0.022, 4, 1.5, 700),
    melody: { ...v('triangle', 1, 0.05, 1.1, 0.02, 1800), density: 0.18, leap: 3 },
  },
  dark: {
    bpm: 58, scale: PHRYGIAN, root: 98, progression: [0, 1, 0, 6],
    bass: { ...v('sine', -1, 0.2, 2.8, 0.08, 300), pattern: [0] },
    pad: v('sawtooth', 0, 0.02, 4.4, 2, 500),
    melody: { ...v('sine', 1, 0.045, 1.4, 0.04, 1500), density: 0.12, leap: 2 },
  },
  boss: {
    bpm: 128, scale: DORIAN, root: 98, progression: [0, 0, 5, 6],
    bass: { ...v('sawtooth', -1, 0.12, 0.22, 0.005, 700), pattern: [0, 2, 4, 6, 8, 10, 12, 14] },
    pad: v('square', 0, 0.018, 1.8, 0.3, 900),
    melody: { ...v('square', 1, 0.05, 0.25, 0.005, 2200), density: 0.38, leap: 3 },
    pulse: v('triangle', 2, 0.03, 0.1, 0.003, 3000),
  },
};

/** Which mood a dungeon theme plays. */
export const THEME_MOOD: Record<string, string> = {
  crypt: 'dark', catacomb: 'dark', abyss: 'dark', cellar: 'dungeon', frost: 'dungeon', foundry: 'dungeon', ruins: 'dungeon', temple: 'dungeon', ashlands: 'dungeon', town: 'town',
};

export interface NoteEvent {
  /** Step within the bar (16 steps). */
  step: number;
  freq: number;
  voice: 'bass' | 'pad' | 'melody' | 'pulse';
}

const hz = (root: number, semis: number) => root * Math.pow(2, semis / 12);

/** The notes of bar `bar` for a mood: deterministic for (mood, seed, bar). */
export function composeBar(mood: Mood, seed: number, bar: number): NoteEvent[] {
  const r = new Rng(seed * 7919 + bar * 104729 + 17);
  const out: NoteEvent[] = [];
  const degree = mood.progression[bar % mood.progression.length];
  const sc = mood.scale;
  const tone = (deg: number, octave: number) => {
    const d = ((deg % sc.length) + sc.length) % sc.length;
    const oct = Math.floor(deg / sc.length) + octave;
    return hz(mood.root, sc[d] + 12 * oct);
  };
  for (const step of mood.bass.pattern) out.push({ step, freq: tone(degree, mood.bass.octave), voice: 'bass' });
  for (const third of [0, 2, 4]) out.push({ step: 0, freq: tone(degree + third, mood.pad.octave), voice: 'pad' });
  let cur = degree + 2 * (r.int(0, 2));
  for (let step = 0; step < 16; step += 2) {
    if (!r.chance(mood.melody.density * (step % 4 === 0 ? 1.4 : 0.8))) continue;
    cur += r.int(-mood.melody.leap, mood.melody.leap);
    cur = Math.max(degree - 2, Math.min(degree + sc.length + 2, cur));
    out.push({ step, freq: tone(cur, mood.melody.octave), voice: 'melody' });
  }
  if (mood.pulse) for (let step = 0; step < 16; step += 2) out.push({ step, freq: tone(degree + 4, mood.pulse.octave), voice: 'pulse' });
  return out;
}
