/**
 * Damage pipeline: roll a hit from the attacker's stats (weapon or skill base, added damage,
 * conversions, increased/more by tag context, crits, ailment chances), then mitigate it on the
 * target (evasion, block, armour, resistances, shock, damage taken), apply ailments, stagger,
 * knockback, leech and kills. Statuses (ailments and buffs) tick here too.
 *
 * Everything reads stats through tag contexts, so a tree node "+40% damage with Fireball" or a
 * shrine "60% more damage" or a monster affix all flow through the same code.
 */
import { config } from '../config';
import type { Team } from '../content/level';
import { MONSTER_AFFIXES, RARITY_SCALING } from '../content/monsters';
import type { HitSpec, SkillDef } from '../content/skills';
import { statusDef } from '../content/statuses';
import { ADDED_STAT, DAMAGE_TYPES, ELEMENTS, type DamageType, type Tag } from '../content/stats';
import { fieldAt } from './props';
import { armorReduction, evadeChance, monsterDamage, spellDamage } from './scaling';
import type { Sim } from './sim';
import type { Character, Packet } from './types';

export function hostile(a: Team | string, b: Team | string): boolean {
  if (a === b) return false;
  if (a === 'neutral' || b === 'neutral') return false;
  if (a === 'target') return false;
  if (b === 'target') return a === 'hero';
  return true;
}

export const SECOND = 60;

/** Function form so TypeScript doesn't narrow away deaths that happen mid-function. */
export const isDead = (c: Character) => c.state === 'dead';

/** Condition tags of a character right now (low life, moving, recently killed...). */
export function condTags(sim: Sim, ch: Character): Tag[] {
  const out: Tag[] = [];
  const st = sim.stats(ch);
  const pct = ch.maxLife > 0 ? (ch.life / ch.maxLife) * 100 : 100;
  if (pct <= st.get('lowLifeThreshold')) out.push('cond:lowLife');
  if (pct >= 99.9) out.push('cond:fullLife');
  out.push(ch.speed > 0.6 ? 'cond:moving' : 'cond:stationary');
  if (ch.since.kill < 4 * SECOND) out.push('cond:recentKill');
  if (ch.since.dodge < 2 * SECOND) out.push('cond:recentDodge');
  if (ch.statuses.some((s) => ['frenzy', 'power', 'haste', 'fortune', 'conduit'].includes(s.id))) out.push('cond:shrine');
  return out;
}

export function vsTags(t: Character): Tag[] {
  const out: Tag[] = [];
  for (const s of t.statuses) {
    if (s.id === 'ignite') out.push('vs:burning');
    else if (s.id === 'chill' || s.id === 'freeze') out.push('vs:chilled');
    else if (s.id === 'shock') out.push('vs:shocked');
    else if (s.id === 'poison') out.push('vs:poisoned');
    else if (s.id === 'bleed') out.push('vs:bleeding');
  }
  if (t.monster?.boss) out.push('vs:boss');
  if (t.monster && t.monster.rarity !== 'normal') out.push('vs:elite');
  return out;
}

export function skillTags(skill: SkillDef): Tag[] {
  return [...skill.tags, `skill:${skill.id}` as Tag];
}

/** Damage-type tag set for "increased X damage" lookups. */
function typeTags(t: DamageType): Tag[] {
  return ELEMENTS.includes(t) ? [t, 'elemental'] : [t];
}

const tune = (k: 'tune.playerDamage' | 'tune.enemyDamage' | 'tune.playerLife' | 'tune.enemyLife' | 'tune.playerSpeed' | 'tune.enemySpeed') => config[k];

/** Is this character on the hero's side (hero or a hero minion)? */
const heroSide = (ch: Character) => ch.team === 'hero';

