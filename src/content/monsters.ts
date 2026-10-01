/**
 * Monsters as composable data. A monster = body (humanoid preset or procedural creature genome)
 * + behaviour archetype + attack modules (skills) + color palette (element) + rarity + affixes.
 * Every axis is independent, so the endless generator (content/procgen/encounters.ts) can
 * combine them freely, and agents can list and preview each axis on its own.
 */
import { Rng } from '../sim/rng';
import { PRESETS } from './characters';
import { BODY_PLANS, CREATURE_PRESETS, PLAN_KIT, planOf, speciesName, type BodyPlan, type GenomeEdits } from './procgen/creature';
import type { DamageType, Mod } from './stats';
import { SKILLS } from './skills';
import { mod } from './stats';

// ---------------------------------------------------------------- behaviour archetypes

export interface Archetype {
  id: string;
  label: string;
  /** Notices the hero within this range (with line of sight), m. */
  aggro: number;
  /** Preferred distance to the target (0 = melee). */
  keep: number;
  /** Backs away when the target is closer than this. */
  kite: number;
  /** Seconds of backing off / circling after an attack (hit and run). */
  retreat: number;
  /** Circles the target while waiting for cooldowns. */
  strafe: boolean;
  speed: number;
  life: number;
  damage: number;
  /** Stagger resistance multiplier. */
  poise: number;
  pack: [number, number];
  /** Seconds between attack decisions. */
  think: number;
  /** Life fraction under which it flees for a moment. */
  flee?: number;
}

export const ARCHETYPES: Record<string, Archetype> = {
  brute: { id: 'brute', label: 'Brute', aggro: 9, keep: 0, kite: 0, retreat: 0, strafe: false, speed: 0.82, life: 1.7, damage: 1.35, poise: 2.5, pack: [1, 3], think: 0.6 },
  skirmisher: { id: 'skirmisher', label: 'Skirmisher', aggro: 11, keep: 0, kite: 0, retreat: 0.9, strafe: true, speed: 1.12, life: 0.9, damage: 1, poise: 1, pack: [3, 5], think: 0.35 },
  swarmer: { id: 'swarmer', label: 'Swarmer', aggro: 12, keep: 0, kite: 0, retreat: 0, strafe: false, speed: 1.2, life: 0.45, damage: 0.6, poise: 0.4, pack: [5, 9], think: 0.3 },
  archer: { id: 'archer', label: 'Marksman', aggro: 13, keep: 7, kite: 4, retreat: 0, strafe: true, speed: 1, life: 0.75, damage: 0.95, poise: 0.8, pack: [2, 4], think: 0.5, flee: 0.25 },
  caster: { id: 'caster', label: 'Caster', aggro: 13, keep: 6.5, kite: 3.5, retreat: 0, strafe: true, speed: 0.95, life: 0.75, damage: 1.15, poise: 0.8, pack: [1, 3], think: 0.6 },
  charger: { id: 'charger', label: 'Charger', aggro: 13, keep: 0, kite: 0, retreat: 0.4, strafe: false, speed: 1.05, life: 1.25, damage: 1.2, poise: 1.6, pack: [1, 3], think: 0.5 },
  bomber: { id: 'bomber', label: 'Bomber', aggro: 11, keep: 0, kite: 0, retreat: 0, strafe: false, speed: 1.35, life: 0.4, damage: 1, poise: 0.3, pack: [3, 6], think: 0.2 },
  summoner: { id: 'summoner', label: 'Summoner', aggro: 13, keep: 8, kite: 5, retreat: 0, strafe: true, speed: 0.95, life: 0.9, damage: 0.9, poise: 0.8, pack: [1, 2], think: 0.8, flee: 0.3 },
  guardian: { id: 'guardian', label: 'Guardian', aggro: 10, keep: 2.5, kite: 0, retreat: 0, strafe: false, speed: 0.9, life: 1.4, damage: 0.9, poise: 2, pack: [1, 2], think: 0.7 },
  stalker: { id: 'stalker', label: 'Stalker', aggro: 14, keep: 0, kite: 0, retreat: 1.4, strafe: true, speed: 1.3, life: 0.8, damage: 1.25, poise: 0.7, pack: [2, 3], think: 0.4 },
  boss: { id: 'boss', label: 'Boss', aggro: 16, keep: 0, kite: 0, retreat: 0, strafe: true, speed: 0.95, life: 1, damage: 1, poise: 12, pack: [1, 1], think: 0.45 },
  fleer: { id: 'fleer', label: 'Fleer', aggro: 9, keep: 99, kite: 99, retreat: 0, strafe: false, speed: 1, life: 1, damage: 0, poise: 0.5, pack: [1, 1], think: 0.3 },
  minion: { id: 'minion', label: 'Minion', aggro: 16, keep: 0, kite: 0, retreat: 0, strafe: false, speed: 1.2, life: 0.5, damage: 0.7, poise: 0.5, pack: [1, 1], think: 0.3 },
};

