/**
 * Item mechanics: rolling items (rarity, base, affixes, uniques), turning an item into mods and
 * weapon numbers, describing it for tooltips, valuing it for vendors, and blacksmith crafts.
 * Deterministic for a given Rng; agent tools use the same functions to simulate drop tables.
 */
import { AFFIX_BY_ID, AFFIXES, RARE_PREFIX, RARE_SUFFIX, tierFactor, tierOf, type AffixDef } from '../content/affixes';
import { BASES, ITEM_BASES, itemBase, type Item, type ItemBase, type ItemRarity, type SlotKind } from '../content/items';
import { describeMod, mod, type DamageType, type Mod } from '../content/stats';
import { UNIQUE_BY_ID, UNIQUES } from '../content/uniques';
import type { Rng } from './rng';
import { defense, power } from './scaling';

const round = (v: number) => (Math.abs(v) >= 10 ? Math.round(v) : Math.abs(v) >= 2 ? Math.round(v) : Math.round(v * 10) / 10);

function affixScale(a: AffixDef, ilvl: number, tier: number): number {
  switch (a.scale) {
    case 'power': return power(ilvl);
    case 'defense': return defense(ilvl);
    case 'tier': return tierFactor(tier);
    default: return 1;
  }
}

function affixMod(a: AffixDef, values: number[]): Mod {
  const m: Mod = { stat: a.stat, kind: a.mod, value: values[0] };
  if (values.length > 1) m.max = values[1];
  if (a.tags?.length) m.tags = a.tags;
  return m;
}

/** Item level 1 values of flat implicits ride the curves too. */
function scaleImplicit(m: Mod, ilvl: number): Mod {
  if (m.kind !== 'flat') return m;
  if (m.stat === 'life' || m.stat === 'mana' || m.stat === 'armor' || m.stat === 'evasion' || m.stat === 'lifeRegen') return { ...m, value: round(m.value * defense(ilvl)) };
  if (m.stat.startsWith('added')) return { ...m, value: round(m.value * power(ilvl)), max: m.max !== undefined ? round(m.max * power(ilvl)) : undefined };
  return m;
}

function uniqueMods(item: Item): Mod[] {
  const u = item.unique ? UNIQUE_BY_ID[item.unique] : undefined;
  if (!u) return [];
  return u.mods.map(([m, scale]) => {
    const k = scale === 'power' ? power(item.ilvl) : scale === 'defense' ? defense(item.ilvl) : 1;
    if (k === 1) return m;
    return { ...m, value: round(m.value * k), max: m.max !== undefined ? round(m.max * k) : undefined };
  });
}

function localSum(item: Item, local: AffixDef['local']): number {
  let s = 0;
  for (const r of item.affixes) if (AFFIX_BY_ID[r.id]?.local === local) s += r.values[0];
  return s;
}

/** Armour / evasion / block granted by an armour piece (scaled, with quality and local %). */
export function itemDefences(item: Item): { armor: number; evasion: number; block: number } {
  const a = itemBase(item.base).armour;
  if (!a) return { armor: 0, evasion: 0, block: 0 };
  const k = defense(item.ilvl) * (1 + item.quality / 100) * (1 + localSum(item, 'defence') / 100);
  return { armor: Math.round((a.armor ?? 0) * k), evasion: Math.round((a.evasion ?? 0) * k), block: a.block ?? 0 };
}

/** Every global mod an item grants (weapon-local affixes are folded into weaponDamage instead). */
export function itemMods(item: Item): Mod[] {
  const base = itemBase(item.base);
  const out: Mod[] = [];
  for (const m of base.implicit ?? []) out.push(scaleImplicit(m, item.ilvl));
  const d = itemDefences(item);
  if (d.armor) out.push(mod('armor', 'flat', d.armor));
  if (d.evasion) out.push(mod('evasion', 'flat', d.evasion));
  if (d.block) out.push(mod('block', 'flat', d.block));
  for (const r of item.affixes) {
    const a = AFFIX_BY_ID[r.id];
    if (!a) continue;
    if (a.local) continue;
    out.push(affixMod(a, r.values));
  }
  out.push(...uniqueMods(item));
  return out;
}

