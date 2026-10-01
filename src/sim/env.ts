/**
 * Environmental damage for level mechanics (kegs, spikes, vents, boulders): hits everyone, with
 * kills credited to whoever set the hazard off. Against monsters it rides the offense curve (a
 * keg should flatten a pack at its own depth); against the hero it rides the monster-damage
 * curve (dangerous, never a one-shot). Mechanic kills give bonus experience: the reward for
 * playing the level's trick well.
 */
import type { AilmentId } from '../content/skills';
import type { DamageMap, DamageType } from '../content/stats';
import { applyPacket } from './combat';
import { monsterDamage, power } from './scaling';
import type { Sim } from './sim';
import type { Character, Packet } from './types';

export interface EnvHit {
  /** Damage at level 1; scaled per target by the stage level. */
  dmg: DamageMap;
  /** Character credited for kills (usually the hero who lit the fuse). */
  credit?: string | null;
  knock?: number;
  stagger?: number;
  heavy?: boolean;
  ailments?: Partial<Record<AilmentId, number>>;
  /** Fraction of the damage the hero (and minions) take. */
  heroScale?: number;
}

export function envLevel(sim: Sim): number {
  return sim.level.monsterLevel ?? 1;
}

export function envHit(sim: Sim, t: Character, fromX: number, fromZ: number, o: EnvHit) {
  if (t.state === 'dead') return null;
  const L = envLevel(sim);
  const heroSide = t.team === 'hero';
  const k = heroSide ? monsterDamage(L) * (o.heroScale ?? 0.6) : power(L);
  const dmg: Partial<Record<DamageType, number>> = {};
  for (const [type, v] of Object.entries(o.dmg) as Array<[DamageType, number]>) dmg[type] = v * k;
  const p: Packet = {
    attacker: o.credit ?? 'env', team: 'env', level: L, skill: 'env', tags: ['area'], dmg, crit: false,
    ailments: { chill: 0, ...(o.ailments ?? {}) }, knock: o.knock ?? 0, stagger: o.stagger ?? 60, heavy: !!o.heavy, pull: 0,
    isAttack: false, penetration: 0, alwaysHit: true, leech: 0, manaLeech: 0, lifeOnHit: 0, manaOnHit: 0, ailmentEffect: 1, ailmentDuration: 1,
  };
  return applyPacket(sim, t, p, fromX, fromZ);
}

/** Damages everyone within `radius` of (x, z); returns how many were hit. */
export function envBlast(sim: Sim, x: number, z: number, radius: number, o: EnvHit): number {
  let n = 0;
  for (const c of [...sim.characters.values()]) {
    if (c.state === 'dead' || c.iframes > 0) continue;
    if (Math.hypot(c.pos.x - x, c.pos.z - z) > radius + c.radius) continue;
    if (envHit(sim, c, x, z, o)) n++;
  }
  return n;
}
