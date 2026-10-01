/**
 * Humanoid presets: which Quaternius parts make up a character, its clip aliases and stats.
 * Model ids and clip names come from public/assets/manifest.json (`npm run assets`).
 * Agents can list them with `presets` / `clips` and spawn any preset with `spawn`.
 *
 * `slots` says which materials a monster palette recolors (primary body, secondary trim, glow),
 * so any humanoid body can wear any palette: the same rig becomes an ember cultist or a frost one.
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
  /** Plays while staggered / frozen. */
  stun: string;
  /** Idle variant while talking (NPCs). */
  talk: string;
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
  stun: 'Hit_Head',
  talk: 'Idle_Talking_Loop',
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

/** Legacy sandbox combo (training room); ARPG combat uses content/skills.ts. */
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
  /** Material name -> emissive color (glowing joints, eyes). */
  glow?: Record<string, string>;
  /** Materials recolored by monster palettes. */
  slots?: { primary?: string[]; secondary?: string[]; glow?: string[] };
  weapon?: 'sword' | 'staff' | 'cleaver' | 'none';
  hp: number;
  anims?: Partial<AnimSet>;
}

const ZOMBIE: Partial<AnimSet> = { idle: 'Zombie_Idle_Loop', walk: 'Zombie_Walk_Fwd_Loop', run: 'Zombie_Walk_Fwd_Loop', sprint: 'Zombie_Walk_Fwd_Loop' };
const CASTER: Partial<AnimSet> = { idle: 'Spell_Simple_Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop' };
const SWORD: Partial<AnimSet> = { idle: 'Sword_Idle' };
const MANNEQUIN = { primary: ['M_Main'], glow: ['M_Joints'] };

