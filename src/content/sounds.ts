/**
 * Sound design as data: every sound is a few synthesized layers (oscillators or noise, a pitch
 * sweep, an optional filter sweep and a percussive envelope), so the game ships no audio files
 * and every sound can be tuned like a skill or a palette. `soundFor` maps game events to sounds;
 * `THEME_AMBIENCE` gives each dungeon theme a quiet drone. The engine (src/audio/engine.ts) plays
 * them with WebAudio; agents render them offline with the `audio.inspect` tool.
 */
import { SKILLS } from './skills';

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';

export interface SoundLayer {
  wave: Wave;
  /** Start / end frequency, Hz (noise: filter sweep start / end when no filter is given). */
  f0: number;
  f1?: number;
  /** Seconds. */
  dur: number;
  attack?: number;
  gain: number;
  /** Seconds before this layer starts. */
  delay?: number;
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; f0: number; f1?: number; q?: number };
}

export interface SoundDef {
  layers: SoundLayer[];
  /** Random pitch variation (+-fraction) per play, so repeats never sound identical. */
  vary?: number;
  /** Simultaneous voices allowed. */
  max?: number;
  /** Minimum seconds between two plays. */
  gap?: number;
  gain?: number;
}

const L = (wave: Wave, f0: number, f1: number, dur: number, gain: number, extra: Partial<SoundLayer> = {}): SoundLayer => ({ wave, f0, f1, dur, gain, ...extra });
const lp = (f0: number, f1?: number, q = 0.8) => ({ type: 'lowpass' as const, f0, f1, q });
const hp = (f0: number, f1?: number, q = 0.7) => ({ type: 'highpass' as const, f0, f1, q });
const bp = (f0: number, f1?: number, q = 1.5) => ({ type: 'bandpass' as const, f0, f1, q });
/** An arpeggio: one short tone per note. */
const arp = (wave: Wave, notes: number[], step: number, dur: number, gain: number): SoundLayer[] =>
  notes.map((f, i) => L(wave, f, f, dur, gain, { delay: i * step, attack: 0.005 }));

