/**
 * The hero's persistent progression (what a save file holds) and the "build": every mod the
 * hero has from level, attributes, equipment and the passive tree, plus weapon numbers. The sim
 * reads the build; UI panels and agent tools read the same functions, so the character sheet,
 * tooltips and combat can never disagree.
 */
import { BASES, EQUIP_SLOTS, starterKit, type EquipSlot, type Item, type WeaponClass } from '../content/items';
import { mod, type DamageType, type Mod } from '../content/stats';
import { itemMods, weaponDamage } from './items';
import { heroBaseLife, heroBaseMana, xpToNext } from './scaling';
import { StatBlock } from './stats';
import { treeMods, treeSkills } from './treeEffects';

export const INVENTORY_SIZE = 40;
export const STASH_SIZE = 120;
export const HOTBAR_SIZE = 5;

export interface HeroProgress {
  /** Highest campaign stage unlocked (1-based). */
  unlocked: number;
  /** Stage id -> best clear time in frames. */
  cleared: Record<string, number>;
  /** Deepest endless stage cleared. */
  endlessBest: number;
  /** The Codex: species slain (monster id -> kills), uniques found, pinnacle bosses defeated. */
  codex: { kills: Record<string, number>; uniques: string[]; pinnacles: string[] };
  /** Daily Trial best clear times in frames, by date key (YYYY-MM-DD). */
  trials: Record<string, number>;
}

export interface Hero {
  version: 1;
  name: string;
  level: number;
  xp: number;
  gold: number;
  /** Crafting currency from salvaging. */
  shards: number;
  hotbar: Array<string | null>;
  equipment: Partial<Record<EquipSlot, Item>>;
  inventory: Array<Item | null>;
  stash: Array<Item | null>;
  /** Allocated passive tree nodes. */
  tree: string[];
  /** Jewels socketed into tree sockets: node id -> item. */
  jewels: Record<string, Item>;
  /** Flask charges, per flask slot. */
  flasks: [number, number];
  progress: HeroProgress;
  totals: { kills: number; deaths: number; gold: number; frames: number; elites: number; bosses: number };
  nextUid: number;
}

export function newHero(name = 'Ranger'): Hero {
  return {
    version: 1,
    name,
    level: 1,
    xp: 0,
    gold: 0,
    shards: 0,
    hotbar: ['cleave', 'fireball', null, null, null],
    equipment: starterKit(),
    inventory: new Array(INVENTORY_SIZE).fill(null),
    stash: new Array(STASH_SIZE).fill(null),
    tree: [],
    jewels: {},
    flasks: [30, 30],
    progress: { unlocked: 1, cleared: {}, endlessBest: 0, codex: { kills: {}, uniques: [], pinnacles: [] }, trials: {} },
    totals: { kills: 0, deaths: 0, gold: 0, frames: 0, elites: 0, bosses: 0 },
    nextUid: 1,
  };
}

export interface WeaponStats {
  cls: WeaponClass | 'unarmed';
  dmg: Partial<Record<DamageType, [number, number]>>;
  /** Attack speed multiplier from the base (1 = Slash at its authored speed). */
  speed: number;
  crit: number;
  twoHanded: boolean;
}

export interface HeroBuild {
  mods: Mod[];
  weapon: WeaponStats;
  /** Skills the hero can slot: always-known basics plus tree unlocks. */
  skills: string[];
  blocking: boolean;
}

/** Skills every hero knows; the tree unlocks the rest. */
export const STARTING_SKILLS = ['cleave', 'fireball'];

export function heroSkills(hero: Hero): string[] {
  return [...new Set([...STARTING_SKILLS, ...treeSkills(hero.tree)])];
}

/** Every mod the hero has, including attribute bonuses (two passes: attributes first). */
export function buildHero(hero: Hero): HeroBuild {
  const L = hero.level;
  const mods: Mod[] = [
    mod('life', 'flat', heroBaseLife(L)),
    mod('mana', 'flat', heroBaseMana(L)),
    mod('manaRegen', 'flat', 0.5 + 0.08 * L),
    mod('lifeRegenPct', 'flat', 0.4),
    mod('str', 'flat', 10 + Math.floor((L - 1) / 2)),
    mod('dex', 'flat', 10 + Math.floor((L - 1) / 2)),
    mod('int', 'flat', 10 + Math.floor((L - 1) / 2)),
    mod('evasion', 'flat', 8 + 3 * L),
    mod('armor', 'flat', 4 + 2 * L),
  ];
  for (const slot of EQUIP_SLOTS) {
    const item = hero.equipment[slot];
    if (!item || slot === 'flask1' || slot === 'flask2') continue;
    mods.push(...itemMods(item));
  }
  mods.push(...treeMods(hero.tree));
  for (const jewel of Object.values(hero.jewels)) mods.push(...itemMods(jewel));
  // Attribute bonuses (PoE-flavoured): strength -> life and melee damage, dexterity -> evasion and
  // attack speed, intelligence -> mana and spell damage.
  const first = new StatBlock(mods);
  const str = first.get('str'), dex = first.get('dex'), int = first.get('int');
  mods.push(
    mod('life', 'flat', Math.floor(str / 2)),
    mod('damage', 'inc', Math.floor(str / 5), ['melee']),
    mod('evasion', 'inc', Math.floor(dex / 5)),
    mod('attackSpeed', 'inc', Math.floor(dex / 10)),
    mod('mana', 'flat', Math.floor(int / 2)),
    mod('damage', 'inc', Math.floor(int / 5), ['spell']),
  );
  const w = hero.equipment.weapon;
  const weapon: WeaponStats = w
    ? weaponDamage(w)
    : { cls: 'unarmed', dmg: { physical: [2, 5] }, speed: 1.1, crit: 5, twoHanded: false };
  const off = hero.equipment.offhand;
  const blocking = !!off && !!BASES[off.base]?.armour?.block;
  return { mods, weapon, skills: heroSkills(hero), blocking };
}

/** Adds experience; returns the number of levels gained. */
export function gainXp(hero: Hero, amount: number): number {
  hero.xp += Math.max(0, Math.round(amount));
  let gained = 0;
  while (hero.xp >= xpToNext(hero.level)) {
    hero.xp -= xpToNext(hero.level);
    hero.level++;
    gained++;
  }
  return gained;
}

/** Passive points available: one per level after the first, plus stage-clear bonuses. */
export function treePoints(hero: Hero): number {
  const bonus = Object.keys(hero.progress.cleared).length;
  return hero.level - 1 + bonus - hero.tree.length;
}

/** Puts an item in the first free inventory slot; false if full. */
export function addToInventory(hero: Hero, item: Item): boolean {
  const i = hero.inventory.indexOf(null);
  if (i < 0) return false;
  hero.inventory[i] = item;
  return true;
}

export function newUid(hero: Hero): string {
  return `i${hero.nextUid++}`;
}