/** Rolls a hit for `attacker` using `skill`, optionally aware of the target (vs: conditions). */
export function rollPacket(sim: Sim, a: Character, skill: SkillDef, hit: HitSpec | undefined, target: Character | null, extraMult = 1, rng: { next(): number } = sim.rng, forceNoCrit = false): Packet {
  const st = sim.stats(a);
  const owner = a.owner ? sim.characters.get(a.owner) : null;
  const tags: Tag[] = [...skillTags(skill), ...condTags(sim, a), ...(target ? vsTags(target) : [])];
  if (a.owner) tags.push('minion');
  const isAttack = skill.kind === 'attack';
  const mult = (hit?.mult ?? 1) * extraMult;
  const ranges: Partial<Record<DamageType, [number, number]>> = {};
  const addRange = (t: DamageType, lo: number, hi: number) => {
    const p = ranges[t] ?? [0, 0];
    ranges[t] = [p[0] + lo, p[1] + hi];
  };
  const build = a.id === sim.heroId ? sim.heroBuild : null;
  let effectiveness = 1;
  if (build && isAttack && skill.weapon !== undefined) {
    effectiveness = skill.weapon / 100;
    for (const [t, r] of Object.entries(build.weapon.dmg) as Array<[DamageType, [number, number]]>) addRange(t, r[0] * effectiveness, r[1] * effectiveness);
  } else if (skill.base) {
    const k = a.monster || a.owner ? monsterDamage(a.level) * (a.monster ? sim.monsterDamageMult(a) : 1) : spellDamage(a.level);
    for (const [t, r] of Object.entries(skill.base) as Array<[DamageType, readonly [number, number]]>) addRange(t, r[0] * k, r[1] * k);
  } else if (isAttack) {
    const k = a.monster || a.owner ? monsterDamage(a.level) * (a.monster ? sim.monsterDamageMult(a) : 1) : 1;
    addRange('physical', 2 * k, 4 * k);
  }
  // Added damage ("Adds 3 to 7 Fire Damage to Attacks").
  for (const t of DAMAGE_TYPES) {
    const [lo, hi] = st.range(ADDED_STAT[t], tags);
    if (lo || hi) addRange(t, lo * effectiveness, hi * effectiveness);
  }
  // Conversions: monster palettes, hero keystones and uniques.
  const convert = (from: DamageType, to: DamageType, frac: number) => {
    const r = ranges[from];
    if (!r || frac <= 0) return;
    const f = Math.min(1, frac);
    addRange(to, r[0] * f, r[1] * f);
    ranges[from] = [r[0] * (1 - f), r[1] * (1 - f)];
  };
  if (a.monster?.element && a.monster.element !== 'physical') {
    if (skill.usesElement) {
      for (const t of DAMAGE_TYPES) if (t !== a.monster.element) convert(t, a.monster.element, 1);
    } else if (skill.elemental) convert('physical', a.monster.element, skill.elemental);
  }
  const toFire = st.get('physToFire') / 100, toCold = st.get('physToCold') / 100, toLight = st.get('physToLightning') / 100;
  const total = toFire + toCold + toLight;
  if (total > 0) {
    const norm = total > 1 ? 1 / total : 1;
    const phys = ranges.physical ? [...ranges.physical] as [number, number] : null;
    if (phys) {
      const share = (f: number) => [phys[0] * f * norm, phys[1] * f * norm] as const;
      if (toFire) addRange('fire', ...share(toFire));
      if (toCold) addRange('cold', ...share(toCold));
      if (toLight) addRange('lightning', ...share(toLight));
      ranges.physical = [phys[0] * (1 - total * norm), phys[1] * (1 - total * norm)];
    }
  }
  const eleToChaos = st.get('elementalToChaos') / 100;
  if (eleToChaos > 0) for (const t of ELEMENTS) convert(t, 'chaos', eleToChaos);

  const tuneMult = heroSide(a) ? tune('tune.playerDamage') : tune('tune.enemyDamage');
  const minionMult = a.owner && owner ? owner && sim.stats(owner).scale('minionDamage') : 1;
  const dmg: Partial<Record<DamageType, number>> = {};
  for (const t of DAMAGE_TYPES) {
    const r = ranges[t];
    if (!r || r[1] <= 0) continue;
    const roll = r[0] + rng.next() * (r[1] - r[0]);
    dmg[t] = roll * st.scale('damage', [...tags, ...typeTags(t)]) * mult * tuneMult * minionMult;
  }
  // Crits.
  let crit = false;
  if (!st.has('noCrit') && mult > 0 && !forceNoCrit) {
    const baseCrit = build && isAttack ? build.weapon.crit : skill.kind === 'spell' ? 6 : 5;
    const chance = (baseCrit + st.flat('critChance', tags)) * st.scale('critChance', tags);
    if (rng.next() * 100 < Math.min(95, chance)) {
      crit = true;
      const multi = st.get('critMulti', tags) / 100;
      for (const t of Object.keys(dmg) as DamageType[]) dmg[t]! *= multi;
    }
  }
  const ail = hit?.ailments ?? {};
  const chance = (id: 'ignite' | 'freeze' | 'shock' | 'poison' | 'bleed', stat: 'igniteChance' | 'freezeChance' | 'shockChance' | 'poisonChance' | 'bleedChance') =>
    (ail[id] ?? 0) + st.get(stat, tags);
  return {
    attacker: a.id, team: a.team, level: a.level, skill: skill.id, tags, dmg, crit,
    ailments: {
      ignite: chance('ignite', 'igniteChance'), freeze: chance('freeze', 'freezeChance'), shock: chance('shock', 'shockChance'),
      poison: chance('poison', 'poisonChance'), bleed: chance('bleed', 'bleedChance'), chill: ail.chill ?? 100,
    },
    knock: (hit?.knock ?? 0) * (st.get('knockback', tags) / 100),
    stagger: (hit?.stagger ?? 20) * (st.get('stagger', tags) / 100) * (crit ? 1.5 : 1),
    heavy: !!hit?.heavy || crit,
    pull: hit?.pull ?? 0,
    isAttack,
    penetration: st.get('penetration', tags),
    alwaysHit: st.has('alwaysHit'),
    leech: st.get('lifeLeech', tags),
    manaLeech: st.get('manaLeech', tags),
    lifeOnHit: st.get('lifeOnHit', tags),
    manaOnHit: st.get('manaOnHit', tags) + (skill.id.startsWith('slash') ? 3 : 0),
    ailmentEffect: st.get('ailmentEffect', tags) / 100,
    ailmentDuration: st.get('ailmentDuration', tags) / 100,
  };
}

