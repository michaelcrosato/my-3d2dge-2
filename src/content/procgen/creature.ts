/**
 * Creature genomes (Spore-style): a body plan plus a seed gives a complete, deterministic species
 * description: spine, neck, head, jaw, eyes, horns, tail, legs, arms, spikes, shell plates,
 * wings, tentacles and skin pattern. The renderer turns a genome into a skinned mesh with a
 * procedural rig (render/creature/build.ts) and animates it procedurally from sim state
 * (render/creature/animate.ts); the sim only needs the plan's footprint.
 *
 * Plans are the hand-designed "base of the system"; seeds make it endless. Agents can list the
 * plans, generate genomes, render turntables and inspect rigs through the agent tools.
 */
import { Rng } from '../../sim/rng';

export type BodyPlan = 'quadruped' | 'hexapod' | 'arachnid' | 'biped' | 'serpent' | 'floater' | 'centipede' | 'blob';
export type HeadShape = 'snout' | 'skull' | 'beak' | 'maw' | 'eye' | 'mandible';
export type TailTip = 'none' | 'club' | 'stinger' | 'spikes' | 'fin';

export interface CreatureGenome {
  plan: BodyPlan;
  seed: number;
  /** Body length along the spine, m (at size 1). */
  length: number;
  /** Spine height above the ground at rest, m. */
  height: number;
  /** Spine pitch: 0 = horizontal, ~1.2 = upright (bipeds). */
  pitch: number;
  girth: number;
  spine: number;
  /** Front-to-back girth ratio (>1 = bulky shoulders). */
  taper: number;
  hump: number;
  /** Vertical squash of the body cross-section. */
  squash: number;
  neck: { length: number; segments: number; up: number };
  head: { shape: HeadShape; size: number; length: number; eyes: number; eyeSize: number; jaw: boolean };
  horns: { count: number; length: number; curve: number };
  tail: { segments: number; length: number; taper: number; tip: TailTip; up: number };
  legs: { pairs: number; length: number; thickness: number; joints: 2 | 3; splay: number; foot: 'paw' | 'claw' | 'hoof' | 'spike' };
  arms: { length: number; thickness: number; pincer: boolean } | null;
  spikes: { count: number; size: number };
  plates: boolean;
  wings: { span: number } | null;
  tentacles: { count: number; length: number } | null;
  /** Hover height for floaters. */
  float: number;
  pattern: 'plain' | 'stripes' | 'spots' | 'belly';
  /** Gait cycle length in meters (feet stride). */
  stride: number;
}

export const BODY_PLANS: BodyPlan[] = ['quadruped', 'hexapod', 'arachnid', 'biped', 'serpent', 'floater', 'centipede', 'blob'];

/** Named presets used by monster defs ("wolf" = quadruped with certain biases). */
const PRESET_PLAN: Record<string, { plan: BodyPlan; bias?: (g: CreatureGenome, r: Rng) => void }> = {
  wolf: { plan: 'quadruped', bias: (g) => { g.head.shape = 'snout'; g.horns.count = 0; g.tail.tip = 'none'; g.wings = null; g.spikes.count = 0; } },
  boar: { plan: 'quadruped', bias: (g) => { g.head.shape = 'snout'; g.horns.count = 2; g.taper = 1.4; g.legs.length *= 0.75; } },
  drake: { plan: 'quadruped', bias: (g, r) => { g.head.shape = 'skull'; g.horns.count = 2; g.wings = { span: 1.6 + r.next() }; g.tail.length *= 1.4; } },
  spider: { plan: 'arachnid', bias: (g) => { g.tail.tip = 'none'; g.tail.segments = 0; } },
  scorpion: { plan: 'arachnid', bias: (g) => { g.tail = { segments: 5, length: 0.95, taper: 0.4, tip: 'stinger', up: 1.1 }; g.arms = { length: 0.55, thickness: 0.07, pincer: true }; } },
  beetle: { plan: 'hexapod', bias: (g) => { g.plates = true; g.horns.count = 1; } },
  crab: { plan: 'hexapod', bias: (g) => { g.arms = { length: 0.6, thickness: 0.1, pincer: true }; g.plates = true; g.head.shape = 'eye'; } },
  serpent: { plan: 'serpent' },
  wyrm: { plan: 'serpent', bias: (g) => { g.horns.count = 2; g.spikes.count = 6; } },
  brute: { plan: 'biped', bias: (g) => { g.arms = { length: 0.8, thickness: 0.12, pincer: false }; g.taper = 1.6; g.girth *= 1.2; } },
  raptor: { plan: 'biped', bias: (g) => { g.pitch = 0.2; g.arms = { length: 0.35, thickness: 0.05, pincer: false }; g.tail.length = 1.0; } },
  eye: { plan: 'floater', bias: (g) => { g.head.shape = 'eye'; } },
  wisp: { plan: 'floater', bias: (g) => { g.head.shape = 'skull'; } },
  centipede: { plan: 'centipede' },
  spore: { plan: 'blob' },
  slime: { plan: 'blob', bias: (g) => { g.head.eyes = 2; } },
};

