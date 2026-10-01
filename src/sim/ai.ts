/**
 * Monster and minion brains. Behaviour comes from the archetype (content/monsters.ts): how far it
 * likes to stand, whether it kites or circles, hits and runs, flees, how often it decides. Skills
 * come from the monster's attack modules. Movement reads the shared flow field toward the hero
 * (one Dijkstra for the whole horde) or walks straight when it can see its target.
 */
import { MONSTERS } from '../content/monsters';
import { skill as skillDef } from '../content/skills';
import { blockedReason, startSkill } from './actions';
import { addStatus, hostile } from './combat';
import type { P2 } from './nav';
import { emptyInput, type Sim } from './sim';
import type { Character, CharacterInput } from './types';

const CHEST = 1.1;

function sees(sim: Sim, a: Character, b: Character): boolean {
  return sim.lineOfSight({ x: a.pos.x, y: a.pos.y + CHEST, z: a.pos.z }, { x: b.pos.x, y: b.pos.y + CHEST, z: b.pos.z });
}

/** Wakes a monster and its pack. */
export function wake(sim: Sim, ch: Character) {
  if (ch.ai.awake) return;
  ch.ai.awake = true;
  ch.ai.mode = 'chase';
  sim.emit('aggro', { id: ch.id, pack: ch.monster?.pack ?? null });
  const pack = ch.monster?.pack;
  if (!pack) return;
  for (const o of sim.characters.values()) {
    if (o !== ch && o.monster?.pack === pack && !o.ai.awake && o.state !== 'dead' && Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z) < 18) {
      o.ai.awake = true;
      o.ai.mode = 'chase';
    }
  }
}

