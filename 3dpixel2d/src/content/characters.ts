/**
 * Character presets: which Quaternius parts make up a character, its clip aliases and stats.
 * Model ids and clip names come from public/assets/manifest.json (`npm run assets`).
 * Agents can list them with `presets` / `clips` and spawn any preset with `spawn`.
 */
export interface AnimSet {
  idle: string;
  walk: string;
  run: string;
  sprint: string;
  push: string;
  jumpStart: string;
  jumpLoop: string;
  jumpLand: string;
  /** Three-hit combo, and the recovery clip played when the combo stops after that hit ('' = none). */
  attack: [string, string, string];
  recover: [string, string, string];
  hit: string;
  hitHeavy: string;
  death: string;
}

export const DEFAULT_ANIMS: AnimSet = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  push: 'Push_Loop',
  jumpStart: 'Jump_Start',
  jumpLoop: 'Jump_Loop',
  jumpLand: 'Jump_Land',
  attack: ['Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C'],
  recover: ['Sword_Regular_A_Rec', 'Sword_Regular_B_Rec', ''],
  hit: 'Hit_Chest',
  hitHeavy: 'Hit_Knockback',
  death: 'Death01',
};

export interface AttackStep {
  /** Fraction of the clip at which the hit lands. */
  impact: number;
  damage: number;
  /** Knockback speed given to the target, m/s. */
  knock: number;
  range: number;
  arcDeg: number;
  /** Forward step during the first 40% of the swing, m/s. */
  lunge: number;
  heavy: boolean;
}

export const ATTACKS: [AttackStep, AttackStep, AttackStep] = [
  { impact: 0.5, damage: 1, knock: 3, range: 1.8, arcDeg: 80, lunge: 1.6, heavy: false },
  { impact: 0.45, damage: 1, knock: 3, range: 1.8, arcDeg: 80, lunge: 1.2, heavy: false },
  { impact: 0.3, damage: 2, knock: 6.5, range: 2.0, arcDeg: 120, lunge: 1.4, heavy: true },
];

export interface Preset {
  label: string;
  /** Model id of the body (an outfit or a mannequin). */
  base: string;
  /** Extra skinned parts rebound to the base skeleton (heads, hair, beards). */
  parts: string[];
  /** Material name -> color. Replaces the material's color (textures are kept). */
  tint?: Record<string, string>;
  weapon?: 'sword';
  hp: number;
  anims?: Partial<AnimSet>;
}

export const PRESETS: Record<string, Preset> = {
  ranger: { label: 'Ranger (player)', base: 'outfit_ranger_m', parts: ['head_m'], weapon: 'sword', hp: 10 },
  ranger_f: { label: 'Ranger, female', base: 'outfit_ranger_f', parts: ['head_f'], weapon: 'sword', hp: 10 },
  villager: { label: 'Villager', base: 'outfit_peasant_f', parts: ['head_f', 'hair_buns'], hp: 3 },
  farmer: { label: 'Farmer', base: 'outfit_peasant_m', parts: ['head_m', 'hair_parted', 'hair_beard'], hp: 3 },
  dummy: {
    label: 'Training dummy',
    base: 'mannequin_m',
    parts: [],
    tint: { M_Main: '#c8a06a', M_Joints: '#7a4f33' },
    hp: 5,
  },
  mannequin_f: { label: 'Female mannequin', base: 'mannequin_f', parts: [], tint: { M_Main: '#9fb4c8', M_Joints: '#4f5f7a' }, hp: 5 },
};

export function animsOf(preset: string): AnimSet {
  return { ...DEFAULT_ANIMS, ...(PRESETS[preset]?.anims ?? {}) };
}