export const PRESETS: Record<string, Preset> = {
  ranger: { label: 'Ranger (hero)', base: 'outfit_ranger_m', parts: ['head_m'], weapon: 'sword', hp: 10, anims: SWORD },
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

  // ---- monsters (palettes recolor the slot materials)
  hollow: { label: 'Hollow', base: 'mannequin_m', parts: [], tint: { M_Main: '#d8cfb6', M_Joints: '#3b302a' }, slots: MANNEQUIN, hp: 4, anims: ZOMBIE },
  hollow_brute: { label: 'Hollow brute', base: 'mannequin_m', parts: [], tint: { M_Main: '#b8ad94', M_Joints: '#3b302a' }, slots: MANNEQUIN, hp: 8, anims: { ...ZOMBIE, run: 'Walk_Loop' } },
  thrall: { label: 'Thrall', base: 'mannequin_f', parts: [], tint: { M_Main: '#cfc6b0', M_Joints: '#3b302a' }, slots: MANNEQUIN, hp: 3, anims: ZOMBIE },
  brigand: { label: 'Brigand', base: 'outfit_ranger_f', parts: ['head_f'], tint: { MI_Ranger: '#c46a6a' }, slots: { primary: ['MI_Ranger'] }, weapon: 'sword', hp: 6, anims: SWORD },
  marksman: { label: 'Marksman', base: 'outfit_ranger_m', parts: ['head_m'], tint: { MI_Ranger: '#9a7a5a' }, slots: { primary: ['MI_Ranger'] }, weapon: 'none', hp: 5, anims: { idle: 'Pistol_Idle_Loop' } },
  cultist: { label: 'Cultist', base: 'outfit_peasant_m', parts: ['head_m', 'hair_buzzed'], tint: { MI_Peasant: '#7a3a3a' }, slots: { primary: ['MI_Peasant'] }, weapon: 'staff', hp: 5, anims: CASTER },
  hexer: { label: 'Hexer', base: 'outfit_peasant_f', parts: ['head_f', 'hair_long'], tint: { MI_Peasant: '#4a3a6a' }, slots: { primary: ['MI_Peasant'] }, weapon: 'staff', hp: 5, anims: CASTER },
  mender: { label: 'Mender', base: 'outfit_peasant_f', parts: ['head_f', 'hair_buns'], tint: { MI_Peasant: '#5a7a4a' }, slots: { primary: ['MI_Peasant'] }, weapon: 'staff', hp: 5, anims: CASTER },
  warden: { label: 'Warden', base: 'outfit_ranger_m', parts: ['head_m', 'hair_beard'], tint: { MI_Ranger: '#9aa0aa' }, slots: { primary: ['MI_Ranger'] }, weapon: 'sword', hp: 8, anims: { idle: 'Idle_Shield_Loop' } },
  golem: { label: 'Golem', base: 'mannequin_m', parts: [], tint: { M_Main: '#7a7f8a', M_Joints: '#2a2a30' }, glow: { M_Joints: '#ff9a3d' }, slots: MANNEQUIN, hp: 12, anims: { run: 'Walk_Loop', sprint: 'Walk_Loop' } },
  bombling: { label: 'Bombling', base: 'mannequin_f', parts: [], tint: { M_Main: '#3a2a22', M_Joints: '#1a1210' }, glow: { M_Joints: '#ff8a3d' }, slots: MANNEQUIN, hp: 2, anims: { run: 'Sprint_Loop' } },
  reaver: { label: 'Reaver', base: 'outfit_ranger_m', parts: ['head_m'], tint: { MI_Ranger: '#4a4a56' }, slots: { primary: ['MI_Ranger'] }, weapon: 'cleaver', hp: 8, anims: SWORD },
  shade: { label: 'Shade', base: 'mannequin_f', parts: [], tint: { M_Main: '#2a3550', M_Joints: '#10183a' }, glow: { M_Joints: '#9fd9ff' }, slots: MANNEQUIN, weapon: 'sword', hp: 5, anims: { run: 'Sprint_Loop', idle: 'Sword_Idle' } },
  boss_golem: { label: 'Kegmaster Grull', base: 'mannequin_m', parts: [], tint: { M_Main: '#5a4a44', M_Joints: '#2a1a14' }, glow: { M_Joints: '#ff7a2a' }, slots: MANNEQUIN, hp: 50, anims: { run: 'Walk_Loop', sprint: 'Walk_Loop' } },
  boss_cult: { label: 'Hierophant Vael', base: 'outfit_peasant_m', parts: ['head_m', 'hair_long', 'hair_beard'], tint: { MI_Peasant: '#3a2050' }, slots: { primary: ['MI_Peasant'] }, weapon: 'staff', hp: 50, anims: CASTER },
  boss_reaver: { label: 'Sir Corvane', base: 'outfit_ranger_m', parts: ['head_m', 'hair_beard'], tint: { MI_Ranger: '#5a1a22' }, slots: { primary: ['MI_Ranger'] }, weapon: 'cleaver', hp: 50, anims: SWORD },

  // ---- town
  smith: { label: 'Blacksmith', base: 'outfit_peasant_m', parts: ['head_m', 'hair_buzzed', 'hair_beard'], tint: { MI_Peasant: '#6a5a4a' }, hp: 10 },
  merchant: { label: 'Merchant', base: 'outfit_peasant_f', parts: ['head_f', 'hair_buns'], tint: { MI_Peasant: '#8a5a7a' }, hp: 10 },
  sage: { label: 'Sage', base: 'outfit_peasant_m', parts: ['head_m', 'hair_long', 'hair_beard'], tint: { MI_Peasant: '#3a4a7a' }, weapon: 'staff', hp: 10, anims: { idle: 'Spell_Simple_Idle_Loop' } },
  keeper: { label: 'Stash keeper', base: 'outfit_ranger_f', parts: ['head_f'], tint: { MI_Ranger: '#4a6a5a' }, hp: 10, anims: { idle: 'Idle_FoldArms_Loop' } },
  guard: { label: 'Town guard', base: 'outfit_ranger_m', parts: ['head_m', 'hair_beard'], tint: { MI_Ranger: '#5a5a6a' }, weapon: 'sword', hp: 10, anims: { idle: 'Idle_Shield_Loop' } },
  child: { label: 'Villager child', base: 'outfit_peasant_f', parts: ['head_f', 'hair_buzzed_f'], tint: { MI_Peasant: '#a07a4a' }, hp: 3 },
};

export function animsOf(preset: string): AnimSet {
  return { ...DEFAULT_ANIMS, ...(PRESETS[preset]?.anims ?? {}) };
}
