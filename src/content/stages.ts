/**
 * Stage -> dungeon spec. Every stage picks a theme, a layout style, a monster level, a pool of
 * monsters (hand-made humanoid families plus procedural creature species) and a boss. Deeper
 * stages grow larger, denser and nastier, without an end. Level mechanics are layered on top by
 * content/campaign.ts.
 */
import { config } from '../config';
import { hashSeed, Rng } from '../sim/rng';
import { MONSTERS } from './monsters';
import { CREATURE_PRESETS } from './procgen/creature';
import type { DungeonSpec } from './procgen/dungeon';
import type { EncounterPool, PoolEntry } from './procgen/encounters';
import { DUNGEON_THEMES, THEMES } from './themes';

/** Humanoid families that fit each theme (procedural creatures are mixed in everywhere). */
const THEME_FAMILIES: Record<string, string[]> = {
  crypt: ['hollow', 'hollow_brute', 'hexer', 'shade', 'cultist'],
  cellar: ['brigand', 'marksman', 'bombling', 'golem', 'reaver'],
  catacomb: ['hollow', 'hollow_brute', 'mender', 'warden', 'hexer'],
  frost: ['shade', 'warden', 'golem', 'marksman', 'cultist'],
  foundry: ['golem', 'bombling', 'reaver', 'cultist', 'brigand'],
  ruins: ['brigand', 'marksman', 'mender', 'warden', 'shade'],
  abyss: ['hexer', 'shade', 'cultist', 'reaver', 'hollow_brute'],
  temple: ['warden', 'mender', 'cultist', 'shade', 'golem'],
  ashlands: ['reaver', 'bombling', 'brigand', 'golem', 'hollow'],
};

const HUMANOID_BOSSES = ['boss_golem', 'boss_cult', 'boss_reaver'];
const BOSS_PLANS = ['drake', 'scorpion', 'brute', 'wyrm', 'eye', 'crab', 'spider', 'boar'];

export function stageMonsterLevel(stage: number): number {
  return Math.max(1, Math.round(1 + (stage - 1) * 2 + Math.floor(stage / 6)));
}

export interface StageOptions {
  /** Overrides (campaign stages pin these). */
  theme?: string;
  layout?: DungeonSpec['layout'];
  name?: string;
  title?: string;
  subtitle?: string;
  mechanics?: string[];
  boss?: DungeonSpec['boss'];
  seedSalt?: number;
}

/** A procedural species roster for a stage: 2-3 creature species tied to the stage seed. */
export function stageSpecies(stage: number, seed: number): PoolEntry[] {
  const r = new Rng(seed ^ 0x5bd1e995);
  const n = stage < 3 ? 1 : stage < 8 ? 2 : 3;
  const out: PoolEntry[] = [];
  for (let i = 0; i < n; i++) {
    const preset = r.pick(CREATURE_PRESETS.filter((p) => p !== 'spore'));
    out.push({ def: `sp:${preset}:${r.int(1, 99999)}`, weight: 1.2 });
  }
  return out;
}

export function stageSpec(stage: number, o: StageOptions = {}): DungeonSpec {
  const seed = hashSeed('stage', stage, o.seedSalt ?? 0);
  const r = new Rng(seed);
  const themeId = o.theme ?? DUNGEON_THEMES[(stage - 1 + Math.floor(stage / 9)) % DUNGEON_THEMES.length];
  const th = THEMES[themeId];
  const families = (THEME_FAMILIES[themeId] ?? THEME_FAMILIES.crypt).filter((f) => MONSTERS[f]);
  const unlocked = families.slice(0, Math.min(families.length, 2 + Math.floor(stage / 2)));
  const entries: PoolEntry[] = unlocked.map((def) => ({ def, weight: 1 }));
  entries.push(...stageSpecies(stage, seed));
  const pool: EncounterPool = {
    entries,
    palettes: th.palettes,
    magic: Math.min(0.3, 0.1 + stage * 0.012),
    rare: Math.min(0.16, 0.035 + stage * 0.008),
  };
  const size = Math.min(80, 48 + stage * 2);
  const bossPick = stage % 3 === 0 ? { def: HUMANOID_BOSSES[(stage / 3 - 1) % HUMANOID_BOSSES.length], palette: r.pick(th.palettes) }
    : { def: `sp:${BOSS_PLANS[(stage + r.int(0, 7)) % BOSS_PLANS.length]}:${r.int(1, 99999)}:boss`, palette: r.pick(th.palettes) };
  return {
    seed,
    name: o.name ?? `stage-${stage}`,
    title: o.title ?? `Depth ${stage}`,
    subtitle: o.subtitle ?? th.name,
    theme: themeId,
    layout: o.layout ?? (['rooms', 'caves', 'halls'] as const)[stage % 3],
    cols: size,
    rows: size,
    rooms: Math.min(14, 6 + Math.floor(stage / 2)),
    monsterLevel: stageMonsterLevel(stage),
    density: (1.05 + Math.min(0.9, stage * 0.04)) * config['tune.density'],
    pool,
    boss: o.boss ?? bossPick,
    mechanics: o.mechanics ?? [],
    stage,
  };
}