export const SOUNDS: Record<string, SoundDef> = {
  // ---- combat
  swing: { layers: [L('noise', 0, 0, 0.13, 0.32, { filter: bp(1800, 600, 1.2), attack: 0.02 })], vary: 0.15, max: 4, gap: 0.04 },
  swing_heavy: { layers: [L('noise', 0, 0, 0.24, 0.42, { filter: bp(1100, 300, 1.1), attack: 0.03 }), L('sine', 140, 70, 0.2, 0.18)], vary: 0.1, max: 3 },
  swing_monster: { layers: [L('noise', 0, 0, 0.14, 0.16, { filter: bp(900, 400, 1.2), attack: 0.02 })], vary: 0.2, max: 3, gap: 0.08 },
  hit: { layers: [L('noise', 0, 0, 0.07, 0.42, { filter: lp(3200, 900) }), L('square', 180, 70, 0.06, 0.12)], vary: 0.18, max: 6, gap: 0.025 },
  hit_heavy: { layers: [L('noise', 0, 0, 0.14, 0.5, { filter: lp(2000, 300) }), L('sine', 110, 40, 0.18, 0.4)], vary: 0.12, max: 4, gap: 0.04 },
  hit_crit: { layers: [L('noise', 0, 0, 0.1, 0.5, { filter: hp(1200) }), L('square', 900, 300, 0.09, 0.14), L('sine', 160, 50, 0.16, 0.32)], vary: 0.1, max: 4, gap: 0.04 },
  hit_fire: { layers: [L('noise', 0, 0, 0.22, 0.32, { filter: bp(900, 2600, 0.8) })], vary: 0.15, max: 3, gap: 0.06 },
  hit_cold: { layers: [L('triangle', 2400, 1800, 0.12, 0.12), L('noise', 0, 0, 0.1, 0.25, { filter: hp(3000) })], vary: 0.12, max: 3, gap: 0.06 },
  hit_lightning: { layers: [L('sawtooth', 1600, 200, 0.09, 0.14), L('noise', 0, 0, 0.08, 0.28, { filter: hp(2500) })], vary: 0.2, max: 3, gap: 0.05 },
  hurt: { layers: [L('noise', 0, 0, 0.12, 0.5, { filter: lp(1400, 400) }), L('sine', 220, 90, 0.16, 0.34)], vary: 0.08, max: 2, gap: 0.12 },
  block: { layers: [L('square', 1200, 900, 0.06, 0.14), L('noise', 0, 0, 0.05, 0.3, { filter: bp(4000, 4000, 4) })], vary: 0.1, max: 2, gap: 0.06 },
  evade: { layers: [L('noise', 0, 0, 0.12, 0.18, { filter: bp(2500, 900, 2), attack: 0.03 })], vary: 0.2, max: 2, gap: 0.1 },
  roll: { layers: [L('noise', 0, 0, 0.26, 0.22, { filter: lp(700, 200), attack: 0.04 })], vary: 0.1, max: 1 },
  kill: { layers: [L('noise', 0, 0, 0.18, 0.36, { filter: lp(1600, 200) }), L('triangle', 300, 80, 0.2, 0.16)], vary: 0.15, max: 4, gap: 0.03 },
  kill_elite: { layers: [L('noise', 0, 0, 0.35, 0.45, { filter: lp(2400, 150) }), L('sine', 160, 40, 0.4, 0.4), ...arp('triangle', [523, 659], 0.06, 0.18, 0.08)], max: 2 },
  boss_death: { layers: [L('noise', 0, 0, 1.4, 0.55, { filter: lp(1800, 60), attack: 0.02 }), L('sine', 90, 25, 1.4, 0.55), ...arp('triangle', [392, 523, 659, 784], 0.12, 0.5, 0.12)], max: 1 },
  hero_death: { layers: [L('sine', 330, 110, 1.1, 0.35), L('triangle', 247, 82, 1.2, 0.25, { delay: 0.1 }), L('noise', 0, 0, 0.6, 0.2, { filter: lp(600, 100) })], max: 1 },
  // ---- skills
  cast_fire: { layers: [L('noise', 0, 0, 0.32, 0.4, { filter: bp(500, 2200, 0.9), attack: 0.03 }), L('sawtooth', 120, 240, 0.25, 0.08)], vary: 0.1, max: 3, gap: 0.05 },
  cast_cold: { layers: [L('noise', 0, 0, 0.3, 0.26, { filter: hp(2500, 5000), attack: 0.02 }), L('triangle', 1600, 2400, 0.25, 0.1)], vary: 0.1, max: 3, gap: 0.05 },
  cast_lightning: { layers: [L('sawtooth', 220, 2200, 0.12, 0.14), L('noise', 0, 0, 0.18, 0.3, { filter: hp(2000) }), L('square', 1800, 120, 0.15, 0.06, { delay: 0.04 })], vary: 0.15, max: 3, gap: 0.05 },
  cast_chaos: { layers: [L('noise', 0, 0, 0.4, 0.3, { filter: bp(400, 900, 2), attack: 0.06 }), L('sine', 70, 110, 0.4, 0.2)], vary: 0.1, max: 2 },
  cast_physical: { layers: [L('noise', 0, 0, 0.18, 0.3, { filter: bp(1400, 500, 1), attack: 0.02 })], vary: 0.15, max: 3, gap: 0.05 },
  cast_meteor: { layers: [L('noise', 0, 0, 0.6, 0.35, { filter: lp(400, 2400), attack: 0.4 }), L('sine', 60, 160, 0.6, 0.2, { attack: 0.3 })], max: 2 },
  warcry: { layers: [L('sawtooth', 160, 110, 0.45, 0.2, { filter: lp(900), attack: 0.03 }), L('sawtooth', 240, 165, 0.45, 0.12, { filter: lp(1200) }), L('noise', 0, 0, 0.3, 0.2, { filter: lp(500) })], max: 1 },
  summon: { layers: [...arp('triangle', [262, 392, 523], 0.07, 0.25, 0.14), L('noise', 0, 0, 0.5, 0.16, { filter: bp(800, 2000, 2), attack: 0.1 })], max: 1 },
  warp: { layers: [L('sine', 300, 1400, 0.3, 0.26, { attack: 0.02 }), L('noise', 0, 0, 0.3, 0.16, { filter: bp(600, 3000, 3) })], vary: 0.1, max: 2, gap: 0.1 },
  boom: { layers: [L('noise', 0, 0, 0.7, 0.7, { filter: lp(2500, 80) }), L('sine', 80, 28, 0.6, 0.6)], vary: 0.12, max: 3, gap: 0.04 },
  boss_cast: { layers: [L('sawtooth', 90, 60, 0.6, 0.18, { filter: lp(600), attack: 0.08 }), L('noise', 0, 0, 0.6, 0.24, { filter: bp(300, 900, 1.5), attack: 0.1 })], max: 2 },
  roar: { layers: [L('sawtooth', 110, 70, 0.9, 0.3, { filter: lp(800, 300), attack: 0.05 }), L('sawtooth', 165, 98, 0.9, 0.18, { filter: lp(1200, 400) }), L('noise', 0, 0, 0.8, 0.25, { filter: lp(600, 200) })], max: 1 },
  // ---- loot and progress
  drop_gold: { layers: [L('triangle', 1800, 1800, 0.05, 0.06)], vary: 0.25, max: 3, gap: 0.03 },
  drop_magic: { layers: arp('triangle', [880, 1175], 0.05, 0.16, 0.12), max: 2, gap: 0.05 },
  drop_rare: { layers: arp('triangle', [784, 988, 1319], 0.06, 0.22, 0.16), max: 2, gap: 0.06 },
  drop_unique: { layers: [...arp('sine', [523, 659, 784, 1047, 1319], 0.08, 0.5, 0.2), L('noise', 0, 0, 0.9, 0.12, { filter: hp(5000), attack: 0.2 })], max: 1 },
  coin: { layers: [L('square', 1568, 1568, 0.05, 0.07), L('square', 2093, 2093, 0.09, 0.07, { delay: 0.045 })], vary: 0.04, max: 3, gap: 0.035 },
  pickup: { layers: [L('triangle', 440, 880, 0.08, 0.18), L('noise', 0, 0, 0.06, 0.12, { filter: bp(2000, 2000, 2) })], vary: 0.05, max: 2, gap: 0.05 },
  orb: { layers: [L('sine', 660, 1320, 0.15, 0.16)], vary: 0.08, max: 2, gap: 0.05 },
  gulp: { layers: [L('sine', 300, 600, 0.09, 0.2), L('sine', 320, 700, 0.09, 0.18, { delay: 0.11 }), L('noise', 0, 0, 0.25, 0.08, { filter: lp(800) })], max: 1 },
  denied: { layers: [L('square', 200, 150, 0.12, 0.1), L('square', 150, 110, 0.14, 0.1, { delay: 0.12 })], max: 1, gap: 0.3 },
  levelup: { layers: [...arp('triangle', [523, 659, 784, 1047], 0.09, 0.4, 0.2), ...arp('sine', [262, 330, 392, 523], 0.09, 0.5, 0.12), L('noise', 0, 0, 1.2, 0.1, { filter: hp(4000), attack: 0.3, delay: 0.3 })], max: 1 },
  fanfare: { layers: [...arp('sawtooth', [392, 392, 523, 659, 784], 0.11, 0.3, 0.07), ...arp('triangle', [196, 262, 330, 392, 523], 0.11, 0.45, 0.14)], max: 1 },
  stinger: { layers: [L('sine', 110, 110, 1.6, 0.18, { attack: 0.2 }), L('triangle', 165, 165, 1.6, 0.1, { attack: 0.4 }), L('noise', 0, 0, 1.4, 0.1, { filter: bp(300, 120, 2), attack: 0.3 })], max: 1 },
  portal_open: { layers: [L('sine', 200, 800, 0.8, 0.2, { attack: 0.2 }), L('noise', 0, 0, 0.9, 0.14, { filter: bp(400, 2400, 3), attack: 0.3 })], max: 1 },
  // ---- level mechanics
  fuse: { layers: [L('noise', 0, 0, 0.6, 0.16, { filter: hp(3000), attack: 0.02 }), L('square', 3000, 2800, 0.6, 0.02)], max: 3, gap: 0.08 },
  spikes: { layers: [L('noise', 0, 0, 0.08, 0.13, { filter: bp(2600, 2600, 3) }), L('square', 600, 400, 0.05, 0.035)], vary: 0.2, max: 2, gap: 0.3 },
  vent: { layers: [L('noise', 0, 0, 0.7, 0.3, { filter: bp(300, 1500, 0.8), attack: 0.06 })], vary: 0.15, max: 3, gap: 0.15 },
  boing: { layers: [L('sine', 180, 620, 0.25, 0.3), L('triangle', 360, 1240, 0.2, 0.08)], vary: 0.06, max: 2, gap: 0.1 },
  shrine: { layers: [...arp('sine', [659, 988, 1319], 0.07, 0.6, 0.16), L('noise', 0, 0, 0.8, 0.1, { filter: hp(5000), attack: 0.2 })], max: 1 },
  shatter: { layers: [L('noise', 0, 0, 0.35, 0.4, { filter: hp(1800, 600) }), ...arp('triangle', [2093, 1568, 2637], 0.03, 0.12, 0.06)], max: 2 },
  ignite: { layers: [L('noise', 0, 0, 0.5, 0.22, { filter: bp(600, 1800, 1), attack: 0.05 }), L('sine', 400, 800, 0.3, 0.08)], max: 2, gap: 0.1 },
  rumble: { layers: [L('noise', 0, 0, 1, 0.3, { filter: lp(220, 120), attack: 0.1 })], max: 2, gap: 0.3 },
  giggle: { layers: arp('square', [1200, 1500, 1300, 1700], 0.06, 0.07, 0.05), max: 1, gap: 0.5 },
  // ---- interface
  ui_open: { layers: [L('triangle', 600, 900, 0.07, 0.08)], max: 1, gap: 0.05 },
  ui_close: { layers: [L('triangle', 900, 600, 0.07, 0.07)], max: 1, gap: 0.05 },
};

