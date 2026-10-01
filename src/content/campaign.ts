/**
 * The campaign: stage number -> dungeon spec plus mechanics, title and arrival tip.
 *
 *   Depths 1-13   introduce one mechanic each; the level is named after it.
 *   Depths 14-24  combine them in authored pairs and trios.
 *   Depth 25      introduces Storm Pylons (added later; endless depths keep their old numbering).
 *   Depth 26+     endless: two or three mechanics, a theme, palettes and procedural species are
 *                 drawn from the stage seed; the title is built from the mechanics' words.
 */
import { Rng, hashSeed } from '../sim/rng';
import type { Level } from './level';
import { MECHANIC_IDS_V1, MECHANICS, placeMechanics, withLaterMechanics } from './mechanics';
import { isPinnacleDepth, pinnacleFor } from './pinnacles';
import type { DungeonSpec } from './procgen/dungeon';
import { stageSpec } from './stages';
import { DUNGEON_THEMES } from './themes';

export interface CampaignStage {
  dungeon: DungeonSpec;
  /** Places mechanic props into the generated level. */
  place?: (level: Level) => void;
  tip?: string;
  mechanics: string[];
}

interface Authored {
  name: string;
  mechanics: string[];
  theme: string;
  layout?: DungeonSpec['layout'];
  boss?: DungeonSpec['boss'];
}

export const AUTHORED: Authored[] = [
  { name: 'Blast Kegs', mechanics: ['kegs'], theme: 'cellar', layout: 'rooms', boss: { def: 'boss_golem', palette: 'ember' } },
  { name: 'Spike Traps', mechanics: ['spikes'], theme: 'catacomb', layout: 'halls' },
  { name: 'Shrines', mechanics: ['shrines'], theme: 'temple', layout: 'rooms', boss: { def: 'boss_cult', palette: 'void' } },
  { name: 'Launch Pads', mechanics: ['launchpads'], theme: 'ruins', layout: 'rooms' },
  { name: 'Black Ice', mechanics: ['ice'], theme: 'frost', layout: 'caves' },
  { name: 'Lightless', mechanics: ['lightless'], theme: 'crypt', layout: 'rooms', boss: { def: 'boss_reaver', palette: 'blood' } },
  { name: 'Rolling Boulders', mechanics: ['boulders'], theme: 'ashlands', layout: 'halls' },
  { name: 'Rift Gates', mechanics: ['rifts'], theme: 'abyss', layout: 'rooms' },
  { name: 'Fire Vents', mechanics: ['vents'], theme: 'foundry', layout: 'caves', boss: { def: 'boss_golem', palette: 'ash' } },
  { name: 'Totems', mechanics: ['totems'], theme: 'ruins', layout: 'rooms' },
  { name: 'Gravity Wells', mechanics: ['wells'], theme: 'abyss', layout: 'caves' },
  { name: 'Chrono Fields', mechanics: ['chrono'], theme: 'temple', layout: 'halls', boss: { def: 'boss_cult', palette: 'storm' } },
  { name: 'Loot Imps', mechanics: ['imps'], theme: 'catacomb', layout: 'rooms' },
  // Combinations.
  { name: 'Kegs on Ice', mechanics: ['kegs', 'ice'], theme: 'frost', layout: 'caves' },
  { name: 'Spikes in the Dark', mechanics: ['spikes', 'lightless'], theme: 'crypt', layout: 'halls' },
  { name: 'Boulder Pads', mechanics: ['launchpads', 'boulders'], theme: 'ashlands', layout: 'rooms', boss: { def: 'boss_reaver', palette: 'ash' } },
  { name: 'Vented Wells', mechanics: ['vents', 'wells'], theme: 'foundry', layout: 'caves' },
  { name: 'Totems of Time', mechanics: ['totems', 'chrono'], theme: 'temple', layout: 'rooms' },
  { name: 'Shrine Rush', mechanics: ['shrines', 'imps', 'rifts'], theme: 'ruins', layout: 'rooms' },
  { name: 'Powder and Gravity', mechanics: ['kegs', 'wells'], theme: 'cellar', layout: 'rooms', boss: { def: 'boss_golem', palette: 'void' } },
  { name: 'The Gauntlet', mechanics: ['spikes', 'vents', 'boulders'], theme: 'ashlands', layout: 'halls' },
  { name: 'Dark Rifts', mechanics: ['lightless', 'rifts', 'totems'], theme: 'abyss', layout: 'rooms' },
  { name: 'Frozen Time', mechanics: ['ice', 'chrono', 'kegs'], theme: 'frost', layout: 'caves' },
  { name: 'Imp Gauntlet', mechanics: ['imps', 'launchpads', 'spikes'], theme: 'catacomb', layout: 'halls', boss: { def: 'boss_cult', palette: 'gilded' } },
  // Later mechanics get their own depth after the combinations.
  { name: 'Storm Pylons', mechanics: ['pylons'], theme: 'ruins', layout: 'rooms', boss: { def: 'boss_golem', palette: 'storm' } },
];

