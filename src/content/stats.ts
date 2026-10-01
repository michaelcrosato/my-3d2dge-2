/**
 * The stat vocabulary shared by every modular system: items, affixes, the passive tree, buffs,
 * shrines, monster modifiers and difficulty all speak in `Mod`s over these stat ids.
 *
 * A mod is `{ stat, kind, value, tags? }`:
 * - kind 'flat' adds to the base value, 'inc' adds percent to one shared "increased" pool,
 *   'more' multiplies separately (PoE semantics), 'flag' turns a rule on (keystones).
 * - tags are conditions: the mod applies only when the context (a skill hit, a damage type, a
 *   state like low life) has every tag. "increased fire damage" is `{stat:'damage', kind:'inc',
 *   value:20, tags:['fire']}` and applies to every fire hit of every skill.
 *
 * Pure data (no DOM, no three.js): the sim, UI and agent tools all read it.
 */

export const DAMAGE_TYPES = ['physical', 'fire', 'cold', 'lightning', 'chaos'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export const ELEMENTS: readonly DamageType[] = ['fire', 'cold', 'lightning'];

export const DAMAGE_COLORS: Record<DamageType, string> = {
  physical: '#f2eadf',
  fire: '#ff8a3d',
  cold: '#8fd8ff',
  lightning: '#ffe95c',
  chaos: '#c77dff',
};

/** Context tags. Skills carry some, hits add the damage type, the sim adds conditions. */
export type Tag =
  | 'attack' | 'spell' | 'melee' | 'projectile' | 'area' | 'movement' | 'dot' | 'minion' | 'aura' | 'warcry' | 'channel'
  | DamageType | 'elemental'
  | 'cond:lowLife' | 'cond:fullLife' | 'cond:moving' | 'cond:stationary' | 'cond:shrine' | 'cond:recentKill' | 'cond:recentDodge'
  | 'vs:burning' | 'vs:chilled' | 'vs:shocked' | 'vs:poisoned' | 'vs:bleeding' | 'vs:boss' | 'vs:elite'
  | `skill:${string}`;

export type ModKind = 'flat' | 'inc' | 'more' | 'flag';

export interface Mod {
  stat: StatId;
  kind: ModKind;
  value: number;
  /** Upper end for ranged flat mods (added damage rolls between value and max per hit). */
  max?: number;
  tags?: readonly Tag[];
}

interface StatSpec {
  label: string;
  /** How a flat value is shown: plain number, percent, or per-second. */
  unit?: '' | '%' | '/s' | 'm' | 's';
  /** Base value every character starts from (before any mod). */
  base?: number;
  /** Lower / upper clamp for the final value. */
  min?: number;
  max?: number;
  group: 'attributes' | 'defense' | 'offense' | 'utility' | 'ailments' | 'loot' | 'rules';
}

export const STATS = {
  // attributes
  str: { label: 'Strength', group: 'attributes' },
  dex: { label: 'Dexterity', group: 'attributes' },
  int: { label: 'Intelligence', group: 'attributes' },
  // defense
  life: { label: 'Maximum Life', group: 'defense', min: 1 },
  lifeRegen: { label: 'Life Regeneration', unit: '/s', group: 'defense' },
  lifeRegenPct: { label: 'Life Regenerated per second', unit: '%', group: 'defense' },
  mana: { label: 'Maximum Mana', group: 'defense', min: 0 },
  manaRegen: { label: 'Mana Regeneration', unit: '/s', group: 'defense', base: 2 },
  armor: { label: 'Armour', group: 'defense', min: 0 },
  evasion: { label: 'Evasion Rating', group: 'defense', min: 0 },
  block: { label: 'Chance to Block', unit: '%', group: 'defense', min: 0, max: 75 },
  resFire: { label: 'Fire Resistance', unit: '%', group: 'defense', max: 75 },
  resCold: { label: 'Cold Resistance', unit: '%', group: 'defense', max: 75 },
  resLightning: { label: 'Lightning Resistance', unit: '%', group: 'defense', max: 75 },
  resChaos: { label: 'Chaos Resistance', unit: '%', group: 'defense', max: 75 },
  damageTaken: { label: 'Damage Taken', unit: '%', group: 'defense', base: 100, min: 5 },
  stunThreshold: { label: 'Stagger Threshold', unit: '%', group: 'defense', base: 100 },
  // offense
  damage: { label: 'Damage', unit: '%', group: 'offense' },
  addedPhysical: { label: 'Added Physical Damage', group: 'offense' },
  addedFire: { label: 'Added Fire Damage', group: 'offense' },
  addedCold: { label: 'Added Cold Damage', group: 'offense' },
  addedLightning: { label: 'Added Lightning Damage', group: 'offense' },
  addedChaos: { label: 'Added Chaos Damage', group: 'offense' },
  attackSpeed: { label: 'Attack Speed', unit: '%', group: 'offense', base: 100, min: 10 },
  castSpeed: { label: 'Cast Speed', unit: '%', group: 'offense', base: 100, min: 10 },
  critChance: { label: 'Critical Strike Chance', unit: '%', group: 'offense', base: 5, min: 0, max: 95 },
  critMulti: { label: 'Critical Strike Multiplier', unit: '%', group: 'offense', base: 150 },
  penetration: { label: 'Resistance Penetration', unit: '%', group: 'offense' },
  area: { label: 'Area of Effect', unit: '%', group: 'offense', base: 100, min: 20 },
  projectiles: { label: 'Additional Projectiles', group: 'offense', min: 0 },
  projectileSpeed: { label: 'Projectile Speed', unit: '%', group: 'offense', base: 100, min: 20 },
  pierce: { label: 'Pierce', group: 'offense', min: 0 },
  chain: { label: 'Chain', group: 'offense', min: 0 },
  knockback: { label: 'Knockback', unit: '%', group: 'offense', base: 100 },
  stagger: { label: 'Stagger', unit: '%', group: 'offense', base: 100 },
  // utility
  moveSpeed: { label: 'Movement Speed', unit: '%', group: 'utility', base: 100, min: 20 },
  cooldownRecovery: { label: 'Cooldown Recovery Speed', unit: '%', group: 'utility', base: 100, min: 10 },
  cost: { label: 'Skill Cost', unit: '%', group: 'utility', base: 100, min: 0 },
  lifeLeech: { label: 'Life Leech', unit: '%', group: 'utility' },
  manaLeech: { label: 'Mana Leech', unit: '%', group: 'utility' },
  lifeOnHit: { label: 'Life gained on Hit', group: 'utility' },
  manaOnHit: { label: 'Mana gained on Hit', group: 'utility' },
  lifeOnKill: { label: 'Life gained on Kill', group: 'utility' },
  manaOnKill: { label: 'Mana gained on Kill', group: 'utility' },
  dodgeCooldown: { label: 'Dodge Roll Cooldown', unit: 's', group: 'utility', base: 0.55, min: 0.1 },
  flaskCharges: { label: 'Flask Charges Gained', unit: '%', group: 'utility', base: 100 },
  flaskEffect: { label: 'Flask Effect', unit: '%', group: 'utility', base: 100 },
  minionDamage: { label: 'Minion Damage', unit: '%', group: 'utility' },
  minionLife: { label: 'Minion Life', unit: '%', group: 'utility' },
  lightRadius: { label: 'Light Radius', unit: '%', group: 'utility', base: 100 },
  // ailments
  igniteChance: { label: 'Chance to Ignite', unit: '%', group: 'ailments', max: 100 },
  freezeChance: { label: 'Chance to Freeze', unit: '%', group: 'ailments', max: 100 },
  shockChance: { label: 'Chance to Shock', unit: '%', group: 'ailments', max: 100 },
  poisonChance: { label: 'Chance to Poison', unit: '%', group: 'ailments', max: 100 },
  bleedChance: { label: 'Chance to cause Bleeding', unit: '%', group: 'ailments', max: 100 },
  ailmentEffect: { label: 'Ailment Effect', unit: '%', group: 'ailments', base: 100 },
  ailmentDuration: { label: 'Ailment Duration', unit: '%', group: 'ailments', base: 100 },
  // loot
  itemRarity: { label: 'Increased Item Rarity', unit: '%', group: 'loot' },
  itemQuantity: { label: 'Increased Item Quantity', unit: '%', group: 'loot' },
  goldFind: { label: 'Increased Gold Found', unit: '%', group: 'loot' },
  xpGain: { label: 'Experience Gain', unit: '%', group: 'loot', base: 100 },
  // rules (keystones, uniques)
  bloodMagic: { label: 'Skills cost Life instead of Mana', group: 'rules' },
  noCrit: { label: 'Never deal Critical Strikes', group: 'rules' },
  alwaysHit: { label: 'Hits can\'t be Evaded', group: 'rules' },
  physToFire: { label: 'Physical Damage converted to Fire', unit: '%', group: 'rules', max: 100 },
  physToCold: { label: 'Physical Damage converted to Cold', unit: '%', group: 'rules', max: 100 },
  physToLightning: { label: 'Physical Damage converted to Lightning', unit: '%', group: 'rules', max: 100 },
  elementalToChaos: { label: 'Elemental Damage converted to Chaos', unit: '%', group: 'rules', max: 100 },
  instantLeech: { label: 'Leech is instant', group: 'rules' },
  chaosImmune: { label: 'Immune to Chaos Damage', group: 'rules' },
  cannotBeFrozen: { label: 'Cannot be Frozen', group: 'rules' },
  cannotBeStunned: { label: 'Cannot be Staggered', group: 'rules' },
  dodgeNoCooldown: { label: 'Dodge Roll has no cooldown', group: 'rules' },
  explodeOnKill: { label: 'Enemies you kill explode', unit: '%', group: 'rules' },
  splitOnKill: { label: 'Enemies you kill split into allied spores', unit: '%', group: 'rules' },
  stealMods: { label: 'Steal the modifiers of Rare monsters you kill', group: 'rules' },
  lowLifeThreshold: { label: 'Low Life threshold', unit: '%', group: 'rules', base: 35 },
} as const satisfies Record<string, StatSpec>;

export type StatId = keyof typeof STATS;
export const STAT_IDS = Object.keys(STATS) as StatId[];
export const isStatId = (s: string): s is StatId => Object.prototype.hasOwnProperty.call(STATS, s);

export function statSpec(id: StatId): StatSpec {
  return STATS[id];
}

export const ADDED_STAT: Record<DamageType, StatId> = {
  physical: 'addedPhysical', fire: 'addedFire', cold: 'addedCold', lightning: 'addedLightning', chaos: 'addedChaos',
};
export const RES_STAT: Record<DamageType, StatId> = {
  physical: 'armor', fire: 'resFire', cold: 'resCold', lightning: 'resLightning', chaos: 'resChaos',
};

/** Damage amounts by type. Missing types are zero. */
export type DamageMap = Partial<Record<DamageType, number>>;
export type DamageRange = Partial<Record<DamageType, readonly [number, number]>>;

const TAG_WORDS: Record<string, string> = {
  attack: 'Attack', spell: 'Spell', melee: 'Melee', projectile: 'Projectile', area: 'Area', movement: 'Movement',
  dot: 'Damage over Time', minion: 'Minion', aura: 'Aura', warcry: 'Warcry', channel: 'Channelling',
  physical: 'Physical', fire: 'Fire', cold: 'Cold', lightning: 'Lightning', chaos: 'Chaos', elemental: 'Elemental',
};
const COND_WORDS: Record<string, string> = {
  'cond:lowLife': 'while on Low Life', 'cond:fullLife': 'while on Full Life', 'cond:moving': 'while Moving',
  'cond:stationary': 'while Stationary', 'cond:shrine': 'while Shrine-blessed', 'cond:recentKill': 'if you\'ve Killed Recently',
  'cond:recentDodge': 'if you\'ve Dodged Recently', 'vs:burning': 'against Burning enemies', 'vs:chilled': 'against Chilled enemies',
  'vs:shocked': 'against Shocked enemies', 'vs:poisoned': 'against Poisoned enemies', 'vs:bleeding': 'against Bleeding enemies',
  'vs:boss': 'against Bosses', 'vs:elite': 'against Rare and Unique enemies',
};

/** Every tag a mod can carry besides `skill:<id>`: skill kinds, damage types and conditions. */
export const KNOWN_TAGS: ReadonlySet<string> = new Set([...Object.keys(TAG_WORDS), ...Object.keys(COND_WORDS)]);

const fmtNum = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(Math.abs(v) < 1 ? 2 : 1));

