/**
 * Daily Trial: one seeded challenge per calendar day. The date picks the mechanics, theme and two
 * pacts, identical for every player that day; the depth follows the hero's frontier so it always
 * fits. Clearing it records a best time (speedrunners race it) and the first clear of the day
 * pays a pinnacle-grade hoard (power-levellers farm it). No campaign progress either way.
 */
import { hashSeed, Rng } from '../sim/rng';
import type { Level } from './level';
import { MECHANIC_IDS, MECHANICS, placeMechanics } from './mechanics';
import { applyPactsToSpec, PACTS, stampPacts } from './pacts';
import { generateDungeon } from './procgen/dungeon';
import { stageSpec } from './stages';
import { DUNGEON_THEMES } from './themes';

export interface TrialSpec {
  /** YYYY-MM-DD (local date). */
  key: string;
  title: string;
  depth: number;
  theme: string;
  mechanics: string[];
  pacts: string[];
}

/** Today's key in local time ("2026-10-01"). */
export function dateKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The trial for a date at a depth: deterministic in (key, depth). */
export function dailyTrial(key: string, frontier: number): TrialSpec {
  const r = new Rng(hashSeed('daily', key));
  const depth = Math.max(3, frontier);
  const mechanics = r.shuffle([...MECHANIC_IDS]).slice(0, r.chance(0.5) ? 3 : 2);
  const liked = mechanics.flatMap((m) => MECHANICS[m].themes).filter((t) => DUNGEON_THEMES.includes(t));
  const theme = liked.length ? r.pick(liked) : r.pick(DUNGEON_THEMES);
  const pacts = r.shuffle(PACTS.filter((p) => p.minDepth <= depth).map((p) => p.id)).slice(0, 2);
  const [, m, d] = key.split('-');
  return { key, title: `Daily Trial · ${Number(d)}.${Number(m)}.`, depth, theme, mechanics, pacts };
}

export function buildTrialLevel(t: TrialSpec): Level {
  const spec = stageSpec(t.depth, {
    theme: t.theme, mechanics: t.mechanics, seedSalt: hashSeed('trial', t.key), title: t.title,
    subtitle: `Depth ${t.depth} · ${t.mechanics.map((m) => MECHANICS[m].name).join(' + ')}`,
  });
  const level = generateDungeon(applyPactsToSpec(spec, t.pacts));
  placeMechanics(level, t.mechanics);
  stampPacts(level, t.pacts);
  return level;
}