function pickTarget(sim: Sim, ch: Character): Character | null {
  if (ch.team === 'hero') {
    // Minions: nearest enemy near their owner.
    const owner = ch.owner ? sim.characters.get(ch.owner) : null;
    const anchor = owner ?? ch;
    let best: Character | null = null, bd = 11;
    for (const o of sim.characters.values()) {
      if (o.state === 'dead' || !hostile(ch.team, o.team) || o.team === 'target') continue;
      const d = Math.hypot(o.pos.x - anchor.pos.x, o.pos.z - anchor.pos.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
  // Monsters: the hero, unless a hero minion is much closer.
  const hero = sim.player;
  let best: Character | null = hero && hero.state !== 'dead' ? hero : null;
  let bd = best ? Math.hypot(best.pos.x - ch.pos.x, best.pos.z - ch.pos.z) : Infinity;
  for (const o of sim.characters.values()) {
    if (!o.owner || o.state === 'dead' || o.team !== 'hero') continue;
    const d = Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z);
    if (d < bd * 0.6) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function separation(sim: Sim, ch: Character): P2 {
  let x = 0, z = 0;
  for (const o of sim.characters.values()) {
    if (o === ch || o.state === 'dead' || o.team !== ch.team) continue;
    const dx = ch.pos.x - o.pos.x, dz = ch.pos.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    const min = ch.radius + o.radius + 0.5;
    if (d < min && d > 1e-4) {
      x += (dx / d) * (1 - d / min);
      z += (dz / d) * (1 - d / min);
    }
  }
  return { x, z };
}

function steer(intent: CharacterInput, dir: P2 | null, sep: P2, k = 1) {
  if (!dir) return;
  let x = dir.x * k + sep.x * 0.8, z = dir.z * k + sep.z * 0.8;
  const l = Math.hypot(x, z);
  if (l < 1e-4) return;
  if (l > 1) {
    x /= l;
    z /= l;
  }
  intent.moveX = x;
  intent.moveZ = z;
}

/** Direction toward a target: straight when visible and close, else down the hero flow field / A*. */
function approach(sim: Sim, ch: Character, target: Character): P2 | null {
  const dx = target.pos.x - ch.pos.x, dz = target.pos.z - ch.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return null;
  if (d < 7 && sim.nav.lineFree(ch.pos, target.pos)) return { x: dx / d, z: dz / d };
  if (target.id === sim.heroId && ch.team !== 'hero') {
    const f = sim.flow.direction(ch.pos);
    if (f) return f;
  }
  if (!ch.ai.path.length || ch.ai.wait <= 0) {
    ch.ai.path = sim.nav.path(ch.pos, target.pos, 4000);
    ch.ai.wait = 0.5;
  }
  return sim.follow(ch, ch.ai.path) ?? { x: dx / d, z: dz / d };
}

export function thinkMonster(sim: Sim, ch: Character): CharacterInput {
  const intent = emptyInput();
  const ai = ch.ai;
  ai.modeTime += sim.dt;
  if (ai.wait > 0) ai.wait -= sim.dt;
  if (ch.state === 'dead' || ch.state === 'stun' || ch.state === 'hit' || ch.state === 'action') return intent;
  const arch = sim.archetypeOf(ch);
  const target = pickTarget(sim, ch);
  const owner = ch.owner ? sim.characters.get(ch.owner) ?? null : null;

  if (!ai.awake) {
    if (target && Math.hypot(target.pos.x - ch.pos.x, target.pos.z - ch.pos.z) <= arch.aggro && sees(sim, ch, target)) wake(sim, ch);
    else if (ch.since.hurt < 30) wake(sim, ch);
    else return intent;
  }
  const sep = separation(sim, ch);
  if (!target) {
    // Minions heel; monsters idle where they are.
    if (owner && Math.hypot(owner.pos.x - ch.pos.x, owner.pos.z - ch.pos.z) > 3) steer(intent, approach(sim, ch, owner), sep);
    return intent;
  }
  // Leash minions to their owner.
  if (owner && ch.team === 'hero') {
    const od = Math.hypot(owner.pos.x - ch.pos.x, owner.pos.z - ch.pos.z);
    if (od > 24) {
      const p = sim.nav.nearestFree({ x: owner.pos.x + 1, z: owner.pos.z + 1 });
      sim.teleport(ch.id, p.x, p.z);
      return intent;
    }
    if (od > 13) {
      steer(intent, approach(sim, ch, owner), sep);
      intent.gait = 'sprint';
      return intent;
    }
  }
  const dx = target.pos.x - ch.pos.x, dz = target.pos.z - ch.pos.z;
  const dist = Math.hypot(dx, dz);
  const reach = dist - target.radius;
  const m = ch.monster;

  // Boss phases.
  if (m?.boss) {
    const md = MONSTERS[m.def];
    const frac = ch.life / Math.max(1, ch.maxLife);
    // Phases split the life bar evenly (2 phases: 50%; 3 phases: 67% and 33%).
    const phases = Math.max(1, md.boss?.phases ?? 2);
    if (m.phase < phases && frac < 1 - m.phase / phases) {
      m.phase++;
      sim.emit('boss.phase', { id: ch.id, phase: m.phase, final: m.phase === phases });
      for (const k of Object.keys(ch.cooldowns)) ch.cooldowns[k] = 0;
      if (md.boss?.adds && md.minion) sim.summon(ch, md.minion, md.boss.adds, -1, { rarity: m.phase === phases ? 'magic' : 'normal' });
    }
    if (md.boss?.enrageAt && frac < md.boss.enrageAt && !ch.statuses.some((s) => s.id === 'enraged')) {
      addStatus(sim, ch, 'enraged', 9999, 1, ch.id);
      sim.emit('boss.enrage', { id: ch.id });
    }
  }

  // Decide on a skill.
  if (m) {
    m.thinkIn -= sim.dt;
    if (m.thinkIn <= 0) {
      m.thinkIn = arch.think * sim.rng.range(0.7, 1.3) * (m.boss && m.phase > 1 ? 0.7 : 1);
      const seen = sees(sim, ch, target);
      const options = m.skills.filter((id) => {
        if (blockedReason(sim, ch, id)) return false;
        const s = skillDef(id);
        if (s.effects.some((e) => e.type === 'summon')) {
          const mine = [...sim.characters.values()].filter((o) => o.owner === ch.id && o.state !== 'dead').length;
          return mine < (m.boss ? 6 : 4) && reach < 14;
        }
        if (s.effects.some((e) => e.type === 'heal')) {
          return [...sim.characters.values()].some((o) => o.team === ch.team && o.state !== 'dead' && o.life < o.maxLife * 0.7 && Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z) < 9);
        }
        if (s.effects.some((e) => e.type === 'buff' && e.target === 'allies')) {
          return [...sim.characters.values()].filter((o) => o.team === ch.team && o !== ch && o.state !== 'dead' && Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z) < 9).length >= 2 && reach < 12;
        }
        const melee = s.tags.includes('melee') && !s.motion;
        const range = s.range * (s.aim === 'self' ? 1 : 1) + (melee ? 0.2 : 0.8);
        if (reach > range) return false;
        if (!seen && s.aim !== 'self') return false;
        return true;
      });
      if (options.length) {
        // Cooldown skills are the big moves: prefer them when available.
        const id = sim.rng.weighted(options, (x) => (skillDef(x).cooldown ? 3 : 1));
        const s = skillDef(id);
        const lead = s.effects.some((e) => e.type === 'projectile') ? Math.min(0.6, dist / 12) : 0;
        const aim = { x: target.pos.x + target.vel.x * lead, z: target.pos.z + target.vel.z * lead };
        if (startSkill(sim, ch, id, aim)) {
          if (arch.retreat > 0) {
            ai.mode = 'retreat';
            ai.modeTime = -ch.action!.dur;
          }
          return intent;
        }
      }
    }
  }

  // Movement.
  intent.gait = 'run';
  if (arch.id === 'fleer') {
    const away0 = dist > 1e-3 ? { x: -dx / dist, z: -dz / dist } : { x: 1, z: 0 };
    steer(intent, safeDir(sim, ch, away0), sep);
    return intent;
  }
  const away = dist > 1e-3 ? { x: -dx / dist, z: -dz / dist } : { x: 1, z: 0 };
  const side = { x: -away.z * ai.strafeDir, z: away.x * ai.strafeDir };
  if (arch.flee && ch.life < ch.maxLife * arch.flee && ai.mode !== 'flee' && ch.since.hurt < 60) {
    ai.mode = 'flee';
    ai.modeTime = 0;
  }
  if (ai.mode === 'flee') {
    if (ai.modeTime > 2.5) ai.mode = 'chase';
    steer(intent, safeDir(sim, ch, away), sep);
    return intent;
  }
  if (ai.mode === 'retreat') {
    if (ai.modeTime > arch.retreat) ai.mode = 'chase';
    else if (ai.modeTime > 0) {
      steer(intent, safeDir(sim, ch, { x: away.x * 0.6 + side.x * 0.8, z: away.z * 0.6 + side.z * 0.8 }), sep);
      return intent;
    }
  }
  const melee = arch.keep <= 0.5;
  if (melee) {
    const stop = Math.max(0.6, Math.min(...(m?.skills ?? ['m_bite']).map((id) => skillDef(id).range)) - 0.35);
    if (reach > stop) steer(intent, approach(sim, ch, target), sep);
    else {
      sim.turnToward(ch, Math.atan2(dx, dz), 10);
      if (arch.strafe && sim.rng.chance(0.01)) ai.strafeDir *= -1;
    }
    return intent;
  }
  // Ranged: hold a band of distance, kite when pressed, circle otherwise.
  if (dist > arch.keep + 1.5 || !sees(sim, ch, target)) steer(intent, approach(sim, ch, target), sep);
  else if (dist < arch.kite) steer(intent, safeDir(sim, ch, away), sep);
  else if (arch.strafe) {
    if (sim.rng.chance(0.008)) ai.strafeDir *= -1;
    steer(intent, safeDir(sim, ch, side), sep, 0.55);
    intent.gait = 'walk';
  } else sim.turnToward(ch, Math.atan2(dx, dz), 8);
  if (intent.moveX === 0 && intent.moveZ === 0) sim.turnToward(ch, Math.atan2(dx, dz), 8);
  return intent;
}

/** A movement direction that doesn't run into a wall (tries rotating around the wish). */
function safeDir(sim: Sim, ch: Character, wish: P2): P2 | null {
  const l = Math.hypot(wish.x, wish.z);
  if (l < 1e-4) return null;
  const wx = wish.x / l, wz = wish.z / l;
  for (const ang of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const x = wx * c - wz * s, z = wx * s + wz * c;
    if (sim.nav.isFree({ x: ch.pos.x + x * 1.2, z: ch.pos.z + z * 1.2 })) return { x, z };
  }
  return null;
}
