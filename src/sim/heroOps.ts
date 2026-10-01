/**
 * Everything the UI (and agents) can do to a hero outside combat, as plain functions over hero
 * data: equip / unequip / move between inventory and stash, sell, salvage, buy and gamble at the
 * vendor, blacksmith crafts, passive tree allocation and refunds, jewel sockets and the hotbar.
 * Each returns null on success or a short reason string the UI can show.
 */
import { BASES, canEquip, EQUIP_SLOTS, itemBase, SLOT_KIND, type EquipSlot, type Item, type SlotKind } from '../content/items';
import { HOTBAR_SKILLS } from '../content/skills';
import { canRefund, pathTo, TREE } from '../content/tree';
import { heroSkills, newUid, treePoints, type Hero } from './hero';
import { applyCraft, craftBlocked, craftCost, itemValue, rollItem, salvageValue, type Craft } from './items';
import { Rng } from './rng';
import { power } from './scaling';

export type Area = 'inventory' | 'stash';
export interface Loc {
  area: Area | 'equip';
  index?: number;
  slot?: EquipSlot;
}

export function itemAt(hero: Hero, loc: Loc): Item | null {
  if (loc.area === 'equip') return loc.slot ? hero.equipment[loc.slot] ?? null : null;
  return hero[loc.area][loc.index ?? -1] ?? null;
}

function setAt(hero: Hero, loc: Loc, item: Item | null) {
  if (loc.area === 'equip') {
    if (!loc.slot) return;
    if (item) hero.equipment[loc.slot] = item;
    else delete hero.equipment[loc.slot];
  } else hero[loc.area][loc.index!] = item;
}

/** Best equipment slot for an item (empty ring slot first). */
export function slotFor(hero: Hero, item: Item): EquipSlot | null {
  const kind = itemBase(item.base).slot;
  const slots = EQUIP_SLOTS.filter((s) => SLOT_KIND[s] === kind);
  if (!slots.length) return null;
  if (kind === 'flask') return itemBase(item.base).flask?.kind === 'mana' ? 'flask2' : 'flask1';
  return slots.find((s) => !hero.equipment[s]) ?? slots[0];
}

const freeIndex = (hero: Hero, area: Area) => hero[area].indexOf(null);

/** Equip from inventory/stash into a slot (swapping the old item back). */
export function equip(hero: Hero, from: Loc, slot?: EquipSlot): string | null {
  const item = itemAt(hero, from);
  if (!item) return 'Nothing there';
  const target = slot ?? slotFor(hero, item);
  if (!target || !canEquip(item, target)) return 'Can\'t equip that there';
  const old = hero.equipment[target] ?? null;
  setAt(hero, from, old);
  hero.equipment[target] = item;
  // Two-handed weapons free the off-hand.
  if (target === 'weapon' && BASES[item.base].weapon?.twoHanded && hero.equipment.offhand) {
    const i = freeIndex(hero, 'inventory');
    if (i >= 0) {
      hero.inventory[i] = hero.equipment.offhand;
      delete hero.equipment.offhand;
    }
  }
  if (target === 'offhand' && hero.equipment.weapon && BASES[hero.equipment.weapon.base].weapon?.twoHanded) {
    const i = freeIndex(hero, 'inventory');
    if (i < 0) return null;
    hero.inventory[i] = hero.equipment.weapon;
    delete hero.equipment.weapon;
  }
  return null;
}

export function unequip(hero: Hero, slot: EquipSlot): string | null {
  const item = hero.equipment[slot];
  if (!item) return 'Empty slot';
  const i = freeIndex(hero, 'inventory');
  if (i < 0) return 'Inventory is full';
  hero.inventory[i] = item;
  delete hero.equipment[slot];
  return null;
}