export const CREATURE_PRESETS = Object.keys(PRESET_PLAN);

export function planOf(name: string): BodyPlan {
  return PRESET_PLAN[name]?.plan ?? (BODY_PLANS.includes(name as BodyPlan) ? (name as BodyPlan) : 'quadruped');
}

/**
 * Hand edits on top of a generated genome (the Workshop and agent `species.create`): any field,
 * nested objects merged, `null` removes wings / arms / tentacles. Counts and sizes are clamped to
 * what the rig builder supports.
 */
export type GenomeEdits = { [K in keyof CreatureGenome]?: CreatureGenome[K] extends object | null ? Partial<NonNullable<CreatureGenome[K]>> | null : CreatureGenome[K] };

const EDIT_LIMITS: Record<string, [number, number]> = {
  length: [0.3, 4], height: [0.1, 3], pitch: [0, 1.5], girth: [0.06, 1.2], taper: [0.4, 2.5], hump: [0, 0.6], squash: [0.4, 1.4], float: [0, 2],
  'neck.length': [0, 1.2], 'neck.segments': [0, 8], 'head.size': [0.06, 0.9], 'head.length': [0.1, 1.2], 'head.eyes': [0, 8], 'head.eyeSize': [0.01, 0.2],
  'horns.count': [0, 6], 'horns.length': [0.05, 1], 'tail.segments': [0, 12], 'tail.length': [0, 3], 'legs.pairs': [0, 8], 'legs.length': [0.1, 2],
  'legs.thickness': [0.02, 0.3], 'spikes.count': [0, 16], 'spikes.size': [0.03, 0.5], 'wings.span': [0.4, 4], 'tentacles.count': [0, 12], 'tentacles.length': [0.1, 2.5],
  'arms.length': [0.1, 1.5], 'arms.thickness': [0.02, 0.3], stride: [0.2, 3],
};

export function applyGenomeEdits(g: CreatureGenome, edits: GenomeEdits | undefined): CreatureGenome {
  if (!edits) return g;
  const out = structuredClone(g) as unknown as Record<string, unknown>;
  const clamp = (key: string, v: unknown) => {
    const lim = EDIT_LIMITS[key];
    if (typeof v !== 'number' || !lim) return v;
    const c = Math.min(lim[1], Math.max(lim[0], v));
    return Number.isInteger(lim[0]) && Number.isInteger(lim[1]) && key.match(/count|pairs|segments|eyes/) ? Math.round(c) : c;
  };
  for (const [k, v] of Object.entries(edits)) {
    if (!(k in g) || k === 'plan' || k === 'seed') throw new Error(`unknown genome field "${k}". Fields: ${Object.keys(g).filter((x) => x !== 'plan' && x !== 'seed').join(', ')}`);
    if (v === null) out[k] = null;
    else if (typeof v === 'object' && !Array.isArray(v)) {
      const base = (out[k] ?? defaultPart(k)) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...base };
      for (const [kk, vv] of Object.entries(v)) merged[kk] = clamp(`${k}.${kk}`, vv);
      out[k] = merged;
    } else out[k] = clamp(k, v);
  }
  return out as unknown as CreatureGenome;
}

function defaultPart(k: string): Record<string, unknown> {
  if (k === 'wings') return { span: 1.4 };
  if (k === 'arms') return { length: 0.5, thickness: 0.08, pincer: false };
  if (k === 'tentacles') return { count: 4, length: 0.8 };
  return {};
}

export function generateGenome(planOrPreset: string, seed: number, edits?: GenomeEdits): CreatureGenome {
  return applyGenomeEdits(baseGenome(planOrPreset, seed), edits);
}

