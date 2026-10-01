/**
 * Skills as data: a tiny timeline language shared by the hero, monsters and bosses.
 *
 * A skill plays for `time` seconds (scaled by attack/cast speed). Effects fire at fractions of
 * that timeline: melee strikes, projectiles, ground zones (telegraphed or lingering), buffs,
 * summons, sweeps along a dash path. Motion (lunges, dashes, leaps, blinks) and i-frames are
 * windows on the same timeline. Humanoids map the timeline onto mocap clip windows (the clip is
 * scrubbed by skill progress, so faster attacks play faster animations); procedural creatures
 * read the same progress and the `pose` hint.
 *
 * Monster attack modules and boss patterns are built from these same pieces, so a new skill is
 * one table entry, and the agent tools can list, preview and simulate any of them.
 */
import type { DamageRange, Tag } from './stats';

export interface AnimSpec {
  clip: string;
  /** Clip seconds mapped onto this segment (defaults: whole clip). */
  from?: number;
  to?: number;
  /** Fraction of the skill timeline this segment covers (multi-segment skills). */
  span?: number;
  /** Extra visual turns per second (whirlwind spin). */
  spin?: number;
}

export type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'cone'; radius: number; arc: number }
  | { kind: 'line'; length: number; width: number }
  | { kind: 'ring'; radius: number; width: number };

export type AilmentId = 'ignite' | 'chill' | 'freeze' | 'shock' | 'poison' | 'bleed';

export interface HitSpec {
  /** Damage effectiveness (1 = 100% of the skill's base). */
  mult?: number;
  /** Knockback speed, m/s. */
  knock?: number;
  /** Stagger power (compared against the target's poise). */
  stagger?: number;
  heavy?: boolean;
  /** Base ailment chances in percent, added to the attacker's stats. */
  ailments?: Partial<Record<AilmentId, number>>;
  /** Pulls targets toward the center (m/s) instead of pushing. */
  pull?: number;
}

export interface ProjectileSpec {
  speed: number;
  radius: number;
  /** Max travel distance, m. */
  range: number;
  pierce?: number;
  chain?: number;
  /** Explodes into an area on hit or at max range. */
  explode?: number;
  /** Parabolic lob landing at the aim point (spit, grenades); ignores characters until it lands. */
  lob?: boolean;
  homing?: number;
  /** Leaves a ground zone where it lands or explodes. */
  leaves?: ZoneSpec;
  hit?: HitSpec;
  visual: string;
}

export interface ZoneSpec {
  shape: Shape;
  /** Seconds of telegraph before the zone does anything. */
  delay: number;
  /** Seconds the zone lingers after resolving (0 = one instant hit). */
  duration: number;
  /** Seconds between hits while lingering. */
  tick?: number;
  hit?: HitSpec;
  /** Orbiting / following the owner (blade vortex, auras). */
  follow?: boolean;
  /** Damage effectiveness of each lingering tick relative to the impact. */
  tickMult?: number;
  /** Slow applied to enemies inside, percent. */
  slow?: number;
  visual: string;
}

export type Effect =
  | { at: number; type: 'strike'; shape: Shape; offset?: number; hit?: HitSpec; telegraph?: boolean }
  | { at: number; type: 'projectile'; projectile: ProjectileSpec; count?: number; spread?: number }
  | { at: number; type: 'zone'; zone: ZoneSpec; where: 'self' | 'aim' | 'front'; count?: number; scatter?: number }
  | { at: number; type: 'chain'; range: number; jumps: number; jumpRange: number; hit?: HitSpec; visual: string }
  | { at: number; type: 'sweep'; until: number; radius: number; hit?: HitSpec }
  | { at: number; type: 'buff'; status: string; duration: number; magnitude?: number; target: 'self' | 'allies'; radius?: number }
  | { at: number; type: 'summon'; monster: string; count: number; duration: number }
  | { at: number; type: 'heal'; pct: number; target: 'self' | 'allies'; radius?: number }
  | { at: number; type: 'selfDestruct' };

export interface Motion {
  kind: 'lunge' | 'dash' | 'leap' | 'blink';
  from: number;
  to: number;
  /** m/s for lunges; total distance for dashes/leaps/blinks. */
  speed?: number;
  distance?: number;
  /** Travel to the aim point (clamped to distance) instead of a fixed distance. */
  toAim?: boolean;
  /** Pass through characters. */
  ghost?: boolean;
  /** Peak height of a leap's visual arc, m. */
  height?: number;
}