/** Moves (or swaps) an item between any two locations. */
export function moveItem(hero: Hero, from: Loc, to: Loc): string | null {
  const a = itemAt(hero, from);
  if (!a) return 'Nothing there';
  if (to.area === 'equip') return equip(hero, from, to.slot);
  const b = itemAt(hero, to);
  if (from.area === 'equip' && b && from.slot && !canEquip(b, from.slot)) return 'Can\'t swap those';
  setAt(hero, to, a);
  setAt(hero, from, b);
  return null;
}

/** Sends an item to the first free slot of the other area (stash <-> inventory). */
export function transfer(hero: Hero, from: Loc): string | null {
  const item = itemAt(hero, from);
  if (!item) return 'Nothing there';
  const area: Area = from.area === 'stash' ? 'inventory' : 'stash';
  const i = freeIndex(hero, area);
  if (i < 0) return `${area === 'stash' ? 'Stash' : 'Inventory'} is full`;
  hero[area][i] = item;
  setAt(hero, from, null);
  return null;
}

export function sell(hero: Hero, from: Loc): string | null {
  const item = itemAt(hero, from);
  if (!item) return 'Nothing there';
  if (from.area === 'equip') return 'Unequip it first';
  hero.gold += itemValue(item);
  setAt(hero, from, null);
  return null;
}

export function salvage(hero: Hero, from: Loc): string | null {
  const item = itemAt(hero, from);
  if (!item) return 'Nothing there';
  if (from.area === 'equip') return 'Unequip it first';
  hero.shards += salvageValue(item);
  setAt(hero, from, null);
  return null;
}

/** Sorts an area: rarity, then slot, then item level. */
export function sortArea(hero: Hero, area: Area) {
  const order = { unique: 0, rare: 1, magic: 2, normal: 3 };
  const list = hero[area].filter((x): x is Item => !!x).sort((a, b) =>
    order[a.rarity] - order[b.rarity] || itemBase(a.base).slot.localeCompare(itemBase(b.base).slot) || b.ilvl - a.ilvl);
  hero[area] = [...list, ...new Array(hero[area].length - list.length).fill(null)];
}

// ---------------------------------------------------------------- vendor

export interface StockEntry {
  item: Item;
  price: number;
}

/** The merchant's wares for this visit (seeded by hero level and visit count). */
export function vendorStock(hero: Hero, visit: number): StockEntry[] {
  const r = new Rng(visit * 9973 + hero.level * 31 + 5);
  const out: StockEntry[] = [];
  const mk = (base: string | undefined, rarity: Item['rarity'] | undefined, slot?: SlotKind) => {
    const item = rollItem(r, { ilvl: hero.level, base, rarity, slot, uid: `shop${visit}-${out.length}`, uniques: false });
    out.push({ item, price: itemValue(item) * 4 });
  };
  mk('life_flask', 'normal');
  mk('mana_flask', 'normal');
  for (let i = 0; i < 10; i++) mk(undefined, r.chance(0.65) ? 'magic' : r.chance(0.5) ? 'rare' : 'normal');
  return out;
}

export function buy(hero: Hero, entry: StockEntry): string | null {
  if (hero.gold < entry.price) return 'Not enough gold';
  const i = freeIndex(hero, 'inventory');
  if (i < 0) return 'Inventory is full';
  hero.gold -= entry.price;
  hero.inventory[i] = { ...structuredClone(entry.item), uid: newUid(hero) };
  return null;
}

export function gambleCost(hero: Hero): number {
  return Math.round(60 * Math.pow(power(hero.level), 0.6));
}

/** Gold for a mystery item of a slot kind: rarity rolled with a big bonus, uniques possible. */
export function gamble(hero: Hero, slot: SlotKind, seed: number): string | null {
  const cost = gambleCost(hero);
  if (hero.gold < cost) return 'Not enough gold';
  const i = freeIndex(hero, 'inventory');
  if (i < 0) return 'Inventory is full';
  hero.gold -= cost;
  hero.inventory[i] = rollItem(new Rng(seed), { ilvl: hero.level + 2, slot, rarityBonus: 250, uid: newUid(hero) });
  return null;
}