export interface HitResult {
  amount: number;
  killed: boolean;
  evaded: boolean;
  blocked: boolean;
  byType: Partial<Record<DamageType, number>>;
}

const RES: Record<DamageType, 'resFire' | 'resCold' | 'resLightning' | 'resChaos' | null> = {
  physical: null, fire: 'resFire', cold: 'resCold', lightning: 'resLightning', chaos: 'resChaos',
};

/** Hero-side or boss poise threshold vs normal monsters (everything small flinches on every hit). */
function poiseThreshold(sim: Sim, t: Character): number {
  const st = sim.stats(t);
  const base = t.monster ? 25 * sim.archetypeOf(t).poise * RARITY_SCALING[t.monster.rarity].life ** 0.5 : 140;
  return base * (st.get('stunThreshold') / 100);
}

/** Applies a rolled packet to a target. `fromX/fromZ` is where the hit came from (knockback). */
export function applyPacket(sim: Sim, t: Character, p: Packet, fromX: number, fromZ: number): HitResult | null {
  if (t.state === 'dead' || t.iframes > 0) return null;
  const st = sim.stats(t);
  const attacker = sim.characters.get(p.attacker) ?? null;
  const res: HitResult = { amount: 0, killed: false, evaded: false, blocked: false, byType: {} };
  // Shielding affix: invulnerable bubble.
  if (t.statuses.some((s) => s.id === 'shielded')) {
    sim.emit('immune', { target: t.id, x: t.pos.x, z: t.pos.z });
    return null;
  }
  if (p.isAttack && !p.alwaysHit && sim.rng.next() < evadeChance(st.get('evasion'), p.level)) {
    res.evaded = true;
    sim.emit('evade', { attacker: p.attacker, target: t.id, x: t.pos.x, z: t.pos.z });
    return res;
  }
  const blockChance = t.id === sim.heroId && sim.heroBuild?.blocking ? st.get('block') : t.monster ? 0 : 0;
  if (blockChance > 0 && sim.rng.next() * 100 < blockChance) {
    res.blocked = true;
    sim.emit('block', { attacker: p.attacker, target: t.id, x: t.pos.x, z: t.pos.z });
    return res;
  }
  const shock = t.statuses.find((s) => s.id === 'shock');
  const taken = (st.get('damageTaken') / 100) * (shock ? 1 + shock.magnitude / 100 : 1);
  let total = 0;
  for (const type of DAMAGE_TYPES) {
    let d = p.dmg[type] ?? 0;
    if (d <= 0) continue;
    if (type === 'physical') d *= 1 - armorReduction(st.get('armor'), d);
    else if (type === 'chaos' && st.has('chaosImmune')) d = 0;
    else {
      const r = st.get(RES[type]!) - p.penetration;
      d *= 1 - Math.min(75, r) / 100;
    }
    d *= taken;
    res.byType[type] = d;
    total += d;
  }
  res.amount = total;
  if (total > 0) {
    t.life -= total;
    t.flash = 6;
    t.since.hurt = 0;
  }
  // Thorns affix: reflect a slice of melee damage.
  // Thorns reflect part of a melee hit, bounded by the monster's own strength and the attacker's
  // life: reflect that scaled with the hero's damage one-shot strong heroes (bot runs, depth 80).
  if (attacker && t.monster?.affixes.includes('thorns') && p.tags.includes('melee') && total > 0) {
    const cap = Math.min(6 * monsterDamage(t.level) * sim.monsterDamageMult(t), attacker.maxLife * 0.1);
    damageRaw(sim, attacker, Math.min(total * 0.15, cap), 'physical', t.id);
  }
  // Leech / on-hit recovery for the attacker.
  if (attacker && attacker.state !== 'dead' && total > 0) {
    const ast = sim.stats(attacker);
    let heal = p.lifeOnHit + (total * p.leech) / 100;
    if (!ast.has('instantLeech')) {
      // Leech is rate-limited by a budget that refills at 20% of maximum life per second.
      heal = Math.min(heal, Math.max(0, attacker.regen.leechBudget));
      attacker.regen.leechBudget -= heal;
    }
    attacker.life = Math.min(attacker.maxLife, attacker.life + heal);
    attacker.mana = Math.min(attacker.maxMana, attacker.mana + p.manaOnHit + (total * p.manaLeech) / 100);
  }
  // Ailments.
  if (total > 0) applyAilments(sim, t, p, res);
  // Stagger and knockback.
  const dx = t.pos.x - fromX, dz = t.pos.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  const heavyMass = Math.max(1, t.scale * t.scale) * (t.monster?.boss ? 6 : 1) / (sim.hasFields ? fieldAt(sim, t.pos.x, t.pos.z).knockMult : 1);
  if (p.pull) {
    t.knock = { x: (-dx / d) * p.pull / heavyMass, z: (-dz / d) * p.pull / heavyMass };
  }
  if (t.life > 0) {
    t.poise += p.stagger;
    const immune = st.has('cannotBeStunned') || t.statuses.some((s) => s.id === 'freeze');
    const threshold = poiseThreshold(sim, t);
    const flinch = !immune && (t.monster ? (p.heavy && !t.monster.boss) || t.poise >= threshold : p.heavy && t.poise >= threshold * 0.5);
    if (flinch || p.knock > 0) {
      const k = p.knock / heavyMass;
      t.knock = { x: (dx / d) * k, z: (dz / d) * k };
    }
    if (flinch) {
      t.poise = 0;
      sim.flinch(t, p.heavy);
    }
  }
  sim.emit('hit', {
    attacker: p.attacker, target: t.id, damage: Math.round(total * 10) / 10, hp: Math.max(0, Math.round(t.life * 10) / 10),
    crit: p.crit, heavy: p.heavy, dmgType: dominantType(res.byType), x: t.pos.x, z: t.pos.z, skill: p.skill,
  });
  if (t.life <= 0) {
    res.killed = true;
    sim.kill(t, attacker, false, p.skill === 'env');
  }
  return res;
}