// ---------------------------------------------------------------- color palettes (element)

export interface MonsterPalette {
  id: string;
  name: string;
  /** Damage type its elemental attacks deal; null = physical. */
  element: DamageType | null;
  primary: string;
  secondary: string;
  accent: string;
  /** Eye / joint / ember glow; also the color of its point light, if any. */
  glow: string;
  resist: Partial<Record<DamageType, number>>;
  /** Name prefix in the endless generator. */
  word: string;
}

export const PALETTES: Record<string, MonsterPalette> = {
  bone: { id: 'bone', name: 'Bone', element: null, primary: '#d8cfb6', secondary: '#7c6a55', accent: '#3b302a', glow: '#ffe3a3', resist: { chaos: 20 }, word: 'Bleached' },
  ember: { id: 'ember', name: 'Ember', element: 'fire', primary: '#5a2a22', secondary: '#c4441f', accent: '#1f1210', glow: '#ff9a3d', resist: { fire: 60, cold: -20 }, word: 'Smouldering' },
  frost: { id: 'frost', name: 'Frost', element: 'cold', primary: '#bfe3f2', secondary: '#4a7fa8', accent: '#1d3149', glow: '#8fd8ff', resist: { cold: 60, fire: -20 }, word: 'Rimed' },
  storm: { id: 'storm', name: 'Storm', element: 'lightning', primary: '#3c3a5c', secondary: '#9a8cff', accent: '#15142a', glow: '#ffe95c', resist: { lightning: 60 }, word: 'Crackling' },
  venom: { id: 'venom', name: 'Venom', element: 'chaos', primary: '#4f6b2a', secondary: '#a6d94a', accent: '#1d2a10', glow: '#8fe36a', resist: { chaos: 60 }, word: 'Festering' },
  void: { id: 'void', name: 'Void', element: 'chaos', primary: '#241a33', secondary: '#7b3fc4', accent: '#0b0812', glow: '#c77dff', resist: { chaos: 40, physical: 0, lightning: 20 }, word: 'Abyssal' },
  moss: { id: 'moss', name: 'Moss', element: null, primary: '#5d6b3a', secondary: '#9b8a5a', accent: '#2c2a1a', glow: '#d6ff7a', resist: { cold: 20 }, word: 'Overgrown' },
  rust: { id: 'rust', name: 'Rust', element: null, primary: '#8a4b2a', secondary: '#4a4a52', accent: '#2a1e1a', glow: '#ffb070', resist: { fire: 20, lightning: -20 }, word: 'Corroded' },
  blood: { id: 'blood', name: 'Blood', element: 'physical', primary: '#6b1420', secondary: '#c23a4a', accent: '#24070b', glow: '#ff4a5a', resist: { physical: 10 }, word: 'Sanguine' },
  gilded: { id: 'gilded', name: 'Gilded', element: 'lightning', primary: '#c9a13b', secondary: '#f2e2a0', accent: '#4a3a12', glow: '#fff2b0', resist: { lightning: 30, fire: 30 }, word: 'Gilded' },
  ash: { id: 'ash', name: 'Ash', element: 'fire', primary: '#6a6662', secondary: '#2e2b2a', accent: '#141212', glow: '#ff6a2a', resist: { fire: 40 }, word: 'Ashen' },
  spectral: { id: 'spectral', name: 'Spectral', element: 'cold', primary: '#9fd9ff', secondary: '#3a6aff', accent: '#10183a', glow: '#bff0ff', resist: { physical: 25, cold: 40 }, word: 'Ghostly' },
};

