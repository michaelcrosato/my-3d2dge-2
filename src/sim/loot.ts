/**
 * Drops and pickups: gold piles, items, life/mana orbs. Quantity and rarity scale with monster
 * rarity, the hero's item quantity / rarity / gold find, and difficulty. Deterministic: every roll
 * uses the sim RNG, so agents can simulate drop tables exactly (agent tool `loot.simulate`).
 */
import { config } from '../config';
import type { Item, ItemRarity } from '../content/items';
import { addToInventory, newUid } from './hero';
import { rollItem } from './items';
import { goldDrop } from './scaling';
import type { Sim } from './sim';
import type { Character, Pickup } from './types';

const RARITY_BONUS = { normal: 0, magic: 60, rare: 180, unique: 400 } as const;

function heroStats(sim: Sim) {
  const ch = sim.player;
  return ch ? sim.stats(ch) : null;
}

export function spawnPickup(sim: Sim, kind: Pickup['kind'], x: number, z: number, amount: number, item: Item | null = null, orb?: 'life' | 'mana'): Pickup {
  const ang = sim.rng.next() * Math.PI * 2, r = 0.5 + sim.rng.next() * 1.4;
  const to = sim.nav.nearestFree({ x: x + Math.cos(ang) * r, z: z + Math.sin(ang) * r });
  const p: Pickup = { id: sim.nextId(), kind, x: to.x, z: to.z, fromX: x, fromZ: z, t: 0, amount, item, orb, delay: kind === 'item' ? 20 : 30, dead: false };
  sim.pickups.push(p);
  sim.emit('drop', { id: p.id, kind, x: to.x, z: to.z, rarity: item?.rarity ?? null, name: item?.name ?? null });
  return p;
}

function uid(sim: Sim): string {
  return sim.hero ? newUid(sim.hero) : `d${sim.nextId()}`;
}

export function dropItems(sim: Sim, x: number, z: number, ilvl: number, count: number, rarityBonus: number, minRarity?: ItemRarity) {
  const st = heroStats(sim);
  const bonus = rarityBonus + (st?.get('itemRarity') ?? 0);
  for (let i = 0; i < count; i++) {
    const item = rollItem(sim.rng, { ilvl, rarityBonus: bonus, uid: uid(sim), rarity: i === 0 && minRarity && minRarity !== 'normal' ? (sim.rng.chance(0.25) && minRarity === 'rare' ? 'unique' : minRarity) : undefined });
    spawnPickup(sim, 'item', x, z, 1, item);
  }
}

export function spawnGold(sim: Sim, x: number, z: number, level: number, mult: number) {
  const st = heroStats(sim);
  const amount = Math.max(1, Math.round(goldDrop(level) * mult * (1 + (st?.get('goldFind') ?? 0) / 100) * sim.rng.range(0.6, 1.4)));
  spawnPickup(sim, 'gold', x, z, amount);
}

/** Rolls a count with a fractional part: 1.3 -> 1, plus another 30% of the time. */
function rollCount(sim: Sim, expected: number) {
  const n = Math.floor(expected);
  return n + (sim.rng.next() < expected - n ? 1 : 0);
}

export function dropLoot(sim: Sim, t: Character) {
  const m = t.monster;
  if (!m || m.xp <= 0) return;
  const st = heroStats(sim);
  const qty = (1 + (st?.get('itemQuantity') ?? 0) / 100) * config['tune.loot'];
  const lvl = t.level;
  const x = t.pos.x, z = t.pos.z;
  const base = { normal: 0.1, magic: 0.7, rare: 2.2, unique: 5 }[m.rarity] * (m.boss ? 1 : 1);
  dropItems(sim, x, z, lvl, rollCount(sim, base * qty), RARITY_BONUS[m.rarity], m.boss ? 'rare' : m.rarity === 'rare' ? 'magic' : undefined);
  const goldChance = { normal: 0.38, magic: 0.9, rare: 1, unique: 1 }[m.rarity];
  const piles = m.rarity === 'unique' ? 6 : m.rarity === 'rare' ? 2 : 1;
  for (let i = 0; i < piles; i++) if (sim.rng.chance(goldChance)) spawnGold(sim, x, z, lvl, m.rarity === 'unique' ? 3 : 1);
  // Health globes keep fights flowing (Diablo III style).
  const orb = { normal: 0.07, magic: 0.3, rare: 0.6, unique: 1 }[m.rarity];
  if (sim.rng.chance(orb)) spawnPickup(sim, 'orb', x, z, 0.2, null, 'life');
  if (sim.rng.chance(orb * 0.5)) spawnPickup(sim, 'orb', x, z, 0.25, null, 'mana');
}

/** A pinnacle boss's hoard: one guaranteed unique and three rares or better. */
export function dropPinnacle(sim: Sim, x: number, z: number, ilvl: number) {
  const unique = rollItem(sim.rng, { ilvl, rarity: 'unique', uid: uid(sim) });
  spawnPickup(sim, 'item', x, z, 1, unique);
  dropItems(sim, x, z, ilvl, 3, 250, 'rare');
  for (let i = 0; i < 4; i++) spawnGold(sim, x, z, ilvl, 3);
}

/** Breakables, chests and boss chests. */
export function dropContainer(sim: Sim, x: number, z: number, level: number, kind: 'small' | 'large' | 'chest' | 'boss') {
  const st = heroStats(sim);
  const qty = (1 + (st?.get('itemQuantity') ?? 0) / 100) * config['tune.loot'];
  if (kind === 'small' || kind === 'large') {
    if (sim.rng.chance(kind === 'large' ? 0.8 : 0.45)) spawnGold(sim, x, z, level, kind === 'large' ? 1.5 : 0.6);
    if (sim.rng.chance((kind === 'large' ? 0.25 : 0.06) * qty)) dropItems(sim, x, z, level, 1, 20);
    if (sim.rng.chance(0.05)) spawnPickup(sim, 'orb', x, z, 0.2, null, 'life');
    return;
  }
  const n = kind === 'boss' ? 5 : 2;
  dropItems(sim, x, z, level, rollCount(sim, n * qty), kind === 'boss' ? 300 : 120, kind === 'boss' ? 'rare' : 'magic');
  for (let i = 0; i < (kind === 'boss' ? 5 : 2); i++) spawnGold(sim, x, z, level, 1.5);
}

export function pickupItem(sim: Sim, p: Pickup): boolean {
  if (p.dead) return false;
  const hero = sim.hero, ch = sim.player;
  if (p.kind === 'gold') {
    p.dead = true;
    if (hero) {
      hero.gold += p.amount;
      hero.totals.gold += p.amount;
    }
    sim.stage.gold += p.amount;
    sim.emit('pickup', { kind: 'gold', amount: p.amount, x: p.x, z: p.z });
    return true;
  }
  if (p.kind === 'orb') {
    p.dead = true;
    if (ch) {
      if (p.orb === 'mana') ch.mana = Math.min(ch.maxMana, ch.mana + ch.maxMana * p.amount);
      else ch.life = Math.min(ch.maxLife, ch.life + ch.maxLife * p.amount);
    }
    sim.emit('pickup', { kind: 'orb', orb: p.orb, x: p.x, z: p.z });
    return true;
  }
  if (p.kind === 'item' && p.item) {
    if (hero && !addToInventory(hero, p.item)) {
      sim.emit('inventory.full', { name: p.item.name });
      return false;
    }
    p.dead = true;
    sim.stage.items++;
    sim.emit('pickup', { kind: 'item', name: p.item.name, rarity: p.item.rarity, base: p.item.base, x: p.x, z: p.z });
    return true;
  }
  return false;
}
