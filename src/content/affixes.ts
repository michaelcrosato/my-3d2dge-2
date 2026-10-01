/**
 * Item affixes (PoE-style prefixes and suffixes). Each affix is one stat line with a weight, the
 * slots it can roll on, an exclusivity group and a value range at tier 1. Tiers come from item
 * level and never stop: flat values ride the power/defense curves, percentages grow by tier with a
 * soft cap, so item level 400 still rolls meaningfully better numbers than item level 300.
 *
 * `local` affixes on weapons modify the weapon itself (its base damage, speed, crit) instead of
 * every skill; local affixes on armour modify that piece's armour/evasion.
 */
import type { SlotKind } from './items';
import type { ModKind, StatId, Tag } from './stats';

export type AffixScale = 'power' | 'defense' | 'tier' | 'fixed';

export interface AffixDef {
  id: string;
  kind: 'prefix' | 'suffix';
  /** Magic item name part: prefix word ("Heated") or suffix ("of the Bear"). */
  word: string;
  slots: SlotKind[];
  weight: number;
  stat: StatId;
  mod: ModKind;
  tags?: Tag[];
  range: [number, number];
  /** Upper roll range for "Adds X to Y" affixes. */
  range2?: [number, number];
  scale: AffixScale;
  local?: 'weaponPhys' | 'weaponAdded' | 'weaponSpeed' | 'weaponCrit' | 'defence';
  group: string;
  minLevel?: number;
}

const WEAPON: SlotKind[] = ['weapon'];
const JEWELRY: SlotKind[] = ['ring', 'amulet'];
const ARMOUR: SlotKind[] = ['helmet', 'chest', 'gloves', 'boots', 'offhand'];
const ALL_GEAR: SlotKind[] = ['weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring'];
const DEF_GEAR: SlotKind[] = ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring'];

const P = (id: string, word: string, slots: SlotKind[], weight: number, stat: StatId, mod: ModKind, range: [number, number], scale: AffixScale, group: string, extra: Partial<AffixDef> = {}): AffixDef =>
  ({ id, kind: 'prefix', word, slots, weight, stat, mod, range, scale, group, ...extra });
const S = (id: string, word: string, slots: SlotKind[], weight: number, stat: StatId, mod: ModKind, range: [number, number], scale: AffixScale, group: string, extra: Partial<AffixDef> = {}): AffixDef =>
  ({ id, kind: 'suffix', word, slots, weight, stat, mod, range, scale, group, ...extra });