export function weaponDamage(item: Item) {
  const base = itemBase(item.base);
  const w = base.weapon;
  if (!w) return { cls: 'unarmed' as const, dmg: { physical: [2, 5] as [number, number] }, speed: 1.1, crit: 5, twoHanded: false };
  const k = power(item.ilvl) * (1 + item.quality / 100) * (1 + localSum(item, 'weaponPhys') / 100);
  const dmg: Partial<Record<DamageType, [number, number]>> = { physical: [w.phys[0] * k, w.phys[1] * k] };
  for (const r of item.affixes) {
    const a = AFFIX_BY_ID[r.id];
    if (a?.local !== 'weaponAdded') continue;
    const type = ({ addedPhysical: 'physical', addedFire: 'fire', addedCold: 'cold', addedLightning: 'lightning', addedChaos: 'chaos' } as const)[a.stat as 'addedFire'];
    const prev = dmg[type] ?? [0, 0];
    dmg[type] = [prev[0] + r.values[0], prev[1] + (r.values[1] ?? r.values[0])];
  }
  for (const t of Object.keys(dmg) as DamageType[]) dmg[t] = [Math.round(dmg[t]![0]), Math.max(Math.round(dmg[t]![0]), Math.round(dmg[t]![1]))];
  return {
    cls: w.cls,
    dmg,
    speed: w.speed * (1 + localSum(item, 'weaponSpeed') / 100),
    crit: w.crit * (1 + localSum(item, 'weaponCrit') / 100),
    twoHanded: !!w.twoHanded,
  };
}

// ---------------------------------------------------------------- rolling

export interface RollOptions {
  ilvl: number;
  rarity?: ItemRarity;
  base?: string;
  slot?: SlotKind;
  /** Increased item rarity, percent. */
  rarityBonus?: number;
  uid: string;
  /** Allow uniques. */
  uniques?: boolean;
}

const DROP_BASES = ITEM_BASES.filter((b) => b.slot !== 'flask');

function pickBase(rng: Rng, ilvl: number, slot?: SlotKind): ItemBase {
  const list = DROP_BASES.filter((b) => b.level <= ilvl && (!slot || b.slot === slot));
  const pool = list.length ? list : DROP_BASES.filter((b) => !slot || b.slot === slot);
  // Jewels are rarer; newer bases slightly favoured.
  return rng.weighted(pool, (b) => (b.slot === 'jewel' ? 0.25 : 1) * (1 + b.level / Math.max(1, ilvl)));
}

export function rollRarity(rng: Rng, rarityBonus = 0): ItemRarity {
  const k = 1 + rarityBonus / 100;
  return rng.weighted<ItemRarity>(['normal', 'magic', 'rare', 'unique'], (r) => ({ normal: 58, magic: 32, rare: 9 * k, unique: 1.1 * k })[r]);
}

function affixPool(slot: SlotKind): AffixDef[] {
  if (slot === 'jewel') return AFFIXES.filter((a) => !a.local && (a.slots.includes('amulet') || a.slots.includes('ring')) && a.stat !== 'projectiles');
  if (slot === 'flask') return [];
  return AFFIXES.filter((a) => a.slots.includes(slot));
}

export function rollAffix(rng: Rng, a: AffixDef, ilvl: number): Item['affixes'][number] {
  const top = tierOf(ilvl);
  const tier = Math.max(1, top - Math.floor(rng.next() * rng.next() * 3));
  const k = affixScale(a, ilvl, tier);
  const roll = (r: [number, number]) => round((r[0] + rng.next() * (r[1] - r[0])) * k);
  const values = [roll(a.range)];
  if (a.range2) values.push(Math.max(values[0], roll(a.range2)));
  return { id: a.id, tier, values };
}

/** Adds one random affix that fits (respecting prefix/suffix limits and groups). False if none fit. */
export function addRandomAffix(rng: Rng, item: Item): boolean {
  const base = itemBase(item.base);
  const limit = item.rarity === 'magic' ? 1 : 3;
  const have = item.affixes.map((r) => AFFIX_BY_ID[r.id]).filter(Boolean);
  const prefixes = have.filter((a) => a.kind === 'prefix').length, suffixes = have.length - prefixes;
  const groups = new Set(have.map((a) => a.group));
  const pool = affixPool(base.slot).filter((a) =>
    !groups.has(a.group) && (a.minLevel ?? 0) <= item.ilvl && (a.kind === 'prefix' ? prefixes < limit : suffixes < limit));
  if (!pool.length) return false;
  const a = rng.weighted(pool, (x) => x.weight);
  item.affixes.push(rollAffix(rng, a, item.ilvl));
  return true;
}