export interface AmbienceDef {
  /** Drone oscillators, Hz. */
  drone: number[];
  wave: 'sine' | 'triangle' | 'sawtooth';
  droneGain: number;
  /** Filtered noise bed (wind, hum, fire). */
  noise: { type: 'lowpass' | 'bandpass' | 'highpass'; f: number; q: number; gain: number };
  /** Slow swell, Hz. */
  lfo: number;
}

const A = (drone: number[], wave: AmbienceDef['wave'], droneGain: number, noise: AmbienceDef['noise'], lfo: number): AmbienceDef => ({ drone, wave, droneGain, noise, lfo });

export const THEME_AMBIENCE: Record<string, AmbienceDef> = {
  town: A([110, 165, 220], 'sine', 0.05, { type: 'bandpass', f: 1200, q: 0.4, gain: 0.025 }, 0.07),
  crypt: A([55, 82.4], 'sine', 0.09, { type: 'lowpass', f: 300, q: 0.6, gain: 0.05 }, 0.05),
  cellar: A([65.4, 98], 'triangle', 0.06, { type: 'lowpass', f: 450, q: 0.5, gain: 0.05 }, 0.06),
  catacomb: A([49, 73.4], 'sine', 0.09, { type: 'bandpass', f: 250, q: 1, gain: 0.05 }, 0.04),
  frost: A([98, 147], 'sine', 0.04, { type: 'bandpass', f: 1800, q: 0.5, gain: 0.07 }, 0.09),
  foundry: A([41.2, 61.7], 'sawtooth', 0.035, { type: 'lowpass', f: 600, q: 0.8, gain: 0.08 }, 0.12),
  ruins: A([73.4, 110], 'triangle', 0.05, { type: 'bandpass', f: 900, q: 0.4, gain: 0.04 }, 0.06),
  abyss: A([36.7, 55, 77.8], 'sine', 0.1, { type: 'lowpass', f: 220, q: 1.2, gain: 0.05 }, 0.03),
  temple: A([87.3, 130.8, 174.6], 'sine', 0.05, { type: 'bandpass', f: 700, q: 0.6, gain: 0.03 }, 0.05),
  ashlands: A([46.2, 69.3], 'triangle', 0.05, { type: 'lowpass', f: 800, q: 0.6, gain: 0.08 }, 0.1),
};