function dominantType(by: Partial<Record<DamageType, number>>): DamageType {
  let best: DamageType = 'physical', v = -1;
  for (const [k, x] of Object.entries(by) as Array<[DamageType, number]>) if (x > v) {
    v = x;
    best = k;
  }
  return best;
}

/** Direct damage that bypasses hit rules (DoTs, reflect, mechanics). Applies resistances. */
export function damageRaw(sim: Sim, t: Character, amount: number, type: DamageType, source: string, opts: { resist?: boolean; quiet?: boolean } = {}): number {
  if (t.state === 'dead' || amount <= 0) return 0;
  const st = sim.stats(t);
  let d = amount;
  if (opts.resist !== false) {
    if (type === 'chaos' && st.has('chaosImmune')) d = 0;
    else if (type !== 'physical') d *= 1 - Math.min(75, st.get(RES[type]!)) / 100;
  }
  d *= st.get('damageTaken') / 100;
  t.life -= d;
  t.since.hurt = 0;
  if (!opts.quiet) sim.emit('dot', { target: t.id, damage: Math.round(d * 10) / 10, dmgType: type, source });
  if (t.life <= 0) sim.kill(t, sim.characters.get(source) ?? null);
  return d;
}

function applyAilments(sim: Sim, t: Character, p: Packet, res: HitResult) {
  const st = sim.stats(t);
  const life = Math.max(1, t.maxLife);
  const dur = p.ailmentDuration;
  const eff = p.ailmentEffect;
  const roll = (c: number | undefined) => (c ?? 0) > 0 && sim.rng.next() * 100 < (c ?? 0);
  const fire = res.byType.fire ?? 0, cold = res.byType.cold ?? 0, light = res.byType.lightning ?? 0;
  const phys = res.byType.physical ?? 0, chaos = res.byType.chaos ?? 0;
  if (fire > 0 && roll(p.ailments.ignite)) addStatus(sim, t, 'ignite', 4 * dur, ((fire * 0.8) / 4) * eff, p.attacker);
  if (cold > 0 && roll(p.ailments.chill)) addStatus(sim, t, 'chill', 2 * dur, Math.min(40, 12 + (60 * cold) / life) * eff, p.attacker);
  if (cold > 0 && roll(p.ailments.freeze) && !st.has('cannotBeFrozen')) {
    const d = Math.min(1.5, 0.35 + (2.5 * cold) / life) * (t.monster?.boss ? 0.3 : 1) * dur;
    addStatus(sim, t, 'freeze', d, 1, p.attacker);
  }
  if (light > 0 && roll(p.ailments.shock)) addStatus(sim, t, 'shock', 3 * dur, Math.min(50, 12 + (50 * light) / life) * eff, p.attacker);
  if (phys + chaos > 0 && roll(p.ailments.poison)) addStatus(sim, t, 'poison', 2 * dur, ((phys + chaos) * 0.3 / 2) * eff, p.attacker);
  if (phys > 0 && roll(p.ailments.bleed)) addStatus(sim, t, 'bleed', 5 * dur, ((phys * 0.7) / 5) * eff, p.attacker);
}