export const AFFIXES: AffixDef[] = [
  // ---- weapon-local prefixes
  P('w_phys', 'Heavy', WEAPON, 100, 'damage', 'inc', [25, 49], 'tier', 'w_phys', { local: 'weaponPhys' }),
  P('w_added_phys', 'Glinting', WEAPON, 90, 'addedPhysical', 'flat', [1, 3], 'power', 'w_added_phys', { range2: [4, 7], local: 'weaponAdded' }),
  P('w_added_fire', 'Heated', WEAPON, 70, 'addedFire', 'flat', [2, 4], 'power', 'w_added_fire', { range2: [5, 9], local: 'weaponAdded' }),
  P('w_added_cold', 'Frosted', WEAPON, 70, 'addedCold', 'flat', [2, 3], 'power', 'w_added_cold', { range2: [5, 8], local: 'weaponAdded' }),
  P('w_added_lightning', 'Humming', WEAPON, 70, 'addedLightning', 'flat', [1, 1], 'power', 'w_added_lightning', { range2: [8, 13], local: 'weaponAdded' }),
  P('w_spell', 'Apprentice\'s', WEAPON, 60, 'damage', 'inc', [20, 39], 'tier', 'spell_dmg', { tags: ['spell'] }),
  P('w_elemental', 'Prismatic', WEAPON, 40, 'damage', 'inc', [15, 29], 'tier', 'ele_dmg', { tags: ['elemental'] }),
  // ---- weapon-local suffixes
  S('w_speed', 'of Skill', WEAPON, 90, 'attackSpeed', 'inc', [5, 9], 'tier', 'w_speed', { local: 'weaponSpeed' }),
  S('w_crit', 'of Needling', WEAPON, 80, 'critChance', 'inc', [10, 19], 'tier', 'w_crit', { local: 'weaponCrit' }),
  S('w_critmulti', 'of Ire', [...WEAPON, 'amulet'], 60, 'critMulti', 'flat', [10, 19], 'tier', 'critmulti'),
  S('w_leech', 'of the Leech', [...WEAPON, ...JEWELRY], 40, 'lifeLeech', 'flat', [0.4, 0.8], 'fixed', 'leech'),
  S('w_lifehit', 'of Rejuvenation', [...WEAPON, 'gloves', 'ring'], 50, 'lifeOnHit', 'flat', [1, 3], 'defense', 'lifehit'),
  S('w_bleed', 'of Rending', WEAPON, 40, 'bleedChance', 'flat', [10, 20], 'fixed', 'bleed'),
  S('w_ignite', 'of Burning', [...WEAPON, 'gloves'], 40, 'igniteChance', 'flat', [8, 16], 'fixed', 'ignite'),
  S('w_freeze', 'of Rime', [...WEAPON, 'gloves'], 35, 'freezeChance', 'flat', [5, 10], 'fixed', 'freeze'),
  S('w_shock', 'of Static', [...WEAPON, 'gloves'], 40, 'shockChance', 'flat', [8, 16], 'fixed', 'shock'),
  S('w_poison', 'of Venom', [...WEAPON, 'gloves'], 40, 'poisonChance', 'flat', [10, 20], 'fixed', 'poison'),
  S('w_projectiles', 'of Splintering', ['weapon', 'amulet'], 10, 'projectiles', 'flat', [1, 1], 'fixed', 'projectiles', { minLevel: 20 }),
  S('w_area', 'of Reach', ['weapon', 'amulet', 'helmet'], 40, 'area', 'inc', [6, 12], 'tier', 'area'),
  S('w_cast', 'of Talent', ['weapon', 'offhand', 'amulet', 'ring'], 60, 'castSpeed', 'inc', [6, 11], 'tier', 'cast'),
  // ---- global damage prefixes (jewelry, gloves)
  P('g_added_phys', 'Barbed', ['gloves', 'ring', 'amulet'], 60, 'addedPhysical', 'flat', [1, 2], 'power', 'g_added_phys', { range2: [3, 5], tags: ['attack'] }),
  P('g_added_fire', 'Smouldering', ['gloves', 'ring', 'amulet'], 50, 'addedFire', 'flat', [1, 3], 'power', 'g_added_fire', { range2: [4, 6], tags: ['attack'] }),
  P('g_added_cold', 'Chilled', ['gloves', 'ring', 'amulet'], 50, 'addedCold', 'flat', [1, 2], 'power', 'g_added_cold', { range2: [3, 5], tags: ['attack'] }),
  P('g_added_lightning', 'Sparking', ['gloves', 'ring', 'amulet'], 50, 'addedLightning', 'flat', [1, 1], 'power', 'g_added_lightning', { range2: [5, 8], tags: ['attack'] }),
  P('g_spell_fire', 'Kindled', ['amulet', 'ring', 'offhand'], 40, 'addedFire', 'flat', [1, 2], 'power', 'g_spell_fire', { range2: [3, 5], tags: ['spell'] }),
  P('g_spell_cold', 'Glacial', ['amulet', 'ring', 'offhand'], 40, 'addedCold', 'flat', [1, 2], 'power', 'g_spell_cold', { range2: [3, 4], tags: ['spell'] }),
  P('g_spell_lightning', 'Charged', ['amulet', 'ring', 'offhand'], 40, 'addedLightning', 'flat', [1, 1], 'power', 'g_spell_lightning', { range2: [4, 7], tags: ['spell'] }),
  P('g_fire', 'Scorching', [...JEWELRY, 'offhand'], 40, 'damage', 'inc', [10, 19], 'tier', 'fire_dmg', { tags: ['fire'] }),
  P('g_cold', 'Bitter', [...JEWELRY, 'offhand'], 40, 'damage', 'inc', [10, 19], 'tier', 'cold_dmg', { tags: ['cold'] }),
  P('g_lightning', 'Thundering', [...JEWELRY, 'offhand'], 40, 'damage', 'inc', [10, 19], 'tier', 'lightning_dmg', { tags: ['lightning'] }),
  P('g_chaos', 'Malignant', JEWELRY, 30, 'damage', 'inc', [10, 19], 'tier', 'chaos_dmg', { tags: ['chaos'] }),
  P('g_phys', 'Brutal', ['amulet', 'gloves'], 40, 'damage', 'inc', [10, 19], 'tier', 'phys_dmg', { tags: ['physical'] }),
  P('g_spell', 'Mystic', ['amulet', 'offhand', 'ring'], 40, 'damage', 'inc', [10, 19], 'tier', 'spell_dmg', { tags: ['spell'] }),
  P('g_melee', 'Fierce', ['amulet', 'gloves', 'belt'], 40, 'damage', 'inc', [10, 19], 'tier', 'melee_dmg', { tags: ['melee'] }),
  P('g_projectile', 'Fletched', ['amulet', 'gloves', 'ring'], 30, 'damage', 'inc', [10, 19], 'tier', 'proj_dmg', { tags: ['projectile'] }),
  P('g_area', 'Sweeping', ['amulet', 'belt'], 30, 'damage', 'inc', [10, 19], 'tier', 'area_dmg', { tags: ['area'] }),
  P('g_minion', 'Commanding', ['amulet', 'helmet', 'offhand'], 25, 'minionDamage', 'inc', [15, 29], 'tier', 'minion'),
  P('g_dot', 'Lingering', ['amulet', 'ring', 'gloves'], 25, 'damage', 'inc', [12, 22], 'tier', 'dot_dmg', { tags: ['dot'] }),
  // ---- defence prefixes
  P('life', 'Healthy', DEF_GEAR, 140, 'life', 'flat', [10, 19], 'defense', 'life'),
  P('mana', 'Azure', [...JEWELRY, 'helmet', 'gloves', 'boots', 'belt', 'offhand', 'weapon'], 80, 'mana', 'flat', [10, 19], 'defense', 'mana'),
  P('armor', 'Lacquered', ARMOUR, 90, 'armor', 'flat', [8, 15], 'defense', 'armor_flat'),
  P('evasion', 'Agile', ARMOUR, 90, 'evasion', 'flat', [10, 19], 'defense', 'evasion_flat'),
  P('def_pct', 'Reinforced', ARMOUR, 70, 'armor', 'inc', [20, 39], 'tier', 'def_pct', { local: 'defence' }),
  P('life_pct', 'Vigorous', ['chest', 'belt', 'amulet'], 25, 'life', 'inc', [4, 7], 'tier', 'life_pct', { minLevel: 10 }),
  P('regen', 'Mending', [...DEF_GEAR], 50, 'lifeRegen', 'flat', [1, 2], 'defense', 'regen'),
  P('block', 'Bulwark', ['offhand'], 40, 'block', 'flat', [3, 6], 'fixed', 'block'),
  P('fortitude', 'Steadfast', ['chest', 'helmet', 'belt'], 30, 'damageTaken', 'more', [-4, -2], 'fixed', 'dr'),
  // ---- utility suffixes
  S('res_fire', 'of the Salamander', DEF_GEAR, 90, 'resFire', 'flat', [12, 20], 'tier', 'res_fire'),
  S('res_cold', 'of the Seal', DEF_GEAR, 90, 'resCold', 'flat', [12, 20], 'tier', 'res_cold'),
  S('res_lightning', 'of the Grounding', DEF_GEAR, 90, 'resLightning', 'flat', [12, 20], 'tier', 'res_lightning'),
  S('res_chaos', 'of the Lost', DEF_GEAR, 40, 'resChaos', 'flat', [8, 14], 'tier', 'res_chaos'),
  S('str', 'of the Bear', ALL_GEAR, 70, 'str', 'flat', [8, 14], 'tier', 'str'),
  S('dex', 'of the Fox', ALL_GEAR, 70, 'dex', 'flat', [8, 14], 'tier', 'dex'),
  S('int', 'of the Owl', ALL_GEAR, 70, 'int', 'flat', [8, 14], 'tier', 'int'),
  S('g_attack_speed', 'of Haste', ['gloves', 'ring', 'amulet'], 50, 'attackSpeed', 'inc', [5, 8], 'tier', 'g_speed'),
  S('g_crit', 'of Precision', ['ring', 'amulet', 'helmet', 'offhand'], 50, 'critChance', 'inc', [12, 22], 'tier', 'g_crit'),
  S('move', 'of the Gale', ['boots'], 80, 'moveSpeed', 'inc', [8, 14], 'fixed', 'move'),
  S('cdr', 'of Recurrence', ['helmet', 'amulet', 'ring', 'boots'], 30, 'cooldownRecovery', 'inc', [6, 12], 'fixed', 'cdr', { minLevel: 8 }),
  S('rarity', 'of Plunder', ['helmet', 'amulet', 'ring', 'boots', 'gloves'], 40, 'itemRarity', 'flat', [8, 16], 'tier', 'rarity'),
  S('quantity', 'of Abundance', ['amulet', 'ring', 'helmet'], 20, 'itemQuantity', 'flat', [3, 6], 'fixed', 'quantity'),
  S('gold', 'of Avarice', ['ring', 'amulet', 'gloves', 'belt'], 40, 'goldFind', 'flat', [12, 24], 'tier', 'gold'),
  S('manaregen', 'of Clarity', [...JEWELRY, 'helmet', 'offhand', 'weapon'], 50, 'manaRegen', 'inc', [20, 39], 'tier', 'manaregen'),
  S('manakill', 'of Absorption', ['ring', 'amulet', 'weapon', 'gloves'], 40, 'manaOnKill', 'flat', [2, 4], 'tier', 'manakill'),
  S('lifekill', 'of Feasting', ['ring', 'amulet', 'weapon', 'belt'], 40, 'lifeOnKill', 'flat', [3, 6], 'defense', 'lifekill'),
  S('stun', 'of Composure', ['chest', 'helmet', 'boots', 'belt'], 30, 'stunThreshold', 'inc', [20, 35], 'fixed', 'stun'),
  S('flask', 'of Refilling', ['belt'], 50, 'flaskCharges', 'inc', [15, 30], 'fixed', 'flask'),
  S('flaskfx', 'of the Brewer', ['belt'], 40, 'flaskEffect', 'inc', [10, 20], 'fixed', 'flaskfx'),
  S('ailfx', 'of Torment', ['amulet', 'gloves', 'ring'], 30, 'ailmentEffect', 'inc', [10, 20], 'tier', 'ailfx'),
  S('pierce', 'of Piercing', ['gloves', 'amulet'], 20, 'pierce', 'flat', [1, 1], 'fixed', 'pierce', { minLevel: 12 }),
  S('light', 'of Radiance', ['helmet', 'amulet', 'offhand'], 25, 'lightRadius', 'inc', [15, 30], 'fixed', 'light'),
  S('xp', 'of Learning', ['amulet', 'helmet'], 10, 'xpGain', 'inc', [3, 6], 'fixed', 'xp', { minLevel: 15 }),
];