// ---------------------------------------------------------------- monster modifiers (elites)

export interface MonsterAffix {
  id: string;
  name: string;
  mods: Mod[];
  /** Behaviour hook handled by the sim (sim/monsterAffixes.ts). */
  behaviour?: 'molten' | 'frostpulse' | 'shielding' | 'teleporter' | 'vortex' | 'splitter' | 'summoner' | 'deathburst' | 'enrage' | 'thorns' | 'warding';
  color: string;
}

export const MONSTER_AFFIXES: Record<string, MonsterAffix> = {
  hasted: { id: 'hasted', name: 'Hasted', color: '#7fffd4', mods: [mod('moveSpeed', 'inc', 35), mod('attackSpeed', 'inc', 25), mod('castSpeed', 'inc', 25)] },
  armored: { id: 'armored', name: 'Armoured', color: '#c9c9d9', mods: [mod('damageTaken', 'more', -30), mod('stunThreshold', 'inc', 100)] },
  vampiric: { id: 'vampiric', name: 'Vampiric', color: '#d6324a', mods: [mod('lifeLeech', 'flat', 15)] },
  mighty: { id: 'mighty', name: 'Mighty', color: '#ff7a3d', mods: [mod('damage', 'more', 40)] },
  stout: { id: 'stout', name: 'Stout', color: '#d8c08a', mods: [mod('life', 'more', 60)] },
  molten: { id: 'molten', name: 'Molten', color: '#ff8a3d', behaviour: 'molten', mods: [mod('resFire', 'flat', 40), mod('addedFire', 'flat', 2)] },
  frostbound: { id: 'frostbound', name: 'Frostbound', color: '#8fd8ff', behaviour: 'frostpulse', mods: [mod('resCold', 'flat', 40)] },
  shielding: { id: 'shielding', name: 'Shielding', color: '#fff2b0', behaviour: 'shielding', mods: [] },
  teleporter: { id: 'teleporter', name: 'Teleporting', color: '#c77dff', behaviour: 'teleporter', mods: [] },
  vortex: { id: 'vortex', name: 'Vortex', color: '#9a8cff', behaviour: 'vortex', mods: [] },
  splitter: { id: 'splitter', name: 'Splitting', color: '#a6d94a', behaviour: 'splitter', mods: [] },
  summoner: { id: 'summoner', name: 'Horde-caller', color: '#b388ff', behaviour: 'summoner', mods: [] },
  deathburst: { id: 'deathburst', name: 'Volatile', color: '#ffe95c', behaviour: 'deathburst', mods: [] },
  enrage: { id: 'enrage', name: 'Berserk', color: '#ff3d3d', behaviour: 'enrage', mods: [] },
  thorns: { id: 'thorns', name: 'Thorned', color: '#9b8a5a', behaviour: 'thorns', mods: [mod('armor', 'more', 50)] },
  warding: { id: 'warding', name: 'Warding', color: '#b388ff', behaviour: 'warding', mods: [] },
};

export type MonsterRarity = 'normal' | 'magic' | 'rare' | 'unique';

export const RARITY_SCALING: Record<MonsterRarity, { life: number; damage: number; xp: number; affixes: [number, number]; loot: number; size: number }> = {
  normal: { life: 1, damage: 1, xp: 1, affixes: [0, 0], loot: 1, size: 1 },
  magic: { life: 2.2, damage: 1.2, xp: 2.5, affixes: [1, 1], loot: 2.5, size: 1.08 },
  rare: { life: 4.5, damage: 1.45, xp: 6, affixes: [2, 3], loot: 6, size: 1.18 },
  unique: { life: 15, damage: 1.5, xp: 25, affixes: [0, 0], loot: 18, size: 1 },
};