export function rareName(rng: Rng, slot: SlotKind): string {
  return `${rng.pick(RARE_PREFIX)} ${rng.pick(RARE_SUFFIX[slot] ?? ['Thing'])}`;
}

export function magicName(item: Item): string {
  const base = itemBase(item.base);
  const pre = item.affixes.map((r) => AFFIX_BY_ID[r.id]).find((a) => a?.kind === 'prefix');
  const suf = item.affixes.map((r) => AFFIX_BY_ID[r.id]).find((a) => a?.kind === 'suffix');
  return `${pre ? `${pre.word} ` : ''}${base.name}${suf ? ` ${suf.word}` : ''}`;
}

export function rollItem(rng: Rng, o: RollOptions): Item {
  let rarity = o.rarity ?? rollRarity(rng, o.rarityBonus);
  let baseId = o.base;
  let unique: string | undefined;
  if (rarity === 'unique' && o.uniques !== false) {
    const options = UNIQUES.filter((u) => u.level <= o.ilvl && (!o.slot || itemBase(u.base).slot === o.slot) && (!o.base || u.base === o.base));
    if (options.length) {
      const u = rng.weighted(options, (x) => x.weight);
      unique = u.id;
      baseId = u.base;
    } else rarity = 'rare';
  } else if (rarity === 'unique') rarity = 'rare';
  const base = baseId ? itemBase(baseId) : pickBase(rng, o.ilvl, o.slot);
  if (base.slot === 'flask') rarity = 'normal';
  if (base.slot === 'jewel' && rarity === 'normal') rarity = 'magic';
  const item: Item = { uid: o.uid, base: base.id, rarity, ilvl: Math.max(1, Math.round(o.ilvl)), name: base.name, affixes: [], quality: 0, seed: Math.floor(rng.next() * 2 ** 31) };
  if (unique) {
    item.unique = unique;
    item.name = UNIQUE_BY_ID[unique].name;
    return item;
  }
  if (rarity === 'magic') {
    const n = rng.chance(0.55) ? 2 : 1;
    for (let i = 0; i < n; i++) addRandomAffix(rng, item);
    item.name = magicName(item);
  } else if (rarity === 'rare') {
    const n = rng.int(3, base.slot === 'jewel' ? 4 : 6);
    for (let i = 0; i < n; i++) addRandomAffix(rng, item);
    item.name = rareName(rng, base.slot);
  }
  return item;
}

// ---------------------------------------------------------------- describing / valuing

export interface ItemLine {
  text: string;
  kind: 'header' | 'base' | 'implicit' | 'affix' | 'unique' | 'flavour' | 'req';
  tier?: number;
}

export function describeItem(item: Item, skillNames: Record<string, string> = {}): ItemLine[] {
  const base = itemBase(item.base);
  const lines: ItemLine[] = [];
  if (base.weapon) {
    const w = weaponDamage(item);
    for (const [t, r] of Object.entries(w.dmg)) lines.push({ kind: 'base', text: `${t[0].toUpperCase()}${t.slice(1)} Damage: ${r![0]}-${r![1]}` });
    lines.push({ kind: 'base', text: `Attacks per Second: ${(w.speed * 2.6).toFixed(2)}` });
    lines.push({ kind: 'base', text: `Critical Strike Chance: ${w.crit.toFixed(1)}%` });
  }
  const d = itemDefences(item);
  if (d.armor) lines.push({ kind: 'base', text: `Armour: ${d.armor}` });
  if (d.evasion) lines.push({ kind: 'base', text: `Evasion Rating: ${d.evasion}` });
  if (d.block) lines.push({ kind: 'base', text: `Chance to Block: ${d.block}%` });
  if (base.flask) lines.push({ kind: 'base', text: `Recovers ${base.flask.amount}% ${base.flask.kind === 'life' ? 'Life' : 'Mana'} over ${base.flask.duration}s · ${base.flask.perUse} charges per use` });
  if (item.quality) lines.push({ kind: 'base', text: `Quality: +${item.quality}%` });
  for (const m of base.implicit ?? []) lines.push({ kind: 'implicit', text: describeMod(scaleImplicit(m, item.ilvl), skillNames) });
  for (const r of item.affixes) {
    const a = AFFIX_BY_ID[r.id];
    if (!a) continue;
    const text = a.local === 'weaponPhys' ? `${r.values[0]}% increased Physical Damage`
      : a.local === 'defence' ? `${r.values[0]}% increased Armour and Evasion`
        : a.local === 'weaponSpeed' ? `${r.values[0]}% increased Attack Speed`
          : a.local === 'weaponCrit' ? `${r.values[0]}% increased Critical Strike Chance`
            : describeMod(affixMod(a, r.values), skillNames);
    lines.push({ kind: 'affix', text, tier: r.tier });
  }
  for (const m of uniqueMods(item)) lines.push({ kind: 'unique', text: describeMod(m, skillNames) });
  if (item.unique) lines.push({ kind: 'flavour', text: UNIQUE_BY_ID[item.unique]?.flavour ?? '' });
  lines.push({ kind: 'req', text: `Item Level ${item.ilvl}` });
  return lines;
}