export const AFFIX_BY_ID: Record<string, AffixDef> = Object.fromEntries(AFFIXES.map((a) => [a.id, a]));

/** Tier from item level: unbounded, a new tier every 8 levels. */
export const tierOf = (ilvl: number) => 1 + Math.floor(Math.max(0, ilvl - 1) / 8);

/** Percent-style growth per tier with a soft cap past tier 10. */
export function tierFactor(tier: number): number {
  return 1 + 0.25 * (Math.min(tier, 10) - 1) + 0.05 * Math.max(0, tier - 10);
}

export const RARE_PREFIX = ['Dread', 'Storm', 'Grim', 'Rune', 'Blood', 'Ghoul', 'Skull', 'Dusk', 'Ember', 'Frost', 'Hate', 'Morbid', 'Pandemonium', 'Rapture', 'Sol', 'Viper', 'Wrath', 'Corpse', 'Doom', 'Glyph', 'Eagle', 'Oblivion', 'Gale', 'Vortex'];
export const RARE_SUFFIX: Partial<Record<SlotKind, string[]>> = {
  weapon: ['Bite', 'Edge', 'Fang', 'Song', 'Scalpel', 'Thirst', 'Razor', 'Hunger', 'Cleaver', 'Sever', 'Gutter'],
  offhand: ['Bulwark', 'Ward', 'Guard', 'Aegis', 'Tower', 'Lantern', 'Orb'],
  helmet: ['Crown', 'Visage', 'Brow', 'Cowl', 'Dome', 'Veil'],
  chest: ['Shell', 'Coat', 'Hide', 'Carapace', 'Vestment', 'Wrap'],
  gloves: ['Grasp', 'Fist', 'Hold', 'Paw', 'Touch', 'Claw'],
  boots: ['Stride', 'Tread', 'Pace', 'Trail', 'Spur', 'Track'],
  belt: ['Coil', 'Lash', 'Strap', 'Buckle', 'Clasp'],
  amulet: ['Beads', 'Heart', 'Locket', 'Charm', 'Talisman', 'Collar'],
  ring: ['Loop', 'Spiral', 'Band', 'Knuckle', 'Hoop', 'Whorl'],
  jewel: ['Eye', 'Spark', 'Shard', 'Glint', 'Facet'],
  flask: ['Draught', 'Tonic', 'Elixir'],
};