export function addStatus(sim: Sim, t: Character, id: string, duration: number, magnitude: number, source: string) {
  if (t.state === 'dead' || duration <= 0) return;
  const def = statusDef(id);
  if (def.stacking === 'stack') {
    const stacks = t.statuses.filter((s) => s.id === id);
    if (stacks.length >= (def.maxStacks ?? 20)) {
      const weakest = stacks.reduce((a, b) => (a.magnitude * a.time <= b.magnitude * b.time ? a : b));
      t.statuses.splice(t.statuses.indexOf(weakest), 1);
    }
    t.statuses.push({ id, time: duration, duration, magnitude, source, stacks: 1 });
  } else {
    const cur = t.statuses.find((s) => s.id === id);
    if (cur) {
      if (magnitude >= cur.magnitude || cur.time < duration * 0.5) {
        cur.magnitude = Math.max(cur.magnitude, magnitude);
        cur.time = Math.max(cur.time, duration);
        cur.duration = Math.max(cur.duration, duration);
        cur.source = source;
      }
    } else t.statuses.push({ id, time: duration, duration, magnitude, source, stacks: 1 });
  }
  if (def.mods) t.statsVersion++;
  if (def.stun && !isDead(t)) sim.stun(t, id);
  sim.emit('status', { target: t.id, status: id, duration: Math.round(duration * 100) / 100 });
}