export type CreaturePose = 'bite' | 'claw' | 'slam' | 'spit' | 'charge' | 'roar' | 'spin' | 'cast' | 'leap' | 'burst';

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  /** Icon recipe key (procedural pixel icons). */
  icon: string;
  tags: Tag[];
  kind: 'attack' | 'spell' | 'utility';
  /** Spells and monster skills: damage at level 1, scaled by the level power curve. */
  base?: DamageRange;
  /** Attacks: effectiveness against weapon damage, percent. */
  weapon?: number;
  cost?: number;
  cooldown?: number;
  /** Base duration, seconds. */
  time: number;
  anim: AnimSpec | AnimSpec[];
  pose?: CreaturePose;
  motion?: Motion;
  iframes?: [number, number];
  /** After this fraction, moving or dodging cancels the rest (fluid combat). */
  cancelAfter?: number;
  /** Basic-attack chain: pressing again during the window continues with this skill. */
  next?: string;
  /** Held skills loop this window of the timeline and repeat effects inside it. */
  channel?: { from: number; to: number; costPerSecond?: number; moveSpeed?: number };
  effects: Effect[];
  /** Preferred use range for AI and auto-aim, m. */
  range: number;
  aim: 'target' | 'direction' | 'self';
  /** Element color for VFX. */
  color?: string;
  /** Monsters: convert this fraction of physical damage to the monster's element. */
  elemental?: number;
  /** Damage type override for monsters by palette (spells cast by an ember cultist burn). */
  usesElement?: boolean;
}

// ---------------------------------------------------------------- hero skills

