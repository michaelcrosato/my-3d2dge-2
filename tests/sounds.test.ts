/** Sound design data: valid recipes, every event cue resolvable, every theme has ambience. */
import { describe, expect, it } from 'vitest';
import { SOUNDS, soundFor, THEME_AMBIENCE } from '../src/content/sounds';
import { THEMES } from '../src/content/themes';

describe('sound recipes', () => {
  it('are well formed', () => {
    for (const [id, d] of Object.entries(SOUNDS)) {
      expect(d.layers.length, id).toBeGreaterThan(0);
      for (const l of d.layers) {
        expect(l.dur, id).toBeGreaterThan(0);
        expect(l.dur, id).toBeLessThan(3);
        expect(l.gain, id).toBeGreaterThan(0);
        expect(l.gain, id).toBeLessThanOrEqual(1);
        if (l.wave !== 'noise') for (const f of [l.f0, l.f1 ?? l.f0]) expect(f, id).toBeGreaterThanOrEqual(20);
        if (l.filter) expect(l.filter.f0, id).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('every theme has an ambience', () => {
    for (const t of Object.keys(THEMES)) expect(THEME_AMBIENCE[t], t).toBeTruthy();
  });
});

describe('event to sound mapping', () => {
  const hero = 'player';
  const ev = (type: string, data: Record<string, unknown> = {}) => soundFor({ type, x: 1, z: 2, ...data }, hero, (id) => id === hero || id === 'wolf1');

  it('maps combat, loot and mechanics to existing sounds', () => {
    const cases: Array<[string, Record<string, unknown>, string | null]> = [
      ['strike', { id: hero, skill: 'slash1' }, 'swing'],
      ['strike', { id: hero, skill: 'cleave' }, 'swing_heavy'],
      ['strike', { id: 'm1', skill: 'm_bite' }, 'swing_monster'],
      ['hit', { attacker: hero, target: 'm1', crit: true }, 'hit_crit'],
      ['hit', { attacker: 'wolf1', target: 'm1', dmgType: 'fire' }, 'hit_fire'],
      ['hit', { attacker: 'm1', target: hero }, 'hurt'],
      ['hit', { attacker: 'm1', target: 'm2' }, null],
      ['death', { id: 'm1', boss: true }, 'boss_death'],
      ['death', { id: 'm1', rarity: 'rare' }, 'kill_elite'],
      ['skill', { id: hero, skill: 'fireball' }, 'cast_fire'],
      ['skill', { id: hero, skill: 'chainlightning' }, 'cast_lightning'],
      ['skill', { id: hero, skill: 'dodge' }, 'roll'],
      ['skill', { id: 'boss', skill: 'b_quake' }, 'boss_cast'],
      ['drop', { kind: 'item', rarity: 'unique' }, 'drop_unique'],
      ['drop', { kind: 'item', rarity: 'normal' }, null],
      ['pickup', { kind: 'gold' }, 'coin'],
      ['levelup', {}, 'levelup'],
      ['keg.lit', {}, 'fuse'],
      ['launch', {}, 'boing'],
      ['mode', { mode: 'dungeon' }, 'stinger'],
    ];
    for (const [type, data, want] of cases) {
      const cue = ev(type, data);
      expect(cue?.id ?? null, `${type} ${JSON.stringify(data)}`).toBe(want);
      if (cue) {
        expect(SOUNDS[cue.id], cue.id).toBeTruthy();
        expect(cue.x).toBe(1);
      }
    }
  });
});

describe('generative music', () => {
  it('composes deterministic bars in key for every mood, and every theme has a mood', async () => {
    const { MOODS, THEME_MOOD, composeBar } = await import('../src/content/music');
    const { THEMES } = await import('../src/content/themes');
    for (const t of Object.keys(THEMES)) expect(MOODS[THEME_MOOD[t]], t).toBeTruthy();
    for (const [id, m] of Object.entries(MOODS)) {
      const allowed = new Set(m.scale);
      for (let bar = 0; bar < 16; bar++) {
        const notes = composeBar(m, 7, bar);
        expect(notes).toEqual(composeBar(m, 7, bar));
        expect(notes.some((n) => n.voice === 'bass'), id).toBe(true);
        for (const n of notes) {
          const semis = Math.round(12 * Math.log2(n.freq / m.root));
          expect(allowed.has(((semis % 12) + 12) % 12), `${id} bar ${bar} ${n.freq}`).toBe(true);
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(16);
        }
      }
      // Bars differ (generative, not a loop).
      expect(JSON.stringify(composeBar(m, 7, 0))).not.toBe(JSON.stringify(composeBar(m, 7, 5)));
    }
  });
});
