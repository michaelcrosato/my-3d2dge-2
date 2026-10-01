/**
 * Pacts: optional risk-for-reward modifiers chosen at the waypoint (the Nightmare Sigil / map mod
 * idea). Each makes a depth harder in one readable way and pays out in experience, item rarity,
 * item quantity or gold while the hero is inside. They stack, so power-levellers can push their
 * build and casual players can ignore them entirely.
 *
 * Applied in three places: the dungeon spec before generation (density, elite packs), the level
 * after generation (darkness), and the sim (monster life, damage, speed and affixes; hero loot
 * stats), via `level.pacts`.
 */
import type { Level } from './level';
import { addMechanic } from './mechanics';
import type { DungeonSpec } from './procgen/dungeon';
import { mod, type Mod } from './stats';

export interface PactDef {
  id: string;
  name: string;
  /** The risk, in one line. */
  desc: string;
  color: string;
  /** Unlocks once this depth has been reached. */
  minDepth: number;
  // ---- risk
  enemyDamage?: number;
  enemyLife?: number;
  enemySpeed?: number;
  /** Extra monster packs (fraction). */
  density?: number;
  /** Multiplier on magic / rare pack chances. */
  elites?: number;
  /** Monster affix every monster gains. */
  affix?: string;
  /** Plunges the depth into darkness (the Lightless mechanic). */
  dark?: boolean;
  // ---- reward (percent)
  xp?: number;
  rarity?: number;
  quantity?: number;
  gold?: number;
}

export const PACTS: PactDef[] = [
  { id: 'brutal', name: 'Brutal', desc: 'Monsters deal 40% more damage.', color: '#ff6a5a', minDepth: 3, enemyDamage: 0.4, rarity: 30, xp: 10 },
  { id: 'stalwart', name: 'Stalwart', desc: 'Monsters have 60% more life.', color: '#d8c08a', minDepth: 3, enemyLife: 0.6, gold: 40, rarity: 20 },
  { id: 'teeming', name: 'Teeming', desc: '50% more monster packs.', color: '#a6d94a', minDepth: 4, density: 0.5, quantity: 25, xp: 10 },
  { id: 'swift', name: 'Swift', desc: 'Monsters move and attack 20% faster.', color: '#7fffd4', minDepth: 5, enemySpeed: 0.2, xp: 25 },
  { id: 'champions', name: 'Champions', desc: 'Twice as many magic and rare packs.', color: '#ffe14d', minDepth: 6, elites: 2, rarity: 35, quantity: 10 },
  { id: 'volatile', name: 'Volatile', desc: 'Every monster bursts when it dies.', color: '#ffb84d', minDepth: 8, affix: 'deathburst', xp: 30 },
  { id: 'bloodthirsty', name: 'Bloodthirsty', desc: 'Monsters leech life from their hits.', color: '#d6324a', minDepth: 8, affix: 'vampiric', gold: 30, xp: 15 },
  { id: 'eclipse', name: 'Eclipse', desc: 'The depth is plunged into darkness.', color: '#8a7ab8', minDepth: 10, dark: true, rarity: 30, quantity: 15 },
];

export const PACT_BY_ID: Record<string, PactDef> = Object.fromEntries(PACTS.map((p) => [p.id, p]));

export const pactsOf = (ids: readonly string[] | undefined): PactDef[] => (ids ?? []).map((id) => PACT_BY_ID[id]).filter((p): p is PactDef => !!p);

/** Totals for display and for the sim. */
export function pactTotals(ids: readonly string[] | undefined) {
  const t = { enemyDamage: 0, enemyLife: 0, enemySpeed: 0, density: 0, elites: 1, xp: 0, rarity: 0, quantity: 0, gold: 0, affixes: [] as string[], dark: false };
  for (const p of pactsOf(ids)) {
    t.enemyDamage += p.enemyDamage ?? 0;
    t.enemyLife += p.enemyLife ?? 0;
    t.enemySpeed += p.enemySpeed ?? 0;
    t.density += p.density ?? 0;
    t.elites *= p.elites ?? 1;
    t.xp += p.xp ?? 0;
    t.rarity += p.rarity ?? 0;
    t.quantity += p.quantity ?? 0;
    t.gold += p.gold ?? 0;
    if (p.affix && !t.affixes.includes(p.affix)) t.affixes.push(p.affix);
    t.dark ||= !!p.dark;
  }
  return t;
}

/** "+40% XP · +60% rarity · +25% quantity" for the waypoint and the banner. */
export function pactRewardText(ids: readonly string[] | undefined): string {
  const t = pactTotals(ids);
  return [t.xp && `+${t.xp}% experience`, t.rarity && `+${t.rarity}% item rarity`, t.quantity && `+${t.quantity}% item quantity`, t.gold && `+${t.gold}% gold`].filter(Boolean).join(' · ');
}

/** Before generation: more packs, more elites. */
export function applyPactsToSpec(spec: DungeonSpec, ids: readonly string[] | undefined): DungeonSpec {
  const t = pactTotals(ids);
  if (!pactsOf(ids).length) return spec;
  return {
    ...spec,
    density: spec.density * (1 + t.density),
    pool: { ...spec.pool, magic: Math.min(0.6, spec.pool.magic * t.elites), rare: Math.min(0.35, spec.pool.rare * t.elites) },
  };
}

/** After generation: remember the pacts on the level (the sim reads them), darken it, name them. */
export function stampPacts(level: Level, ids: readonly string[] | undefined) {
  const ps = pactsOf(ids);
  if (!ps.length) return;
  level.pacts = ps.map((p) => p.id);
  if (pactTotals(ids).dark) addMechanic(level, 'lightless');
  level.subtitle = `${level.subtitle ?? ''} · Pacts: ${ps.map((p) => p.name).join(', ')}`;
}

/** Loot and experience the hero earns inside a pact depth. */
export function pactHeroMods(ids: readonly string[] | undefined): Mod[] {
  const t = pactTotals(ids);
  const out: Mod[] = [];
  if (t.xp) out.push(mod('xpGain', 'flat', t.xp));
  if (t.rarity) out.push(mod('itemRarity', 'flat', t.rarity));
  if (t.quantity) out.push(mod('itemQuantity', 'flat', t.quantity));
  if (t.gold) out.push(mod('goldFind', 'flat', t.gold));
  return out;
}

/** What every monster in a pact depth gains. */
export function pactMonsterMods(ids: readonly string[] | undefined): Mod[] {
  const t = pactTotals(ids);
  const out: Mod[] = [];
  if (t.enemyLife) out.push(mod('life', 'more', t.enemyLife * 100));
  if (t.enemySpeed) out.push(mod('moveSpeed', 'inc', t.enemySpeed * 100), mod('attackSpeed', 'inc', t.enemySpeed * 100), mod('castSpeed', 'inc', t.enemySpeed * 100));
  return out;
}
