/**
 * The bestiary: species designed in the Workshop (or by agents with `species.create`) as plain
 * data. A design is a body (plan or preset + seed + genome edits), a palette, a behaviour
 * archetype and up to three attack modules. Its numbers come from its parts, Spore-style:
 *
 *   bulk (length x girth x size, plates)   -> life (and slower legs)
 *   horns, spikes, tail weapons, pincers   -> damage
 *   legs, wings, size                      -> speed
 *
 * and a threat budget keeps any design fair: a huge, spiky, fast monster gets its life and damage
 * scaled back. Released designs join the encounter pools of the depths (deterministically), so the
 * player's creations populate the endless dungeon.
 */
import { Rng } from '../sim/rng';
import { ARCHETYPES, BOSS_MODULES, MONSTERS, PALETTES, PLAN_SPEED, registerMonster, type MonsterDef } from './monsters';
import { BODY_PLANS, CREATURE_PRESETS, generateGenome, PLAN_KIT, planOf, speciesName, type GenomeEdits } from './procgen/creature';
import { SKILLS } from './skills';

export interface SpeciesDesign {
  /** Short id (letters, digits, _ -); the monster is `custom:<id>`. */
  id: string;
  name: string;
  /** Creature body plan or preset. */
  body: string;
  seed: number;
  genome?: GenomeEdits;
  archetype: string;
  /** 1-3 monster attack modules (m_* skills). */
  skills: string[];
  palette: string;
  /** Overall scale, 0.6-1.8. */
  size: number;
  /** Joins the encounter pools of the depths. */
  released?: boolean;
}

export interface DesignStats {
  life: number;
  damage: number;
  speed: number;
  /** life x damage x speed, normalized: 1 = an ordinary monster. */
  threat: number;
  xp: number;
  notes: string[];
}

/** Attack modules a design may use (no boss-only or internal skills). */
export const DESIGN_SKILLS = Object.keys(SKILLS).filter((id) => id.startsWith('m_'));
/** Archetypes a design may use (bosses and minions are made by the game). */
export const DESIGN_ARCHETYPES = Object.keys(ARCHETYPES).filter((a) => a !== 'boss' && a !== 'minion' && a !== 'fleer');
export const DESIGN_BODIES = [...new Set([...CREATURE_PRESETS, ...BODY_PLANS])];
export const THREAT_BUDGET = 1.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function designStats(d: SpeciesDesign): DesignStats {
  const g = generateGenome(d.body, d.seed, d.genome);
  const plan = planOf(d.body);
  const size = clamp(d.size, 0.6, 1.8);
  const notes: string[] = [];
  const mass = size * size * (g.length / 1.2) * (g.girth / 0.28) * (g.plates ? 1.15 : 1);
  let life = clamp(0.55 + 0.45 * Math.pow(mass, 0.8), 0.5, 2.4);
  const weapons = 0.07 * Math.min(6, g.horns.count) + 0.02 * Math.min(16, g.spikes.count)
    + (['stinger', 'club', 'spikes'].includes(g.tail.tip) && g.tail.segments > 0 ? 0.1 : 0)
    + (g.arms?.pincer ? 0.12 : g.arms ? 0.06 : 0) + (g.head.jaw ? 0.05 : 0);
  let damage = clamp(0.9 + weapons, 0.6, 1.9);
  const legs = g.legs.pairs > 0 ? Math.pow(g.legs.length / 0.62, 0.4) * (g.legs.pairs >= 2 ? 1 : 0.85) : plan === 'serpent' || plan === 'floater' || plan === 'blob' ? 1 : 0.7;
  const speed = clamp(PLAN_SPEED[plan] * legs * (g.wings ? 1.08 : 1) / Math.pow(size, 0.35), 2, 7.5);
  if (mass > 1.6) notes.push('Heavy body: more life, slower.');
  if (weapons > 0.3) notes.push('Well armed: horns, spikes and claws add damage.');
  if (speed > 5.5) notes.push('Fast: long legs or wings.');
  if (g.legs.pairs === 0 && plan !== 'serpent' && plan !== 'floater' && plan !== 'blob') notes.push('No legs: it drags itself along.');
  let threat = life * damage * Math.sqrt(speed / 4.2);
  if (threat > THREAT_BUDGET) {
    const k = Math.sqrt(THREAT_BUDGET / threat);
    life *= k;
    damage *= k;
    threat = THREAT_BUDGET;
    notes.push('Over the threat budget: life and damage scaled back to stay fair.');
  }
  const xp = clamp(0.8 + 0.4 * (threat - 1), 0.7, 1.4);
  return { life: r2(life), damage: r2(damage), speed: r2(speed), threat: r2(threat), xp: r2(xp), notes };
}