export function itemValue(item: Item): number {
  const k = { normal: 1, magic: 2.5, rare: 6, unique: 15 }[item.rarity];
  return Math.max(1, Math.round(4 * Math.pow(power(item.ilvl), 0.55) * k * (BASES[item.base]?.value ?? 1)));
}

export function salvageValue(item: Item): number {
  return { normal: 1, magic: 2, rare: 5, unique: 12 }[item.rarity] + Math.floor(item.ilvl / 10);
}

// ---------------------------------------------------------------- crafting (blacksmith)

export type Craft = 'upgrade' | 'reforge' | 'augment' | 'temper' | 'quality';

export function craftCost(item: Item, craft: Craft): { gold: number; shards: number } {
  const g = Math.round(15 * Math.pow(power(item.ilvl), 0.6));
  switch (craft) {
    case 'upgrade': return { gold: g * (item.rarity === 'normal' ? 1 : 4), shards: item.rarity === 'normal' ? 2 : 8 };
    case 'reforge': return { gold: g * 3, shards: 6 };
    case 'augment': return { gold: g * 5, shards: 10 };
    case 'temper': return { gold: g * 2, shards: 4 };
    case 'quality': return { gold: g, shards: 3 };
  }
}

/** Why a craft can't be done (null = allowed). */
export function craftBlocked(item: Item, craft: Craft): string | null {
  const base = itemBase(item.base);
  if (item.unique) return craft === 'quality' && item.quality < 20 ? null : 'Uniques can only gain quality';
  if (item.locked) return 'This item is locked';
  if (base.slot === 'flask' && craft !== 'quality') return 'Flasks can only gain quality';
  switch (craft) {
    case 'upgrade': return item.rarity === 'rare' ? 'Already rare' : null;
    case 'reforge': return item.rarity === 'normal' ? 'Upgrade it first' : null;
    case 'augment': {
      const max = item.rarity === 'magic' ? 2 : item.rarity === 'rare' ? 6 : 0;
      return item.affixes.length >= max ? 'No room for another affix' : null;
    }
    case 'temper': return item.affixes.length ? null : 'No affixes to temper';
    case 'quality': return item.quality >= 20 ? 'Quality is already 20%' : null;
  }
}

/** Applies a craft in place (cost is paid by the caller). */
export function applyCraft(rng: Rng, item: Item, craft: Craft): void {
  const base = itemBase(item.base);
  switch (craft) {
    case 'upgrade':
      item.rarity = item.rarity === 'normal' ? 'magic' : 'rare';
      addRandomAffix(rng, item);
      if (item.rarity === 'rare') {
        while (item.affixes.length < 4 && addRandomAffix(rng, item));
        item.name = rareName(rng, base.slot);
      } else item.name = magicName(item);
      break;
    case 'reforge': {
      item.affixes = [];
      const n = item.rarity === 'magic' ? (rng.chance(0.55) ? 2 : 1) : rng.int(3, 6);
      for (let i = 0; i < n; i++) addRandomAffix(rng, item);
      item.name = item.rarity === 'magic' ? magicName(item) : rareName(rng, base.slot);
      break;
    }
    case 'augment':
      addRandomAffix(rng, item);
      if (item.rarity === 'magic') item.name = magicName(item);
      break;
    case 'temper': {
      // Re-roll the numbers of one affix (keeps which affix it is).
      const i = Math.floor(rng.next() * item.affixes.length);
      const a = AFFIX_BY_ID[item.affixes[i].id];
      if (a) item.affixes[i] = rollAffix(rng, a, item.ilvl);
      break;
    }
    case 'quality':
      item.quality = Math.min(20, item.quality + 5);
      break;
  }
}