// ---------------------------------------------------------------- monster bodies + attack sets

export type MonsterBody = { kind: 'humanoid'; preset: string } | { kind: 'creature'; plan: string; seed?: number; genome?: GenomeEdits };

export interface MonsterDef {
  id: string;
  name: string;
  family: string;
  body: MonsterBody;
  archetype: string;
  skills: string[];
  /** Multipliers on the level curves. */
  life: number;
  damage: number;
  /** Base run speed, m/s. */
  speed: number;
  /** Visual and collider scale. */
  size: number;
  xp: number;
  palette: string;
  armor?: number;
  resist?: Partial<Record<DamageType, number>>;
  boss?: { title: string; phases: number; enrageAt?: number };
  /** Summoned minions for summoner skills. */
  minion?: string;
}

const H = (preset: string): MonsterBody => ({ kind: 'humanoid', preset });

export const MONSTERS: Record<string, MonsterDef> = {
  hollow: { id: 'hollow', name: 'Hollow', family: 'undead', body: H('hollow'), archetype: 'swarmer', skills: ['m_scratch'], life: 1, damage: 1, speed: 3.4, size: 1, xp: 1, palette: 'bone' },
  hollow_brute: { id: 'hollow_brute', name: 'Hollow Brute', family: 'undead', body: H('hollow_brute'), archetype: 'brute', skills: ['m_punch', 'm_slam'], life: 1, damage: 1, speed: 3, size: 1.3, xp: 1.5, palette: 'bone' },
  brigand: { id: 'brigand', name: 'Brigand', family: 'bandit', body: H('brigand'), archetype: 'skirmisher', skills: ['m_slash'], life: 1, damage: 1, speed: 4.2, size: 1, xp: 1.1, palette: 'blood' },
  marksman: { id: 'marksman', name: 'Marksman', family: 'bandit', body: H('marksman'), archetype: 'archer', skills: ['m_arrow'], life: 1, damage: 1, speed: 3.8, size: 1, xp: 1.1, palette: 'rust' },
  cultist: { id: 'cultist', name: 'Cultist', family: 'cult', body: H('cultist'), archetype: 'caster', skills: ['m_bolt', 'm_groundfire'], life: 1, damage: 1, speed: 3.5, size: 1, xp: 1.2, palette: 'ember' },
  hexer: { id: 'hexer', name: 'Hexer', family: 'cult', body: H('hexer'), archetype: 'summoner', skills: ['m_summon', 'm_bolt'], life: 1, damage: 1, speed: 3.4, size: 1, xp: 1.4, palette: 'void', minion: 'minion' },
  warden: { id: 'warden', name: 'Warden', family: 'order', body: H('warden'), archetype: 'guardian', skills: ['m_slash', 'm_ward'], life: 1, damage: 1, speed: 3.6, size: 1.05, xp: 1.4, palette: 'gilded', armor: 1 },
  golem: { id: 'golem', name: 'Golem', family: 'construct', body: H('golem'), archetype: 'brute', skills: ['m_punch', 'm_slam'], life: 1.2, damage: 1, speed: 2.8, size: 1.45, xp: 2, palette: 'rust', armor: 2 },
  bombling: { id: 'bombling', name: 'Bombling', family: 'construct', body: H('bombling'), archetype: 'bomber', skills: ['m_explode'], life: 1, damage: 1, speed: 4.6, size: 0.72, xp: 0.6, palette: 'ember' },
  reaver: { id: 'reaver', name: 'Reaver', family: 'order', body: H('reaver'), archetype: 'charger', skills: ['m_charge', 'm_heavy'], life: 1, damage: 1, speed: 4, size: 1.1, xp: 1.6, palette: 'blood' },
  shade: { id: 'shade', name: 'Shade', family: 'spirit', body: H('shade'), archetype: 'stalker', skills: ['m_slash', 'm_leap'], life: 1, damage: 1, speed: 5, size: 0.95, xp: 1.3, palette: 'spectral' },
  mender: { id: 'mender', name: 'Mender', family: 'cult', body: H('mender'), archetype: 'guardian', skills: ['m_mend', 'm_bolt'], life: 1, damage: 0.8, speed: 3.4, size: 1, xp: 1.3, palette: 'moss' },
  minion: { id: 'minion', name: 'Risen Thrall', family: 'undead', body: H('thrall'), archetype: 'minion', skills: ['m_scratch'], life: 0.6, damage: 0.7, speed: 3.6, size: 0.8, xp: 0.2, palette: 'bone' },
  imp: { id: 'imp', name: 'Loot Imp', family: 'treasure', body: { kind: 'creature', plan: 'slime', seed: 21 }, archetype: 'fleer', skills: [], life: 3.5, damage: 0, speed: 5.6, size: 0.75, xp: 4, palette: 'gilded' },
  sporeling: { id: 'sporeling', name: 'Sporeling', family: 'fungus', body: { kind: 'creature', plan: 'spore', seed: 11 }, archetype: 'minion', skills: ['m_bite'], life: 0.8, damage: 0.9, speed: 5.2, size: 0.6, xp: 0, palette: 'venom' },
  spirit_wolf: { id: 'spirit_wolf', name: 'Spirit Wolf', family: 'spirit', body: { kind: 'creature', plan: 'wolf', seed: 7 }, archetype: 'minion', skills: ['m_bite'], life: 1.4, damage: 1.2, speed: 6, size: 0.9, xp: 0, palette: 'spectral' },
  // ---- campaign bosses (humanoid bodies; procedural creature bosses come from encounters.ts)
  boss_golem: {
    id: 'boss_golem', name: 'Kegmaster Grull', family: 'construct', body: H('boss_golem'), archetype: 'boss', skills: ['m_punch', 'b_quake', 'm_slam', 'b_meteors'],
    life: 1.4, damage: 1.1, speed: 3, size: 2.1, xp: 1, palette: 'ember', armor: 2, boss: { title: 'The Powder King', phases: 2, enrageAt: 0.35 },
  },
  boss_cult: {
    id: 'boss_cult', name: 'Hierophant Vael', family: 'cult', body: H('boss_cult'), archetype: 'boss', skills: ['m_bolt', 'b_barrage', 'm_summon', 'm_groundfire'],
    life: 1.1, damage: 1, speed: 3.5, size: 1.7, xp: 1, palette: 'void', boss: { title: 'Voice of the Rift', phases: 2, enrageAt: 0.3 }, minion: 'minion',
  },
  boss_reaver: {
    id: 'boss_reaver', name: 'Sir Corvane', family: 'order', body: H('boss_reaver'), archetype: 'boss', skills: ['b_sweep', 'm_charge', 'm_leap', 'b_quake'],
    life: 1.25, damage: 1.15, speed: 4.2, size: 1.8, xp: 1, palette: 'blood', armor: 1.5, boss: { title: 'The Oathbreaker', phases: 2, enrageAt: 0.4 },
  },
};