export function monsterId(d: SpeciesDesign, boss = false): string {
  return `custom:${d.id}${boss ? '-boss' : ''}`;
}

/** The monster definition a design stands for (and its boss variant). */
export function designToMonster(d: SpeciesDesign, boss = false): MonsterDef {
  const s = designStats(d);
  const plan = planOf(d.body);
  const skills = d.skills.filter((k) => DESIGN_SKILLS.includes(k)).slice(0, 3);
  if (!skills.length) skills.push(PLAN_KIT[plan].skills[0]);
  return {
    id: monsterId(d, boss), name: boss ? `${d.name} Matriarch` : d.name, family: 'bestiary',
    body: { kind: 'creature', plan: d.body, seed: d.seed, genome: d.genome },
    archetype: boss ? 'boss' : d.archetype, skills: boss ? [...new Set([...skills, ...BOSS_MODULES[plan]])] : skills,
    life: s.life * (boss ? 1.3 : 1), damage: s.damage, speed: s.speed, size: clamp(d.size, 0.6, 1.8) * (boss ? 2.2 : 1), xp: s.xp,
    palette: d.palette, boss: boss ? { title: 'A Workshop Creation', phases: 2, enrageAt: 0.35 } : undefined,
    minion: skills.includes('m_summon') || boss ? monsterId(d) : undefined,
  };
}

/** Registers a design (and its boss variant) so it can spawn anywhere. */
export function registerDesign(d: SpeciesDesign): MonsterDef {
  const def = registerMonster(designToMonster(d));
  registerMonster(designToMonster(d, true));
  return def;
}

/** Checks a design's references; returns a list of problems (empty = valid). */
export function designProblems(d: SpeciesDesign): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9_-]{1,32}$/.test(d.id)) out.push('id must be 1-32 letters, digits, _ or -');
  if (!DESIGN_BODIES.includes(d.body)) out.push(`unknown body "${d.body}"`);
  if (!DESIGN_ARCHETYPES.includes(d.archetype)) out.push(`unknown archetype "${d.archetype}"`);
  if (!PALETTES[d.palette]) out.push(`unknown palette "${d.palette}"`);
  for (const k of d.skills) if (!DESIGN_SKILLS.includes(k)) out.push(`unknown attack "${k}"`);
  if (d.skills.length > 3) out.push('at most three attacks');
  try {
    generateGenome(d.body, d.seed, d.genome);
  } catch (e) {
    out.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}

/** A fresh random species (the Workshop's dice button). */
export function randomDesign(seed: number, body?: string): SpeciesDesign {
  const r = new Rng(seed * 2246822519 + 3);
  const b = body ?? r.pick(DESIGN_BODIES.filter((x) => x !== 'spore'));
  const plan = planOf(b);
  const kit = PLAN_KIT[plan];
  const g = generateGenome(b, seed);
  const genome: GenomeEdits = {};
  if (r.chance(0.5)) genome.horns = { count: r.int(0, 4) };
  if (r.chance(0.35)) genome.spikes = { count: r.int(0, 10) };
  if (r.chance(0.25) && !g.wings && plan !== 'serpent') genome.wings = { span: r.range(1, 2.4) };
  if (r.chance(0.3)) genome.length = r2(g.length * r.range(0.8, 1.35));
  if (r.chance(0.3)) genome.girth = r2(g.girth * r.range(0.85, 1.3));
  const skills = [kit.skills[0]];
  if (r.chance(0.7)) skills.push(r.pick(kit.skills.slice(1).length ? kit.skills.slice(1) : kit.skills));
  if (r.chance(0.2)) skills.push(r.pick(DESIGN_SKILLS));
  return {
    id: `s${(seed >>> 0).toString(36)}`, name: speciesName(plan, seed), body: b, seed, genome,
    archetype: r.pick(kit.archetypes.filter((a) => DESIGN_ARCHETYPES.includes(a))), skills: [...new Set(skills)].slice(0, 3),
    palette: r.pick(Object.keys(PALETTES)), size: r2(r.range(0.8, 1.3)),
  };
}

// ---------------------------------------------------------------- released into the depths

let released: string[] = [];

/** Sets which designs (monster ids) roam the depths; called when the bestiary loads or changes. */
export function setReleased(designs: readonly SpeciesDesign[]) {
  released = designs.filter((d) => d.released && MONSTERS[monsterId(d)]).map((d) => monsterId(d)).sort();
}

export function releasedSpecies(): readonly string[] {
  return released;
}