export const HERO_SKILLS: SkillDef[] = [
  {
    id: 'slash1', name: 'Slash', desc: 'A fast three-hit sword combo. Hold to keep swinging. Generates mana on hit.',
    icon: 'slash', tags: ['attack', 'melee'], kind: 'attack', weapon: 100, time: 0.34,
    anim: { clip: 'Sword_Regular_A' }, motion: { kind: 'lunge', from: 0, to: 0.45, speed: 2.2 },
    cancelAfter: 0.62, next: 'slash2', range: 2,
    effects: [{ at: 0.55, type: 'strike', shape: { kind: 'cone', radius: 2.2, arc: 120 }, hit: { knock: 2.5, stagger: 30 } }],
    aim: 'target',
  },
  {
    id: 'slash2', name: 'Slash', desc: 'Second hit of the combo.', icon: 'slash', tags: ['attack', 'melee'], kind: 'attack', weapon: 105,
    time: 0.38, anim: { clip: 'Sword_Regular_B' }, motion: { kind: 'lunge', from: 0, to: 0.4, speed: 2 },
    cancelAfter: 0.6, next: 'slash3', range: 2,
    effects: [{ at: 0.48, type: 'strike', shape: { kind: 'cone', radius: 2.2, arc: 120 }, hit: { knock: 2.5, stagger: 30 } }],
    aim: 'target',
  },
  {
    id: 'slash3', name: 'Slash', desc: 'Leaping finisher that hits all around.', icon: 'slash', tags: ['attack', 'melee', 'area'], kind: 'attack',
    weapon: 165, time: 0.62, anim: { clip: 'Sword_Regular_C', from: 0, to: 1.05 }, motion: { kind: 'lunge', from: 0.1, to: 0.6, speed: 2.4 },
    cancelAfter: 0.8, range: 2.2,
    effects: [{ at: 0.64, type: 'strike', shape: { kind: 'circle', radius: 2.5 }, hit: { knock: 6.5, stagger: 80, heavy: true } }],
    aim: 'target',
  },
  {
    id: 'dodge', name: 'Dodge Roll', desc: 'Roll through enemies. Briefly invulnerable. Cancels most actions.', icon: 'dodge',
    tags: ['movement'], kind: 'utility', time: 0.48, anim: { clip: 'Roll', from: 0.05, to: 0.95 },
    motion: { kind: 'dash', from: 0, to: 0.78, distance: 4.6, ghost: true }, iframes: [0, 0.62], cancelAfter: 0.8, range: 4,
    effects: [], aim: 'direction',
  },
  {
    id: 'cleave', name: 'Cleave', desc: 'A wide, heavy arc that staggers everything in front of you.', icon: 'cleave',
    tags: ['attack', 'melee', 'area'], kind: 'attack', weapon: 150, cost: 6, time: 0.55, anim: { clip: 'Sword_Attack', from: 0.12, to: 1.0 },
    motion: { kind: 'lunge', from: 0, to: 0.4, speed: 1.6 }, cancelAfter: 0.7, range: 2.6,
    effects: [{ at: 0.42, type: 'strike', shape: { kind: 'cone', radius: 3.1, arc: 190 }, hit: { knock: 5, stagger: 90, heavy: true } }],
    aim: 'target',
  },
  {
    id: 'whirlwind', name: 'Whirlwind', desc: 'Hold to spin, hitting everything around you while moving slowly.', icon: 'whirlwind',
    tags: ['attack', 'melee', 'area', 'channel'], kind: 'attack', weapon: 55, cost: 3, time: 0.3,
    anim: { clip: 'Sword_Regular_A', from: 0.12, to: 0.32, spin: 3 }, channel: { from: 0, to: 1, costPerSecond: 9, moveSpeed: 0.65 },
    range: 2, cancelAfter: 0,
    effects: [{ at: 0.5, type: 'strike', shape: { kind: 'circle', radius: 2.3 }, hit: { knock: 1.5, stagger: 15 } }],
    aim: 'self',
  },
  {
    id: 'dashstrike', name: 'Dash Strike', desc: 'Lunge through enemies, cutting everything along the path.', icon: 'dash',
    tags: ['attack', 'melee', 'movement'], kind: 'attack', weapon: 120, cost: 8, cooldown: 2.5, time: 0.5,
    anim: { clip: 'Sword_Dash', from: 0.22, to: 1.25 }, motion: { kind: 'dash', from: 0.1, to: 0.55, distance: 6.5, ghost: true, toAim: true },
    iframes: [0.1, 0.5], cancelAfter: 0.62, range: 6,
    effects: [{ at: 0.1, type: 'sweep', until: 0.6, radius: 1.3, hit: { knock: 3, stagger: 60 } }],
    aim: 'target',
  },
  {
    id: 'leapslam', name: 'Leap Slam', desc: 'Leap to a location and crash down, staggering and knocking back.', icon: 'leap',
    tags: ['attack', 'melee', 'area', 'movement'], kind: 'attack', weapon: 160, cost: 10, cooldown: 3, time: 0.9,
    anim: [{ clip: 'NinjaJump_Start', from: 0.1, to: 0.62, span: 0.55 }, { clip: 'NinjaJump_Land', from: 0, to: 0.7, span: 0.45 }],
    motion: { kind: 'leap', from: 0.08, to: 0.55, distance: 8, toAim: true, ghost: true, height: 1.8 }, iframes: [0.1, 0.55],
    cancelAfter: 0.75, range: 7,
    effects: [{ at: 0.56, type: 'strike', shape: { kind: 'circle', radius: 2.8 }, hit: { knock: 7, stagger: 120, heavy: true } }],
    aim: 'target',
  },
  {
    id: 'groundslam', name: 'Ground Slam', desc: 'Split the earth in a long line ahead.', icon: 'slam',
    tags: ['attack', 'melee', 'area'], kind: 'attack', weapon: 190, cost: 10, time: 0.7, anim: { clip: 'Sword_Attack', from: 0, to: 1.15 },
    cancelAfter: 0.72, range: 5,
    effects: [{ at: 0.4, type: 'strike', shape: { kind: 'line', length: 6.5, width: 2 }, hit: { knock: 4, stagger: 140, heavy: true } }],
    aim: 'target',
  },
  {
    id: 'fireball', name: 'Fireball', desc: 'Hurl an exploding ball of fire that can ignite.', icon: 'fireball',
    tags: ['spell', 'projectile', 'area', 'fire'], kind: 'spell', base: { fire: [9, 15] }, cost: 7, time: 0.42,
    anim: { clip: 'Spell_Simple_Shoot' }, cancelAfter: 0.6, range: 12, color: '#ff8a3d',
    effects: [{ at: 0.45, type: 'projectile', projectile: { speed: 15, radius: 0.35, range: 15, explode: 1.7, hit: { knock: 3, stagger: 40, ailments: { ignite: 25 } }, visual: 'fireball' } }],
    aim: 'target',
  },
  {
    id: 'frostnova', name: 'Frost Nova', desc: 'A ring of frost bursts from you, chilling and sometimes freezing.', icon: 'nova',
    tags: ['spell', 'area', 'cold'], kind: 'spell', base: { cold: [7, 11] }, cost: 10, cooldown: 1.2, time: 0.45,
    anim: { clip: 'Spell_Simple_Enter' }, cancelAfter: 0.7, range: 3.5, color: '#8fd8ff',
    effects: [{ at: 0.55, type: 'zone', where: 'self', zone: { shape: { kind: 'circle', radius: 3.8 }, delay: 0, duration: 0, hit: { knock: 4, stagger: 50, ailments: { chill: 100, freeze: 20 } }, visual: 'frostnova' } }],
    aim: 'self',
  },
  {
    id: 'chainlightning', name: 'Chain Lightning', desc: 'A bolt that leaps between enemies and can shock.', icon: 'lightning',
    tags: ['spell', 'lightning'], kind: 'spell', base: { lightning: [2, 24] }, cost: 8, time: 0.4,
    anim: { clip: 'Spell_Simple_Shoot' }, cancelAfter: 0.6, range: 10, color: '#ffe95c',
    effects: [{ at: 0.45, type: 'chain', range: 10, jumps: 4, jumpRange: 6, hit: { stagger: 25, ailments: { shock: 25 } }, visual: 'lightning' }],
    aim: 'target',
  },
  {
    id: 'bladefan', name: 'Blade Fan', desc: 'Throw a fan of knives that pierce and cause bleeding.', icon: 'knives',
    tags: ['attack', 'projectile'], kind: 'attack', weapon: 55, cost: 6, time: 0.45, anim: { clip: 'OverhandThrow', from: 0.1, to: 0.85 },
    cancelAfter: 0.55, range: 9,
    effects: [{ at: 0.3, type: 'projectile', count: 5, spread: 55, projectile: { speed: 20, radius: 0.25, range: 11, pierce: 1, hit: { knock: 1, stagger: 15, ailments: { bleed: 20 } }, visual: 'knife' } }],
    aim: 'target',
  },
  {
    id: 'shieldcharge', name: 'Shoulder Charge', desc: 'Barrel forward, bowling enemies over.', icon: 'charge',
    tags: ['attack', 'melee', 'movement'], kind: 'attack', weapon: 80, cost: 8, cooldown: 4, time: 0.62, anim: { clip: 'Shield_Dash', from: 0, to: 1.0 },
    motion: { kind: 'dash', from: 0.05, to: 0.75, distance: 8, toAim: true }, iframes: [0.05, 0.4], cancelAfter: 0.8, range: 8,
    effects: [{ at: 0.05, type: 'sweep', until: 0.8, radius: 1.4, hit: { knock: 9, stagger: 200, heavy: true } }],
    aim: 'target',
  },
  {
    id: 'warcry', name: 'War Cry', desc: 'Roar: knock enemies back and gain Rage (+damage, +speed).', icon: 'warcry',
    tags: ['warcry', 'area'], kind: 'utility', cooldown: 10, time: 0.55, anim: { clip: 'Shield_OneShot' }, cancelAfter: 0.6, range: 4,
    effects: [
      { at: 0.35, type: 'zone', where: 'self', zone: { shape: { kind: 'circle', radius: 4.5 }, delay: 0, duration: 0, hit: { mult: 0, knock: 7, stagger: 160 }, visual: 'warcry' } },
      { at: 0.35, type: 'buff', status: 'rage', duration: 8, target: 'self' },
    ],
    aim: 'self',
  },
  {
    id: 'blink', name: 'Blink', desc: 'Teleport a short distance toward the target point.', icon: 'blink',
    tags: ['spell', 'movement'], kind: 'spell', cost: 6, cooldown: 1.6, time: 0.28, anim: { clip: 'Spell_Simple_Enter' },
    motion: { kind: 'blink', from: 0.5, to: 0.5, distance: 7.5, toAim: true }, iframes: [0.3, 0.6], cancelAfter: 0.55, range: 7.5,
    effects: [], aim: 'target', color: '#a98bff',
  },
  {
    id: 'bladevortex', name: 'Blade Vortex', desc: 'Conjure blades that orbit you, cutting nearby enemies.', icon: 'vortex',
    tags: ['spell', 'area', 'physical'], kind: 'spell', base: { physical: [4, 7] }, cost: 12, cooldown: 4, time: 0.4,
    anim: { clip: 'Spell_Simple_Enter' }, cancelAfter: 0.5, range: 2.5,
    effects: [{ at: 0.5, type: 'zone', where: 'self', zone: { shape: { kind: 'ring', radius: 2.3, width: 1.4 }, delay: 0, duration: 7, tick: 0.3, follow: true, tickMult: 1, hit: { stagger: 10, ailments: { bleed: 10 } }, visual: 'vortex' } }],
    aim: 'self',
  },
  {
    id: 'meteor', name: 'Meteor', desc: 'Call a meteor down on the target area after a short delay. Leaves burning ground.', icon: 'meteor',
    tags: ['spell', 'area', 'fire'], kind: 'spell', base: { fire: [30, 46] }, cost: 18, cooldown: 5, time: 0.6,
    anim: { clip: 'Spell_Simple_Enter' }, cancelAfter: 0.7, range: 11, color: '#ff6a2a',
    effects: [{ at: 0.6, type: 'zone', where: 'aim', zone: { shape: { kind: 'circle', radius: 3.1 }, delay: 0.85, duration: 3, tick: 0.5, tickMult: 0.12, hit: { knock: 6, stagger: 180, heavy: true, ailments: { ignite: 50 } }, visual: 'meteor' } }],
    aim: 'target',
  },
  {
    id: 'venomcloud', name: 'Venom Cloud', desc: 'Toxic cloud that poisons everything inside.', icon: 'venom',
    tags: ['spell', 'area', 'chaos', 'dot'], kind: 'spell', base: { chaos: [3, 5] }, cost: 10, time: 0.42, anim: { clip: 'Spell_Simple_Shoot' },
    cancelAfter: 0.6, range: 10, color: '#8fe36a',
    effects: [{ at: 0.45, type: 'zone', where: 'aim', zone: { shape: { kind: 'circle', radius: 3 }, delay: 0.2, duration: 5, tick: 0.5, tickMult: 1, slow: 15, hit: { ailments: { poison: 100 } }, visual: 'venom' } }],
    aim: 'target',
  },
  {
    id: 'spiritwolves', name: 'Spirit Wolves', desc: 'Summon two spectral wolves that hunt beside you.', icon: 'wolves',
    tags: ['spell', 'minion'], kind: 'spell', cost: 20, cooldown: 14, time: 0.55, anim: { clip: 'Spell_Simple_Enter' }, cancelAfter: 0.6, range: 6,
    effects: [{ at: 0.6, type: 'summon', monster: 'spirit_wolf', count: 2, duration: 22 }],
    aim: 'self', color: '#9fd9ff',
  },
  {
    id: 'icespear', name: 'Ice Spear', desc: 'A piercing lance of ice that chills and splits on its last hit.', icon: 'icespear',
    tags: ['spell', 'projectile', 'cold'], kind: 'spell', base: { cold: [10, 15] }, cost: 8, time: 0.4, anim: { clip: 'Spell_Simple_Shoot' },
    cancelAfter: 0.6, range: 14, color: '#bfeaff',
    effects: [{ at: 0.45, type: 'projectile', projectile: { speed: 22, radius: 0.3, range: 16, pierce: 2, hit: { knock: 2, stagger: 35, ailments: { chill: 60, freeze: 10 } }, visual: 'icespear' } }],
    aim: 'target',
  },
];