function baseGenome(planOrPreset: string, seed: number): CreatureGenome {
  const preset = PRESET_PLAN[planOrPreset];
  const plan = preset?.plan ?? planOf(planOrPreset);
  const r = new Rng(seed * 7919 + plan.length * 101 + 13);
  const pick = <T>(xs: readonly T[]) => r.pick(xs);
  const R = (a: number, b: number) => r.range(a, b);
  const g: CreatureGenome = {
    plan, seed,
    length: 1.2, height: 0.65, pitch: 0, girth: 0.28, spine: 4, taper: 1, hump: 0, squash: 0.85,
    neck: { length: 0.3, segments: 2, up: 0.4 },
    head: { shape: 'snout', size: 0.22, length: 0.35, eyes: 2, eyeSize: 0.05, jaw: true },
    horns: { count: 0, length: 0.25, curve: 0.5 },
    tail: { segments: 4, length: 0.8, taper: 0.2, tip: 'none', up: 0.1 },
    legs: { pairs: 2, length: 0.62, thickness: 0.08, joints: 2, splay: 0.22, foot: 'paw' },
    arms: null,
    spikes: { count: 0, size: 0.12 },
    plates: false,
    wings: null,
    tentacles: null,
    float: 0,
    pattern: pick(['plain', 'stripes', 'spots', 'belly'] as const),
    stride: 0.9,
  };
  switch (plan) {
    case 'quadruped':
      Object.assign(g, { length: R(0.9, 1.3), height: R(0.5, 0.72), girth: R(0.17, 0.26), spine: 4, taper: R(0.85, 1.35), hump: R(0, 0.1) });
      g.neck = { length: R(0.2, 0.45), segments: 2, up: R(0.2, 0.7) };
      g.head = { shape: pick(['snout', 'skull', 'maw'] as const), size: R(0.18, 0.28), length: R(0.25, 0.45), eyes: pick([2, 2, 4]), eyeSize: R(0.04, 0.07), jaw: true };
      g.horns = { count: pick([0, 0, 2, 2, 4]), length: R(0.15, 0.4), curve: R(0, 1) };
      g.tail = { segments: 4, length: R(0.4, 1.1), taper: R(0.1, 0.4), tip: pick(['none', 'none', 'club', 'spikes'] as const), up: R(-0.1, 0.4) };
      g.legs = { pairs: 2, length: g.height * R(0.95, 1.1), thickness: R(0.06, 0.11), joints: 2, splay: g.girth * R(0.7, 1), foot: pick(['paw', 'claw', 'hoof'] as const) };
      g.spikes = { count: pick([0, 0, 3, 5, 7]), size: R(0.08, 0.18) };
      g.stride = g.legs.length * 1.4;
      break;
    case 'hexapod':
      Object.assign(g, { length: R(0.8, 1.15), height: R(0.32, 0.45), girth: R(0.22, 0.32), spine: 3, taper: R(0.9, 1.2), squash: 0.6 });
      g.neck = { length: 0.05, segments: 1, up: 0 };
      g.head = { shape: pick(['mandible', 'maw', 'eye'] as const), size: R(0.18, 0.26), length: 0.22, eyes: pick([2, 4, 6]), eyeSize: R(0.03, 0.06), jaw: true };
      g.horns = { count: pick([0, 1, 2]), length: R(0.2, 0.45), curve: R(0, 0.6) };
      g.tail = { segments: 0, length: 0, taper: 0.5, tip: 'none', up: 0 };
      g.legs = { pairs: 3, length: R(0.45, 0.65), thickness: R(0.04, 0.07), joints: 3, splay: g.girth * 1.1, foot: 'spike' };
      g.plates = r.chance(0.7);
      g.stride = 0.55;
      break;
    case 'arachnid':
      Object.assign(g, { length: R(0.7, 1.0), height: R(0.38, 0.5), girth: R(0.17, 0.25), spine: 2, taper: R(0.6, 0.9), squash: 0.8, hump: R(0.05, 0.16) });
      g.neck = { length: 0.02, segments: 1, up: 0 };
      g.head = { shape: pick(['eye', 'mandible'] as const), size: R(0.16, 0.22), length: 0.2, eyes: pick([4, 6, 8]), eyeSize: R(0.025, 0.045), jaw: true };
      g.tail = { segments: 0, length: 0, taper: 0.5, tip: 'none', up: 0 };
      g.legs = { pairs: 4, length: R(0.75, 1.05), thickness: R(0.035, 0.055), joints: 3, splay: g.girth * 0.9, foot: 'spike' };
      g.stride = 0.7;
      break;
    case 'biped':
      Object.assign(g, { length: R(0.65, 0.9), height: R(0.8, 1.05), pitch: R(0.9, 1.3), girth: R(0.18, 0.27), spine: 3, taper: R(1.1, 1.6), hump: R(0, 0.12) });
      g.neck = { length: R(0.1, 0.25), segments: 1, up: 0.2 };
      g.head = { shape: pick(['skull', 'maw', 'snout', 'beak'] as const), size: R(0.2, 0.3), length: R(0.22, 0.35), eyes: pick([1, 2, 2, 3]), eyeSize: R(0.04, 0.07), jaw: true };
      g.horns = { count: pick([0, 2, 2, 3]), length: R(0.15, 0.4), curve: R(0.2, 1) };
      g.tail = { segments: pick([0, 3, 4]), length: R(0.4, 0.9), taper: 0.2, tip: pick(['none', 'club', 'spikes'] as const), up: -0.3 };
      g.legs = { pairs: 1, length: g.height * R(0.98, 1.08), thickness: R(0.07, 0.11), joints: 2, splay: g.girth * 0.75, foot: pick(['claw', 'hoof'] as const) };
      g.arms = { length: R(0.55, 0.85), thickness: R(0.06, 0.11), pincer: false };
      g.spikes = { count: pick([0, 3, 4]), size: R(0.1, 0.2) };
      g.stride = g.legs.length * 1.2;
      break;
    case 'serpent':
      Object.assign(g, { length: R(2.2, 3.2), height: R(0.16, 0.26), girth: R(0.11, 0.17), spine: 9, taper: R(1, 1.3), squash: 0.9 });
      g.neck = { length: R(0.3, 0.6), segments: 3, up: R(0.6, 1.1) };
      g.head = { shape: pick(['snout', 'maw', 'skull'] as const), size: R(0.24, 0.32), length: R(0.3, 0.45), eyes: 2, eyeSize: R(0.045, 0.07), jaw: true };
      g.horns = { count: pick([0, 2]), length: R(0.15, 0.3), curve: R(0, 1) };
      g.tail = { segments: 0, length: 0, taper: 0.1, tip: pick(['none', 'fin', 'spikes'] as const), up: 0 };
      g.legs = { pairs: 0, length: 0, thickness: 0, joints: 2, splay: 0, foot: 'paw' };
      g.spikes = { count: pick([0, 5, 8]), size: R(0.06, 0.12) };
      g.stride = 1.2;
      break;
    case 'centipede':
      Object.assign(g, { length: R(1.8, 2.5), height: R(0.22, 0.3), girth: R(0.12, 0.17), spine: 7, taper: 1, squash: 0.7 });
      g.neck = { length: 0.05, segments: 1, up: 0.1 };
      g.head = { shape: pick(['mandible', 'maw'] as const), size: R(0.16, 0.22), length: 0.2, eyes: pick([2, 4]), eyeSize: 0.035, jaw: true };
      g.tail = { segments: 0, length: 0, taper: 0.5, tip: pick(['none', 'stinger'] as const), up: 0.2 };
      g.legs = { pairs: 7, length: R(0.32, 0.45), thickness: 0.035, joints: 2, splay: g.girth * 1.1, foot: 'spike' };
      g.plates = true;
      g.stride = 0.4;
      break;
    case 'floater':
      Object.assign(g, { length: R(0.5, 0.8), height: 0, girth: R(0.3, 0.45), spine: 2, taper: 1, squash: 1, float: R(1.0, 1.5) });
      g.neck = { length: 0, segments: 1, up: 0 };
      g.head = { shape: pick(['eye', 'skull', 'maw'] as const), size: R(0.28, 0.4), length: 0.1, eyes: 1, eyeSize: R(0.12, 0.18), jaw: r.chance(0.5) };
      g.tail = { segments: 0, length: 0, taper: 0.5, tip: 'none', up: 0 };
      g.legs = { pairs: 0, length: 0, thickness: 0, joints: 2, splay: 0, foot: 'paw' };
      g.tentacles = { count: pick([3, 4, 5, 6]), length: R(0.6, 1.1) };
      g.spikes = { count: pick([0, 4, 6]), size: R(0.08, 0.16) };
      g.stride = 1;
      break;
    case 'blob':
      Object.assign(g, { length: R(0.5, 0.75), height: 0, girth: R(0.32, 0.45), spine: 1, taper: 1, squash: R(0.65, 0.85) });
      g.neck = { length: 0, segments: 1, up: 0 };
      g.head = { shape: 'eye', size: 0.1, length: 0.05, eyes: pick([1, 2, 3]), eyeSize: R(0.06, 0.09), jaw: false };
      g.tail = { segments: 0, length: 0, taper: 0.5, tip: 'none', up: 0 };
      g.legs = { pairs: 0, length: 0, thickness: 0, joints: 2, splay: 0, foot: 'paw' };
      g.spikes = { count: pick([0, 0, 5, 8]), size: R(0.06, 0.12) };
      g.stride = 0.8;
      break;
  }
  if (r.chance(0.12) && !g.wings && (plan === 'quadruped' || plan === 'biped' || plan === 'floater')) g.wings = { span: R(1, 2) };
  preset?.bias?.(g, r);
  return g;
}