/** Endless intensity counts from here (the authored list was 24 long when endless began). */
const ENDLESS_BASE = 24;

/** Which mechanics a depth uses (also the agent-facing summary). */
export function stageMechanics(n: number): string[] {
  if (n <= AUTHORED.length) return AUTHORED[n - 1].mechanics;
  const r = new Rng(hashSeed('endless', n));
  const count = n > 60 ? 3 : r.chance(0.5) ? 3 : 2;
  return withLaterMechanics(r.shuffle([...MECHANIC_IDS_V1]).slice(0, count), (id) => hashSeed(`endless:${id}`, n));
}

export function stageTitle(n: number): string {
  if (n <= AUTHORED.length) return AUTHORED[n - 1].name;
  const r = new Rng(hashSeed('title', n));
  const ms = stageMechanics(n).map((id) => MECHANICS[id]);
  const adj = r.pick(ms).adjective;
  const nouns = ms.filter((m) => m.adjective !== adj).map((m) => m.noun);
  return `${adj} ${nouns.slice(0, -1).join(', ')}${nouns.length > 1 ? ' & ' : ''}${nouns[nouns.length - 1]}`;
}

export function campaignStage(n: number): CampaignStage {
  const a = n <= AUTHORED.length ? AUTHORED[n - 1] : null;
  const mechanics = stageMechanics(n);
  let theme = a?.theme;
  if (!theme) {
    const r = new Rng(hashSeed('theme', n));
    const liked = mechanics.flatMap((id) => MECHANICS[id].themes);
    theme = r.chance(0.7) && liked.length ? r.pick(liked) : r.pick(DUNGEON_THEMES);
  }
  const fresh = a ? mechanics.filter((m) => !AUTHORED.slice(0, n - 1).some((b) => b.mechanics.includes(m))) : [];
  // Every tenth depth ends in a pinnacle boss.
  const boss = isPinnacleDepth(n) ? pinnacleFor(n) : a?.boss;
  const dungeon = stageSpec(n, {
    theme, layout: a?.layout, boss, mechanics,
    title: stageTitle(n), subtitle: `Depth ${n} · ${theme[0].toUpperCase()}${theme.slice(1)}`,
  });
  const tips = (fresh.length ? fresh : mechanics).map((id) => MECHANICS[id].tip);
  return {
    dungeon,
    mechanics,
    // Later depths turn the dial up a little.
    place: (level) => placeMechanics(level, mechanics, n <= AUTHORED.length ? 1 : Math.min(1.6, 1 + (n - ENDLESS_BASE) * 0.02)),
    tip: fresh.length ? `New: ${tips[0]}` : mechanics.length > 1 ? `${mechanics.map((id) => MECHANICS[id].name).join(' + ')}. Combine them.` : tips[0],
  };
}