/** Per-frame status upkeep: durations, damage over time, regen. */
export function tickStatuses(sim: Sim, ch: Character) {
  const dt = sim.dt;
  if (ch.state === 'dead') return;
  let changed = false;
  let dotFire = 0, dotChaos = 0, dotPhys = 0;
  const moving = ch.speed > 0.6;
  for (const s of ch.statuses) {
    s.time -= dt;
    const def = statusDef(s.id);
    if (def.heal === 'life') ch.life = Math.min(ch.maxLife, ch.life + (ch.maxLife * s.magnitude * dt) / 100);
    else if (def.heal === 'mana') ch.mana = Math.min(ch.maxMana, ch.mana + (ch.maxMana * s.magnitude * dt) / 100);
    if (def.dot) {
      const dps = s.magnitude * (def.movingMult && moving ? def.movingMult : 1);
      if (def.dot === 'fire') dotFire += dps;
      else if (def.dot === 'chaos') dotChaos += dps;
      else dotPhys += dps;
    }
  }
  const expired = ch.statuses.filter((s) => s.time <= 0);
  if (expired.length) {
    ch.statuses = ch.statuses.filter((s) => s.time > 0);
    for (const s of expired) if (statusDef(s.id).mods) changed = true;
    if (expired.some((s) => statusDef(s.id).stun) && ch.state === 'stun' && !ch.statuses.some((s) => statusDef(s.id).stun)) sim.unstun(ch);
  }
  if (changed) ch.statsVersion++;
  // DoTs tick every frame but report twice a second (damage numbers).
  const src = ch.statuses.find((s) => statusDef(s.id).dot)?.source ?? ch.id;
  const report = sim.frame % 30 === 0;
  if (dotFire) damageRaw(sim, ch, dotFire * dt, 'fire', src, { quiet: !report });
  if (dotChaos && !isDead(ch)) damageRaw(sim, ch, dotChaos * dt, 'chaos', src, { quiet: !report });
  if (dotPhys && !isDead(ch)) damageRaw(sim, ch, dotPhys * dt, 'physical', src, { quiet: !report, resist: false });
  if (isDead(ch)) return;
  // Regeneration and leech budget.
  const st = sim.stats(ch);
  const regen = st.get('lifeRegen') + (st.get('lifeRegenPct') / 100) * ch.maxLife;
  if (regen > 0 && ch.life < ch.maxLife) ch.life = Math.min(ch.maxLife, ch.life + regen * dt);
  const manaRegen = st.get('manaRegen');
  if (ch.mana < ch.maxMana) ch.mana = Math.min(ch.maxMana, ch.mana + manaRegen * dt);
  ch.regen.leechBudget = Math.min(ch.maxLife * 0.25, ch.regen.leechBudget + ch.maxLife * 0.2 * dt);
  ch.poise = Math.max(0, ch.poise - (ch.monster ? 40 : 80) * dt);
}

/** Monster affix mods merged with the base (used when spawning). */
export function affixMods(ids: readonly string[]) {
  return ids.flatMap((id) => MONSTER_AFFIXES[id]?.mods ?? []);
}

/**
 * Average damage of a skill's main hit for the character sheet and agent balance tools. Never
 * touches the sim RNG (rolls at the middle of every range; crits as an expectation).
 */
export function estimateSkill(sim: Sim, a: Character, skill: SkillDef): { hit: number; critChance: number; critMulti: number; perSecond: number; byType: Partial<Record<DamageType, number>> } {
  const st = sim.stats(a);
  const tags = skillTags(skill);
  // The first damaging hit (telegraph strikes with mult 0 only mark the ground).
  const firstHit = skill.effects.find((e) => 'hit' in e && e.hit && (e.hit.mult ?? 1) > 0) as { hit?: HitSpec } | undefined;
  // Mid-range rolls with crits forced off; crits are added back as an expectation below.
  const base = rollPacket(sim, a, skill, firstHit?.hit, null, 1, { next: () => 0.5 }, true);
  let hit = 0;
  for (const v of Object.values(base.dmg)) hit += v ?? 0;
  const build = a.id === sim.heroId ? sim.heroBuild : null;
  const baseCrit = build && skill.kind === 'attack' ? build.weapon.crit : skill.kind === 'spell' ? 6 : 5;
  const critChance = st.has('noCrit') ? 0 : Math.min(95, (baseCrit + st.flat('critChance', tags)) * st.scale('critChance', tags));
  const critMulti = st.get('critMulti', tags) / 100;
  const avg = hit * (1 + (critChance / 100) * (critMulti - 1));
  const speed = skill.kind === 'attack' ? (st.get('attackSpeed', tags) / 100) * (build && !skill.id.startsWith('m_') ? build.weapon.speed : 1) : skill.kind === 'spell' ? st.get('castSpeed', tags) / 100 : 1;
  const perSecond = skill.time > 0 ? (avg * speed) / skill.time : avg;
  return { hit: avg, critChance, critMulti, perSecond, byType: base.dmg };
}