/** Human text for a mod, PoE style: "+12 to Maximum Life", "20% increased Fire Damage". */
export function describeMod(m: Mod, skillNames: Record<string, string> = {}): string {
  const spec: StatSpec = STATS[m.stat];
  const tags = m.tags ?? [];
  const words = tags.filter((t) => TAG_WORDS[t]).map((t) => TAG_WORDS[t]);
  const skill = tags.find((t) => t.startsWith('skill:'));
  const skillWord = skill ? `${skillNames[skill.slice(6)] ?? skill.slice(6)} ` : '';
  const cond = tags.filter((t) => COND_WORDS[t]).map((t) => COND_WORDS[t]).join(' ');
  const tail = cond ? ` ${cond}` : '';
  const v = m.value;
  if (m.kind === 'flag') return `${spec.label}${tail}`;
  if (m.stat === 'damage') {
    const what = `${skillWord}${words.join(' ')}${words.length ? ' ' : ''}Damage`;
    if (m.kind === 'more') return `${fmtNum(Math.abs(v))}% ${v >= 0 ? 'more' : 'less'} ${what}${tail}`;
    return `${fmtNum(Math.abs(v))}% ${v >= 0 ? 'increased' : 'reduced'} ${what}${tail}`;
  }
  const scope = [skillWord.trim(), words.length ? `${words.join(' ')} Skills` : ''].filter(Boolean).join(' ');
  const scoped = scope ? ` with ${scope}` : '';
  if (m.kind === 'more') return `${fmtNum(Math.abs(v))}% ${v >= 0 ? 'more' : 'less'} ${spec.label}${scoped}${tail}`;
  if (m.kind === 'inc') return `${fmtNum(Math.abs(v))}% ${v >= 0 ? 'increased' : 'reduced'} ${spec.label}${scoped}${tail}`;
  // flat
  if (m.stat.startsWith('added')) {
    const range = m.max !== undefined && m.max !== v ? `${fmtNum(v)} to ${fmtNum(m.max)}` : fmtNum(v);
    return `Adds ${range} ${spec.label.replace('Added ', '')}${scoped || ' to Attacks and Spells'}${tail}`;
  }
  const unit = spec.unit ?? '';
  if (unit === '%' && spec.base !== undefined && spec.base >= 100) return `${v >= 0 ? '+' : ''}${fmtNum(v)}% ${spec.label}${scoped}${tail}`;
  if (unit === '%') return `${v >= 0 ? '+' : ''}${fmtNum(v)}% to ${spec.label}${scoped}${tail}`;
  if (unit === '/s') return `${v >= 0 ? '+' : ''}${fmtNum(v)} ${spec.label} per second${tail}`;
  if (unit === 's') return `${v >= 0 ? '+' : ''}${fmtNum(v)}s to ${spec.label}${tail}`;
  return `${v >= 0 ? '+' : ''}${fmtNum(v)} to ${spec.label}${scoped}${tail}`;
}

/** Shorthand constructor used by content tables. */
export const mod = (stat: StatId, kind: ModKind, value: number, tags?: readonly Tag[]): Mod => (tags?.length ? { stat, kind, value, tags } : { stat, kind, value });
/** "Adds min to max <type> Damage" (attacks and spells unless tagged). */
export const added = (stat: StatId, min: number, max: number, tags?: readonly Tag[]): Mod => ({ ...mod(stat, 'flat', min, tags), max });