/**
 * Registers a custom monster assembled from parts (the agent `species.create` tool and the
 * Workshop): any body, archetype, attack modules and palette. Ids live under `custom:` so they can
 * never replace a built-in definition. Returns the stored def; throws on unknown parts.
 */
export function registerMonster(def: MonsterDef): MonsterDef {
  const id = def.id.startsWith('custom:') ? def.id : `custom:${def.id}`;
  if (!/^custom:[a-z0-9_-]{1,40}$/.test(id)) throw new Error(`monster id must be letters, digits, _ or - (got "${def.id}")`);
  if (!ARCHETYPES[def.archetype]) throw new Error(`unknown archetype "${def.archetype}". Known: ${Object.keys(ARCHETYPES).join(', ')}`);
  if (!PALETTES[def.palette]) throw new Error(`unknown palette "${def.palette}". Known: ${Object.keys(PALETTES).join(', ')}`);
  for (const sk of def.skills) if (!SKILLS[sk]) throw new Error(`unknown skill "${sk}"`);
  if (def.body.kind === 'humanoid' && !PRESETS[def.body.preset]) throw new Error(`unknown humanoid preset "${def.body.preset}"`);
  if (def.body.kind === 'creature' && !CREATURE_PRESETS.includes(def.body.plan) && !BODY_PLANS.includes(def.body.plan as BodyPlan)) {
    throw new Error(`unknown creature body "${def.body.plan}". Plans: ${BODY_PLANS.join(', ')}; presets: ${CREATURE_PRESETS.join(', ')}`);
  }
  if (def.minion) ensureMonster(def.minion);
  const stored: MonsterDef = { ...def, id };
  MONSTERS[id] = stored;
  return stored;
}

