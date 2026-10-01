/**
 * Elite monster affix behaviours (Diablo-style champions and rares): molten trails, frost
 * pulses, shields, teleports, vortex pulls, splitting, death bursts, enrage and warding. Mods
 * (hasted, armoured...) are plain stat mods applied at spawn; behaviours live here.
 */
import { MONSTER_AFFIXES } from '../content/monsters';
import { skill as skillDef, type ZoneSpec } from '../content/skills';
import { addZone } from './actions';
import { addStatus } from './combat';
import type { Sim } from './sim';
import type { Character } from './types';

const MOLTEN: ZoneSpec = { shape: { kind: 'circle', radius: 1.0 }, delay: 0, duration: 2.6, tick: 0.5, tickMult: 1, hit: { stagger: 5, ailments: { ignite: 30 } }, visual: 'molten' };
const FROST: ZoneSpec = { shape: { kind: 'circle', radius: 3.2 }, delay: 0.95, duration: 0, hit: { knock: 3, stagger: 60, ailments: { chill: 100, freeze: 30 } }, visual: 'frostnova' };
const BURST: ZoneSpec = { shape: { kind: 'circle', radius: 2.6 }, delay: 1.0, duration: 0, hit: { knock: 7, stagger: 120, heavy: true, ailments: { ignite: 20 } }, visual: 'burst' };
const EXPLODE: ZoneSpec = { shape: { kind: 'circle', radius: 2.4 }, delay: 0.12, duration: 0, hit: { knock: 5, stagger: 80, ailments: { ignite: 30 } }, visual: 'burst' };

function targetOf(sim: Sim): Character | null {
  const hero = sim.player;
  return hero && hero.state !== 'dead' ? hero : null;
}

export function stepAffixes(sim: Sim, ch: Character) {
  const m = ch.monster!;
  if (!m.affixes.length || !ch.ai.awake) return;
  const t = targetOf(sim);
  const dist = t ? Math.hypot(t.pos.x - ch.pos.x, t.pos.z - ch.pos.z) : Infinity;
  for (const id of m.affixes) {
    const beh = MONSTER_AFFIXES[id]?.behaviour;
    if (!beh) continue;
    m.timers[id] = (m.timers[id] ?? 1) - sim.dt;
    if (beh === 'enrage') {
      if (ch.life < ch.maxLife * 0.3 && !ch.statuses.some((s) => s.id === 'enraged')) {
        addStatus(sim, ch, 'enraged', 9999, 1, ch.id);
        sim.emit('affix', { id: ch.id, affix: id });
      }
      continue;
    }
    if (m.timers[id] > 0) continue;
    switch (beh) {
      case 'molten':
        m.timers[id] = 0.55;
        if (ch.speed > 0.5) addZone(sim, ch, skillDef('a_molten'), MOLTEN, ch.pos.x, ch.pos.z, 0);
        break;
      case 'frostpulse':
        m.timers[id] = 5;
        if (dist < 7) addZone(sim, ch, skillDef('a_frost'), FROST, ch.pos.x, ch.pos.z, 0);
        break;
      case 'shielding':
        m.timers[id] = 9;
        if (dist < 12) addStatus(sim, ch, 'shielded', 2.6, 1, ch.id);
        break;
      case 'teleporter':
        m.timers[id] = 6;
        if (t && dist > 4 && dist < 16 && ch.state !== 'action') {
          const ang = sim.rng.next() * Math.PI * 2;
          const p = sim.nav.nearestFree({ x: t.pos.x + Math.cos(ang) * 1.8, z: t.pos.z + Math.sin(ang) * 1.8 });
          sim.emit('blink', { id: ch.id, fromX: ch.pos.x, fromZ: ch.pos.z, toX: p.x, toZ: p.z });
          sim.teleport(ch.id, p.x, p.z);
        }
        break;
      case 'vortex':
        m.timers[id] = 8;
        if (t && dist < 10 && dist > 2 && t.iframes <= 0) {
          const k = Math.min(14, dist * 2.2);
          t.knock = { x: ((ch.pos.x - t.pos.x) / dist) * k, z: ((ch.pos.z - t.pos.z) / dist) * k };
          sim.flinch(t, true);
          sim.emit('vortex', { id: ch.id, target: t.id });
        }
        break;
      case 'summoner':
        m.timers[id] = 10;
        if (dist < 14) sim.summon(ch, 'minion', 2, 25);
        break;
      case 'warding':
        m.timers[id] = 7;
        for (const o of sim.characters.values())
          if (o.team === ch.team && o !== ch && o.state !== 'dead' && Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z) < 9) addStatus(sim, o, 'empowered', 5, 1, ch.id);
        break;
      default:
        m.timers[id] = 5;
    }
  }
}

/** Death effects of the dying monster's affixes, plus the killer's on-kill rules. */
export function affixOnDeath(sim: Sim, t: Character, by: Character | null) {
  const m = t.monster!;
  for (const id of m.affixes) {
    const beh = MONSTER_AFFIXES[id]?.behaviour;
    if (beh === 'deathburst' || beh === 'molten') addZone(sim, t, skillDef('a_burst'), BURST, t.pos.x, t.pos.z, 0);
    if (beh === 'splitter' && t.scale > 0.6) {
      const kids = sim.summon(t, m.def, 2, 0, { scale: 0.72 * (t.scale / (t.scale || 1)) });
      for (const k of kids) {
        k.owner = null;
        if (k.monster) {
          k.monster.affixes = t.scale * 0.72 > 0.6 ? ['splitter'] : [];
          k.monster.xp = m.xp * 0.4;
          k.monster.pack = m.pack;
        }
        k.scale = t.scale * 0.72;
        k.ai.awake = true;
      }
    }
  }
  if (!by || by.team !== 'hero') return;
  const st = sim.stats(by);
  const explode = st.get('explodeOnKill');
  if (explode > 0 && sim.rng.next() * 100 < explode) addZone(sim, by, skillDef('a_explode'), EXPLODE, t.pos.x, t.pos.z, 0);
  const split = st.get('splitOnKill');
  if (split > 0 && sim.rng.next() * 100 < split) {
    const spores = sim.summon(by, 'sporeling', 1, 15, { at: t.pos });
    sim.emit('spores', { at: [t.pos.x, t.pos.z], count: spores.length });
  }
  if (st.has('stealMods') && (m.rarity === 'rare' || m.rarity === 'unique')) {
    for (const id of m.affixes) {
      const a = MONSTER_AFFIXES[id];
      if (!a?.mods.length) continue;
      by.statuses = by.statuses.filter((s) => s.id !== `stolen` || s.source !== id);
      by.statuses.push({ id: 'stolen', time: 20, duration: 20, magnitude: 1, source: id, stacks: 1, mods: a.mods });
    }
    by.statsVersion++;
    sim.emit('steal', { from: t.id, affixes: m.affixes });
  }
}
