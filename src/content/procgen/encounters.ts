/**
 * Encounter rolling: which monsters, in what packs, with which palette, rarity and affixes.
 * Campaign levels pass hand-picked pools; endless stages build pools by combining creature body
 * plans, archetypes and palettes (see endlessPool).
 */
import type { Rng } from '../../sim/rng';
import type { MonsterSpawn } from '../level';
import { ARCHETYPES, ensureMonster, MONSTER_AFFIXES, RARITY_SCALING, type MonsterRarity } from '../monsters';

export interface PoolEntry {
  def: string;
  weight: number;
  palette?: string;
  /** Creature genome seed for procedural bodies. */
  seed?: number;
  /** Display name override (procedural species names). */
  name?: string;
}

export interface EncounterPool {
  entries: PoolEntry[];
  /** Palettes used when an entry has none. */
  palettes: string[];
  /** Chance a pack is magic (champions) / rare (leader with minions). */
  magic: number;
  rare: number;
  /** Affixes allowed for elites (defaults to all). */
  affixes?: string[];
}

const AFFIX_IDS = Object.keys(MONSTER_AFFIXES);

export function rollAffixes(rng: Rng, rarity: MonsterRarity, allowed: readonly string[] = AFFIX_IDS): string[] {
  const [lo, hi] = RARITY_SCALING[rarity].affixes;
  const n = rng.int(lo, hi);
  const pool = [...allowed];
  const out: string[] = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  return out;
}

export function rollPack(rng: Rng, pool: EncounterPool, level: number, packId: string): MonsterSpawn[] {
  const entry = rng.weighted(pool.entries, (e) => e.weight);
  const def = ensureMonster(entry.def);
  const arch = ARCHETYPES[def.archetype];
  const palette = entry.palette ?? (pool.palettes.length ? rng.pick(pool.palettes) : def.palette);
  const size = rng.int(arch.pack[0], arch.pack[1]);
  const roll = rng.next();
  const rarity: MonsterRarity = roll < pool.rare ? 'rare' : roll < pool.rare + pool.magic ? 'magic' : 'normal';
  const base = { def: entry.def, level, palette, pack: packId, seed: entry.seed, name: entry.name };
  if (rarity === 'rare') {
    const out: MonsterSpawn[] = [{ ...base, rarity: 'rare', affixes: rollAffixes(rng, 'rare', pool.affixes) }];
    for (let i = 1; i < Math.max(3, size); i++) out.push({ ...base, rarity: 'normal' });
    return out;
  }
  if (rarity === 'magic') {
    const affixes = rollAffixes(rng, 'magic', pool.affixes);
    return Array.from({ length: Math.max(2, Math.ceil(size * 0.7)) }, () => ({ ...base, rarity: 'magic' as const, affixes }));
  }
  return Array.from({ length: size }, () => ({ ...base, rarity: 'normal' as const }));
}

const RARE_A = ['Gloom', 'Dread', 'Rot', 'Ash', 'Grim', 'Bone', 'Storm', 'Blood', 'Night', 'Hollow', 'Iron', 'Venom', 'Frost', 'Cinder', 'Woe', 'Hex'];
const RARE_B = ['maw', 'fang', 'spine', 'gnaw', 'howl', 'shroud', 'thorn', 'reap', 'grasp', 'scourge', 'mourn', 'sunder', 'wail', 'brand', 'hunger', 'gore'];

/** "Gloomfang the Rimed": names for rare monsters. */
export function rareName(rng: Rng, base: string): string {
  return `${rng.pick(RARE_A)}${rng.pick(RARE_B)}, ${base}`;
}