// ---------------------------------------------------------------- monster skills

const SLAM: ZoneSpec = { shape: { kind: 'circle', radius: 2.6 }, delay: 0.7, duration: 0, hit: { knock: 6, stagger: 100, heavy: true }, visual: 'slam' };

export const MONSTER_SKILLS: SkillDef[] = [
  {
    id: 'm_scratch', name: 'Scratch', desc: 'Clawing swipe.', icon: 'claw', tags: ['attack', 'melee'], kind: 'attack', base: { physical: [3, 5] },
    time: 1.0, anim: { clip: 'Zombie_Scratch', from: 0.2, to: 1.5 }, pose: 'claw', range: 1.7, aim: 'target', elemental: 0.5,
    effects: [{ at: 0.48, type: 'strike', shape: { kind: 'cone', radius: 1.9, arc: 100 }, hit: { knock: 2, stagger: 30 } }],
  },
  {
    id: 'm_slash', name: 'Slash', desc: 'Quick sword cut.', icon: 'slash', tags: ['attack', 'melee'], kind: 'attack', base: { physical: [3, 6] },
    time: 0.7, anim: { clip: 'Sword_Regular_A' }, motion: { kind: 'lunge', from: 0, to: 0.4, speed: 2 }, pose: 'claw', range: 1.9, aim: 'target', elemental: 0.5,
    effects: [{ at: 0.58, type: 'strike', shape: { kind: 'cone', radius: 2.1, arc: 100 }, hit: { knock: 2, stagger: 30 } }],
  },
  {
    id: 'm_bite', name: 'Bite', desc: 'Lunging bite.', icon: 'bite', tags: ['attack', 'melee'], kind: 'attack', base: { physical: [3, 6] },
    time: 0.75, anim: { clip: 'Melee_Hook' }, motion: { kind: 'lunge', from: 0.2, to: 0.5, speed: 4 }, pose: 'bite', range: 1.8, aim: 'target', elemental: 0.5,
    effects: [{ at: 0.5, type: 'strike', shape: { kind: 'cone', radius: 1.9, arc: 80 }, hit: { knock: 2.5, stagger: 30, ailments: { bleed: 10 } } }],
  },
  {
    id: 'm_punch', name: 'Pound', desc: 'Heavy punch.', icon: 'punch', tags: ['attack', 'melee'], kind: 'attack', base: { physical: [6, 9] },
    time: 1.0, anim: { clip: 'Punch_Cross' }, pose: 'slam', range: 2.1, aim: 'target', elemental: 0.5,
    effects: [{ at: 0.36, type: 'strike', shape: { kind: 'cone', radius: 2.4, arc: 90 }, hit: { knock: 6, stagger: 70, heavy: true } }],
  },
  {
    id: 'm_heavy', name: 'Overhead Smash', desc: 'Telegraphed overhead blow.', icon: 'cleave', tags: ['attack', 'melee', 'area'], kind: 'attack',
    base: { physical: [9, 13] }, cooldown: 3, time: 1.3, anim: { clip: 'Sword_Attack' }, pose: 'slam', range: 2.6, aim: 'target', elemental: 0.5,
    effects: [{ at: 0.32, type: 'strike', telegraph: true, shape: { kind: 'cone', radius: 3.2, arc: 110 }, hit: { knock: 7, stagger: 120, heavy: true } }],
  },
  {
    id: 'm_slam', name: 'Ground Slam', desc: 'Telegraphed slam around itself.', icon: 'slam', tags: ['attack', 'melee', 'area'], kind: 'attack',
    base: { physical: [10, 15] }, cooldown: 5, time: 1.2, anim: { clip: 'Sword_Attack' }, pose: 'slam', range: 2.4, aim: 'self', elemental: 0.5,
    effects: [{ at: 0.05, type: 'zone', where: 'self', zone: SLAM }],
  },
  {
    id: 'm_bolt', name: 'Bolt', desc: 'Elemental bolt.', icon: 'fireball', tags: ['spell', 'projectile'], kind: 'spell', base: { fire: [4, 7] },
    cooldown: 1.6, time: 0.9, anim: { clip: 'Spell_Simple_Shoot' }, pose: 'cast', range: 9, aim: 'target', usesElement: true,
    effects: [{ at: 0.62, type: 'projectile', projectile: { speed: 10, radius: 0.3, range: 13, hit: { knock: 2, stagger: 30, ailments: { ignite: 10, chill: 30, shock: 10 } }, visual: 'bolt' } }],
  },
  {
    id: 'm_arrow', name: 'Shoot', desc: 'Fast physical projectile.', icon: 'knives', tags: ['attack', 'projectile'], kind: 'attack', base: { physical: [3, 6] },
    cooldown: 1.1, time: 0.8, anim: { clip: 'Pistol_Shoot' }, pose: 'spit', range: 10, aim: 'target', elemental: 0.3,
    effects: [{ at: 0.5, type: 'projectile', projectile: { speed: 17, radius: 0.22, range: 14, hit: { knock: 1.5, stagger: 20 }, visual: 'arrow' } }],
  },
  {
    id: 'm_spit', name: 'Spit', desc: 'Lobbed glob that leaves a burning puddle.', icon: 'venom', tags: ['spell', 'projectile', 'area'], kind: 'spell',
    base: { chaos: [4, 6] }, cooldown: 2.4, time: 0.9, anim: { clip: 'OverhandThrow' }, pose: 'spit', range: 8, aim: 'target', usesElement: true,
    effects: [{
      at: 0.5, type: 'projectile', projectile: {
        speed: 9, radius: 0.3, range: 10, lob: true, explode: 1.4, hit: { stagger: 20, ailments: { poison: 40, ignite: 20 } }, visual: 'spit',
        leaves: { shape: { kind: 'circle', radius: 1.4 }, delay: 0, duration: 3, tick: 0.5, tickMult: 0.25, slow: 20, visual: 'puddle' },
      },
    }],
  },
  {
    id: 'm_charge', name: 'Charge', desc: 'Telegraphed charge in a straight line.', icon: 'charge', tags: ['attack', 'melee', 'movement'], kind: 'attack',
    base: { physical: [8, 12] }, cooldown: 5, time: 1.4, anim: [{ clip: 'Idle_Shield_Break', span: 0.45 }, { clip: 'Shield_Dash', from: 0, to: 0.9, span: 0.55 }],
    pose: 'charge', motion: { kind: 'dash', from: 0.45, to: 0.85, distance: 9 }, range: 8, aim: 'target', elemental: 0.5,
    effects: [
      { at: 0, type: 'strike', telegraph: true, shape: { kind: 'line', length: 9.5, width: 1.6 }, hit: { mult: 0 } },
      { at: 0.45, type: 'sweep', until: 0.88, radius: 1.2, hit: { knock: 9, stagger: 150, heavy: true } },
    ],
  },
  {
    id: 'm_nova', name: 'Nova', desc: 'Telegraphed elemental burst around the caster.', icon: 'nova', tags: ['spell', 'area'], kind: 'spell',
    base: { cold: [7, 10] }, cooldown: 6, time: 1.1, anim: { clip: 'Spell_Simple_Idle_Loop', from: 0, to: 1.1 }, pose: 'roar', range: 3.5, aim: 'self', usesElement: true,
    effects: [{ at: 0.05, type: 'zone', where: 'self', zone: { shape: { kind: 'circle', radius: 4 }, delay: 0.85, duration: 0, hit: { knock: 5, stagger: 80, ailments: { chill: 60, ignite: 30, shock: 30 } }, visual: 'nova' } }],
  },
  {
    id: 'm_groundfire', name: 'Hex Ground', desc: 'Curses the ground under the target.', icon: 'meteor', tags: ['spell', 'area'], kind: 'spell',
    base: { fire: [8, 12] }, cooldown: 4, time: 0.9, anim: { clip: 'Spell_Simple_Enter' }, pose: 'cast', range: 10, aim: 'target', usesElement: true,
    effects: [{ at: 0.5, type: 'zone', where: 'aim', zone: { shape: { kind: 'circle', radius: 2.2 }, delay: 1.0, duration: 2.5, tick: 0.5, tickMult: 0.2, hit: { stagger: 60, ailments: { ignite: 40, chill: 40, shock: 30 } }, visual: 'hex' } }],
  },
  {
    id: 'm_leap', name: 'Pounce', desc: 'Leaps onto the target with a telegraphed landing.', icon: 'leap', tags: ['attack', 'melee', 'area', 'movement'], kind: 'attack',
    base: { physical: [8, 12] }, cooldown: 5, time: 1.3,
    anim: [{ clip: 'NinjaJump_Start', from: 0, to: 0.62, span: 0.6 }, { clip: 'NinjaJump_Land', from: 0, to: 0.7, span: 0.4 }],
    pose: 'leap', motion: { kind: 'leap', from: 0.25, to: 0.6, distance: 8, toAim: true, ghost: true, height: 2.2 }, range: 7, aim: 'target', elemental: 0.5,
    effects: [{ at: 0.1, type: 'zone', where: 'aim', zone: { shape: { kind: 'circle', radius: 2.2 }, delay: 0.65, duration: 0, hit: { knock: 6, stagger: 100, heavy: true }, visual: 'slam' } }],
  },
  {
    id: 'm_explode', name: 'Self Destruct', desc: 'Swells up and bursts.', icon: 'burst', tags: ['attack', 'area'], kind: 'attack',
    base: { fire: [14, 20] }, time: 0.9, anim: { clip: 'Hit_Knockback' }, pose: 'burst', range: 1.6, aim: 'self', usesElement: true,
    effects: [
      { at: 0.0, type: 'zone', where: 'self', zone: { shape: { kind: 'circle', radius: 2.6 }, delay: 0.85, duration: 0, hit: { knock: 8, stagger: 120, heavy: true, ailments: { ignite: 30 } }, visual: 'burst' } },
      { at: 0.97, type: 'selfDestruct' },
    ],
  },
  {
    id: 'm_summon', name: 'Raise Minions', desc: 'Summons a few minions.', icon: 'wolves', tags: ['spell', 'minion'], kind: 'spell', cooldown: 9, time: 1.2,
    anim: { clip: 'Spell_Simple_Idle_Loop', from: 0, to: 1.2 }, pose: 'roar', range: 9, aim: 'self',
    effects: [{ at: 0.7, type: 'summon', monster: 'minion', count: 3, duration: 30 }],
  },
  {
    id: 'm_ward', name: 'Ward Allies', desc: 'Empowers nearby allies.', icon: 'warcry', tags: ['spell', 'aura'], kind: 'spell', cooldown: 7, time: 1.0,
    anim: { clip: 'Spell_Simple_Enter' }, pose: 'roar', range: 8, aim: 'self',
    effects: [{ at: 0.6, type: 'buff', status: 'empowered', duration: 6, target: 'allies', radius: 9 }],
  },
  {
    id: 'm_mend', name: 'Mend', desc: 'Heals nearby allies.', icon: 'heal', tags: ['spell', 'aura'], kind: 'spell', cooldown: 6, time: 1.0,
    anim: { clip: 'Spell_Simple_Enter' }, pose: 'cast', range: 8, aim: 'self',
    effects: [{ at: 0.6, type: 'heal', pct: 18, target: 'allies', radius: 9 }],
  },
  {
    id: 'm_spray', name: 'Spray', desc: 'Fan of bolts.', icon: 'knives', tags: ['spell', 'projectile'], kind: 'spell', base: { cold: [4, 6] }, cooldown: 3,
    time: 1.0, anim: { clip: 'Spell_Simple_Shoot' }, pose: 'spit', range: 9, aim: 'target', usesElement: true,
    effects: [{ at: 0.55, type: 'projectile', count: 5, spread: 70, projectile: { speed: 9, radius: 0.28, range: 12, hit: { stagger: 20, ailments: { chill: 30, ignite: 15, shock: 15 } }, visual: 'bolt' } }],
  },
  // ---- boss modules (bigger, telegraphed)
  {
    id: 'b_quake', name: 'Quake', desc: 'Three expanding rings of shockwaves.', icon: 'slam', tags: ['attack', 'area'], kind: 'attack', base: { physical: [12, 18] },
    cooldown: 7, time: 1.8, anim: { clip: 'Sword_Attack' }, pose: 'slam', range: 6, aim: 'self', elemental: 0.5,
    effects: [
      { at: 0.05, type: 'zone', where: 'self', zone: { shape: { kind: 'circle', radius: 3 }, delay: 0.75, duration: 0, hit: { knock: 6, stagger: 100, heavy: true }, visual: 'slam' } },
      { at: 0.35, type: 'zone', where: 'self', zone: { shape: { kind: 'ring', radius: 5, width: 2 }, delay: 0.6, duration: 0, hit: { knock: 6, stagger: 100 }, visual: 'ring' } },
      { at: 0.6, type: 'zone', where: 'self', zone: { shape: { kind: 'ring', radius: 7.5, width: 2 }, delay: 0.6, duration: 0, hit: { knock: 6, stagger: 100 }, visual: 'ring' } },
    ],
  },
  {
    id: 'b_barrage', name: 'Barrage', desc: 'Spiral of projectiles.', icon: 'fireball', tags: ['spell', 'projectile'], kind: 'spell', base: { fire: [6, 9] },
    cooldown: 8, time: 2.0, anim: { clip: 'Spell_Simple_Idle_Loop', from: 0, to: 2 }, pose: 'cast', range: 11, aim: 'target', usesElement: true,
    effects: [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((at, i) => ({
      at, type: 'projectile' as const, count: 6, spread: 300 + i * 9,
      projectile: { speed: 7.5, radius: 0.35, range: 16, hit: { stagger: 30, ailments: { ignite: 15, chill: 20, shock: 15 } }, visual: 'bolt' },
    })),
  },
  {
    id: 'b_meteors', name: 'Meteor Rain', desc: 'Meteors rain around the arena.', icon: 'meteor', tags: ['spell', 'area'], kind: 'spell', base: { fire: [14, 20] },
    cooldown: 10, time: 1.4, anim: { clip: 'Spell_Simple_Enter' }, pose: 'roar', range: 12, aim: 'target', usesElement: true,
    effects: [{ at: 0.4, type: 'zone', where: 'aim', count: 7, scatter: 6, zone: { shape: { kind: 'circle', radius: 1.9 }, delay: 1.1, duration: 2, tick: 0.5, tickMult: 0.15, hit: { knock: 4, stagger: 80, ailments: { ignite: 40 } }, visual: 'meteor' } }],
  },
  {
    id: 'b_sweep', name: 'Great Sweep', desc: 'A huge telegraphed frontal sweep.', icon: 'cleave', tags: ['attack', 'melee', 'area'], kind: 'attack',
    base: { physical: [16, 22] }, cooldown: 4, time: 1.5, anim: { clip: 'Sword_Attack' }, pose: 'claw', range: 4.5, aim: 'target', elemental: 0.5,
    effects: [{ at: 0.3, type: 'strike', telegraph: true, shape: { kind: 'cone', radius: 5.5, arc: 160 }, hit: { knock: 9, stagger: 150, heavy: true } }],
  },
];

/** Internal skills used by monster affixes and level mechanics (never chosen by AI). */
export const INTERNAL_SKILLS: SkillDef[] = [
  { id: 'a_molten', name: 'Molten Ground', desc: 'Burning trail.', icon: 'meteor', tags: ['spell', 'area', 'fire'], kind: 'spell', base: { fire: [2, 3] }, time: 0.1, anim: { clip: 'Idle_Loop' }, effects: [], range: 0, aim: 'self', color: '#ff6a2a' },
  { id: 'a_frost', name: 'Frost Pulse', desc: 'Freezing burst.', icon: 'nova', tags: ['spell', 'area', 'cold'], kind: 'spell', base: { cold: [6, 9] }, time: 0.1, anim: { clip: 'Idle_Loop' }, effects: [], range: 0, aim: 'self', color: '#8fd8ff' },
  { id: 'a_burst', name: 'Death Burst', desc: 'Explodes on death.', icon: 'burst', tags: ['spell', 'area'], kind: 'spell', base: { fire: [10, 14] }, time: 0.1, anim: { clip: 'Idle_Loop' }, effects: [], range: 0, aim: 'self', usesElement: true },
  { id: 'a_explode', name: 'Corpse Explosion', desc: 'Corpses burst.', icon: 'burst', tags: ['spell', 'area', 'fire'], kind: 'spell', base: { fire: [6, 10] }, time: 0.1, anim: { clip: 'Idle_Loop' }, effects: [], range: 0, aim: 'self', color: '#ff8a3d' },
  { id: 'env', name: 'Environment', desc: 'Traps, kegs, vents and other level mechanics.', icon: 'burst', tags: ['area'], kind: 'spell', base: { physical: [8, 12] }, time: 0.1, anim: { clip: 'Idle_Loop' }, effects: [], range: 0, aim: 'self' },
];

export const SKILLS: Record<string, SkillDef> = Object.fromEntries([...HERO_SKILLS, ...MONSTER_SKILLS, ...INTERNAL_SKILLS].map((s) => [s.id, s]));

/** Skills the hero can slot (unlocked through the passive tree; Slash is always known). */
export const HOTBAR_SKILLS = HERO_SKILLS.filter((s) => !s.id.startsWith('slash') && s.id !== 'dodge').map((s) => s.id);

export function skill(id: string): SkillDef {
  const s = SKILLS[id];
  if (!s) throw new Error(`unknown skill "${id}". Known: ${Object.keys(SKILLS).join(', ')}`);
  return s;
}

/** Normalized animation segments covering the whole timeline. */
export function animSegments(s: SkillDef): Array<Required<Pick<AnimSpec, 'clip' | 'span'>> & AnimSpec & { start: number }> {
  const list = Array.isArray(s.anim) ? s.anim : [s.anim];
  const given = list.reduce((a, x) => a + (x.span ?? 0), 0);
  const missing = list.filter((x) => x.span === undefined).length;
  const fill = missing ? Math.max(0, 1 - given) / missing : 0;
  let start = 0;
  return list.map((x) => {
    const span = x.span ?? fill;
    const seg = { ...x, span, start };
    start += span;
    return seg;
  });
}

export const SKILL_NAMES: Record<string, string> = Object.fromEntries(Object.values(SKILLS).map((s) => [s.id, s.name]));