export interface SoundCue {
  id: string;
  x?: number;
  z?: number;
  gain?: number;
  pitch?: number;
}

const ELEMENT_CAST: Record<string, string> = { fire: 'cast_fire', cold: 'cast_cold', lightning: 'cast_lightning', chaos: 'cast_chaos', physical: 'cast_physical' };

/**
 * The sound for a game event (null = silent). `hero` is the hero's character id; `heroSide` says
 * whether a character fights for the hero (its minions), so their hits sound like the hero's.
 */
export function soundFor(e: { type: string; [k: string]: unknown }, hero: string, heroSide: (id: string) => boolean = (id) => id === hero): SoundCue | null {
  const pos = typeof e.x === 'number' && typeof e.z === 'number' ? { x: e.x, z: e.z } : {};
  const cue = (id: string, extra: Partial<SoundCue> = {}): SoundCue => ({ id, ...pos, ...extra });
  switch (e.type) {
    case 'strike': {
      const s = SKILLS[String(e.skill)];
      if (e.id === hero) return cue(s && (s.tags.includes('area') || (s.weapon ?? 0) >= 140) ? 'swing_heavy' : 'swing');
      return cue('swing_monster');
    }
    case 'hit': {
      if (e.target === hero) return cue('hurt');
      if (!heroSide(String(e.attacker))) return null;
      if (e.crit) return cue('hit_crit');
      if (e.heavy) return cue('hit_heavy');
      const elem = String(e.dmgType);
      return cue(elem === 'fire' ? 'hit_fire' : elem === 'cold' ? 'hit_cold' : elem === 'lightning' ? 'hit_lightning' : 'hit');
    }
    case 'block': return cue('block');
    case 'evade': return e.target === hero ? cue('evade') : null;
    case 'death':
      if (e.id === hero) return null;
      if (e.boss) return cue('boss_death');
      return cue(e.rarity === 'rare' || e.rarity === 'unique' ? 'kill_elite' : 'kill');
    case 'hero.died': return cue('hero_death');
    case 'skill': {
      const s = SKILLS[String(e.skill)];
      if (!s) return null;
      if (e.id !== hero) return s.id.startsWith('b_') ? cue('boss_cast') : null;
      if (s.id === 'dodge') return cue('roll');
      if (s.id === 'warcry') return cue('warcry');
      if (s.id === 'meteor') return cue('cast_meteor');
      if (s.tags.includes('minion')) return cue('summon');
      if (s.kind !== 'spell') return null;
      const elem = ['fire', 'cold', 'lightning', 'chaos'].find((t) => s.tags.includes(t as never)) ?? 'physical';
      return cue(ELEMENT_CAST[elem]);
    }
    case 'blink': return cue('warp', { x: e.toX as number, z: e.toZ as number });
    case 'explosion': return cue('boom');
    case 'drop':
      if (e.kind === 'gold') return cue('drop_gold');
      if (e.kind !== 'item') return null;
      return e.rarity === 'unique' ? cue('drop_unique') : e.rarity === 'rare' ? cue('drop_rare') : e.rarity === 'magic' ? cue('drop_magic') : null;
    case 'pickup': return e.kind === 'gold' ? cue('coin') : e.kind === 'item' ? cue('pickup') : e.kind === 'orb' ? cue('orb') : null;
    case 'flask': return cue('gulp');
    case 'flask.empty': return cue('denied');
    case 'levelup': return cue('levelup');
    case 'keg.lit': return cue('fuse');
    case 'spikes.up': return cue('spikes');
    case 'vent.erupt': return cue('vent');
    case 'launch': return cue('boing');
    case 'rift': return cue('warp');
    case 'shrine': return cue('shrine');
    case 'totem.break': return cue('shatter');
    case 'beacon.lit': return cue('ignite');
    case 'boulder': return cue('rumble');
    case 'imp.escape': return cue('giggle');
    case 'boss.phase': case 'boss.enrage': return cue('roar');
    case 'exit.open': return cue('portal_open');
    case 'stage.clear': return cue('fanfare');
    case 'mode': return e.mode === 'dungeon' ? cue('stinger') : null;
  }
  return null;
}