export function monsterDef(id: string): MonsterDef {
  return ensureMonster(id);
}

// ---------------------------------------------------------------- procedural species


const PLAN_SIZE: Record<BodyPlan, number> = { quadruped: 1, hexapod: 1, arachnid: 1, biped: 1.25, serpent: 0.95, floater: 1, centipede: 0.95, blob: 0.85 };
const PLAN_SPEED: Record<BodyPlan, number> = { quadruped: 5, hexapod: 3.6, arachnid: 4.6, biped: 3.4, serpent: 4, floater: 3.2, centipede: 4.2, blob: 3.8 };
const BOSS_MODULES: Record<BodyPlan, string[]> = {
  quadruped: ['b_quake', 'm_charge', 'b_sweep'], hexapod: ['b_quake', 'm_charge', 'm_spit'], arachnid: ['b_barrage', 'm_leap', 'm_summon'],
  biped: ['b_quake', 'b_sweep', 'm_leap'], serpent: ['b_barrage', 'm_nova', 'b_meteors'], floater: ['b_barrage', 'b_meteors', 'm_summon'],
  centipede: ['m_charge', 'b_quake', 'm_spit'], blob: ['m_summon', 'b_barrage', 'm_nova'],
};

/**
 * Resolves (and caches) a procedural species id: `sp:<plan or preset>:<seed>` for a normal
 * species, `sp:<plan>:<seed>:boss` for a boss. Deterministic: the same id is always the same
 * creature, name, archetype and attack kit.
 */
export function ensureMonster(id: string): MonsterDef {
  const hit = MONSTERS[id];
  if (hit) return hit;
  if (!id.startsWith('sp:')) throw new Error(`unknown monster "${id}". Known: ${Object.keys(MONSTERS).join(', ')}`);
  const [, preset, seedStr, flavour] = id.split(':');
  const seed = Number(seedStr) || 1;
  const plan = planOf(preset);
  const r = new Rng(seed * 2654435761 + 17);
  const kit = PLAN_KIT[plan];
  const boss = flavour === 'boss';
  const archetype = boss ? 'boss' : r.pick(kit.archetypes);
  const skills = [kit.skills[0]];
  const extra = kit.skills.slice(1).filter((s) => !(archetype === 'bomber' && s !== 'm_explode'));
  if (archetype === 'bomber') skills.splice(0, 1, 'm_explode');
  else if (extra.length && r.chance(0.75)) skills.push(r.pick(extra));
  if (boss) skills.push(...BOSS_MODULES[plan]);
  const name = speciesName(plan, seed);
  const def: MonsterDef = {
    id, name: boss ? `${name} Matriarch` : name, family: plan, body: { kind: 'creature', plan: preset, seed },
    archetype, skills: [...new Set(skills)], life: boss ? 1.3 : 1, damage: 1, speed: PLAN_SPEED[plan] * r.range(0.9, 1.1),
    size: PLAN_SIZE[plan] * r.range(0.85, 1.2) * (boss ? 2.4 : 1), xp: 1.1, palette: 'moss',
    boss: boss ? { title: 'Mother of the Brood', phases: 2, enrageAt: 0.35 } : undefined,
    minion: boss ? `sp:${preset}:${seed}` : undefined,
  };
  MONSTERS[id] = def;
  return def;
}