// ---------------------------------------------------------------- species names

const SYL_A = ['gnash', 'rot', 'skrel', 'vor', 'ghast', 'murk', 'thra', 'zil', 'krak', 'bil', 'shiv', 'gor', 'mal', 'quel', 'drev', 'snik', 'ul', 'yth', 'brog', 'fen'];
const SYL_B = ['tooth', 'maw', 'crawler', 'fiend', 'stalker', 'hound', 'mite', 'wing', 'coil', 'shell', 'eye', 'spawn', 'gut', 'claw', 'horn', 'fang', 'beast', 'wyrm', 'drone', 'husk'];
const PLAN_NOUN: Record<BodyPlan, string[]> = {
  quadruped: ['Hound', 'Prowler', 'Ravager', 'Beast'], hexapod: ['Beetle', 'Carapace', 'Skitterer'], arachnid: ['Weaver', 'Stalker', 'Spider'],
  biped: ['Brute', 'Ogre', 'Horror'], serpent: ['Serpent', 'Wyrm', 'Coil'], floater: ['Watcher', 'Drifter', 'Wisp'],
  centipede: ['Crawler', 'Centipede', 'Burrower'], blob: ['Ooze', 'Spore', 'Glob'],
};

export function speciesName(plan: BodyPlan, seed: number): string {
  const r = new Rng(seed * 31 + 7);
  const a = r.pick(SYL_A), b = r.pick(SYL_B);
  return r.chance(0.5) ? `${a[0].toUpperCase()}${a.slice(1)}${b}` : `${a[0].toUpperCase()}${a.slice(1)}${b} ${r.pick(PLAN_NOUN[plan])}`;
}