// ---------------------------------------------------------------- blacksmith

export function craft(hero: Hero, loc: Loc, kind: Craft, seed: number): string | null {
  const item = itemAt(hero, loc);
  if (!item) return 'Nothing there';
  const blocked = craftBlocked(item, kind);
  if (blocked) return blocked;
  const cost = craftCost(item, kind);
  if (hero.gold < cost.gold) return 'Not enough gold';
  if (hero.shards < cost.shards) return 'Not enough shards';
  hero.gold -= cost.gold;
  hero.shards -= cost.shards;
  applyCraft(new Rng(seed), item, kind);
  return null;
}

// ---------------------------------------------------------------- passive tree

export function allocate(hero: Hero, id: string): string | null {
  const node = TREE.byId.get(id);
  if (!node) return 'Unknown node';
  const path = pathTo(new Set(hero.tree), id);
  if (!path.length) return node.repeatable ? 'Not connected' : 'Already allocated';
  if (path.length > treePoints(hero)) return `Needs ${path.length} points (${treePoints(hero)} available)`;
  hero.tree.push(...path);
  return null;
}

export function refundCost(hero: Hero): number {
  return Math.round(10 * Math.pow(power(hero.level), 0.5));
}

export function refund(hero: Hero, id: string, free = false): string | null {
  if (!canRefund(hero.tree, id)) return 'That would disconnect other nodes';
  const cost = free ? 0 : refundCost(hero);
  if (hero.gold < cost) return 'Not enough gold';
  hero.gold -= cost;
  const i = hero.tree.lastIndexOf(id);
  hero.tree.splice(i, 1);
  // Skills no longer unlocked leave the hotbar; jewels in a refunded socket go to the inventory.
  const known = heroSkills(hero);
  hero.hotbar = hero.hotbar.map((s) => (s && known.includes(s) ? s : null));
  if (hero.jewels[id] && !hero.tree.includes(id)) {
    const j = freeIndex(hero, 'inventory');
    if (j >= 0) hero.inventory[j] = hero.jewels[id];
    delete hero.jewels[id];
  }
  return null;
}

export function respecCost(hero: Hero): number {
  return refundCost(hero) * Math.max(1, Math.floor(hero.tree.length / 3));
}

export function respecAll(hero: Hero): string | null {
  const cost = respecCost(hero);
  if (hero.gold < cost) return 'Not enough gold';
  hero.gold -= cost;
  for (const j of Object.values(hero.jewels)) {
    const i = freeIndex(hero, 'inventory');
    if (i >= 0) hero.inventory[i] = j;
  }
  hero.jewels = {};
  hero.tree = [];
  const known = heroSkills(hero);
  hero.hotbar = hero.hotbar.map((s) => (s && known.includes(s) ? s : null));
  return null;
}

export function socketJewel(hero: Hero, nodeId: string, from: Loc): string | null {
  const node = TREE.byId.get(nodeId);
  if (node?.kind !== 'socket' || !hero.tree.includes(nodeId)) return 'Allocate the socket first';
  const item = itemAt(hero, from);
  if (!item || itemBase(item.base).slot !== 'jewel') return 'Only jewels fit';
  const old = hero.jewels[nodeId] ?? null;
  hero.jewels[nodeId] = item;
  setAt(hero, from, old);
  return null;
}

export function setHotbar(hero: Hero, slot: number, skill: string | null): string | null {
  if (slot < 0 || slot >= hero.hotbar.length) return 'No such slot';
  if (skill && (!HOTBAR_SKILLS.includes(skill) || !heroSkills(hero).includes(skill))) return 'Skill not learned';
  if (skill) {
    const prev = hero.hotbar.indexOf(skill);
    if (prev >= 0) hero.hotbar[prev] = hero.hotbar[slot];
  }
  hero.hotbar[slot] = skill;
  return null;
}