/** Sim footprint radius (m at size 1) for a plan. */
export function planRadius(plan: BodyPlan): number {
  return { quadruped: 0.45, hexapod: 0.45, arachnid: 0.5, biped: 0.4, serpent: 0.4, floater: 0.4, centipede: 0.4, blob: 0.35 }[plan];
}

/** Natural attack modules (skills) and archetypes for a plan, for the endless generator. */
export const PLAN_KIT: Record<BodyPlan, { skills: string[]; archetypes: string[] }> = {
  quadruped: { skills: ['m_bite', 'm_charge', 'm_leap', 'm_scratch'], archetypes: ['skirmisher', 'charger', 'stalker', 'swarmer'] },
  hexapod: { skills: ['m_bite', 'm_charge', 'm_slam', 'm_spit'], archetypes: ['brute', 'charger', 'swarmer'] },
  arachnid: { skills: ['m_bite', 'm_spit', 'm_leap', 'm_spray'], archetypes: ['stalker', 'skirmisher', 'archer'] },
  biped: { skills: ['m_punch', 'm_slam', 'm_heavy', 'm_charge', 'm_leap'], archetypes: ['brute', 'charger', 'guardian'] },
  serpent: { skills: ['m_bite', 'm_spit', 'm_nova', 'm_charge'], archetypes: ['skirmisher', 'caster', 'stalker'] },
  floater: { skills: ['m_bolt', 'm_spray', 'm_nova', 'm_groundfire', 'm_summon'], archetypes: ['caster', 'summoner', 'archer'] },
  centipede: { skills: ['m_bite', 'm_charge', 'm_spit'], archetypes: ['charger', 'swarmer', 'skirmisher'] },
  blob: { skills: ['m_explode', 'm_bite', 'm_spit'], archetypes: ['bomber', 'swarmer'] },
};
