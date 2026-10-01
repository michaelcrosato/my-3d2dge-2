/**
 * The campaign: stage number -> dungeon spec, plus the level mechanic(s) placed into it and a
 * one-line tip shown on arrival. Authored stages come first; past them the endless generator
 * keeps combining mechanics, archetypes and palettes forever.
 */
import type { Level } from './level';
import type { DungeonSpec } from './procgen/dungeon';
import { stageSpec } from './stages';

export interface CampaignStage {
  dungeon: DungeonSpec;
  /** Places mechanic props into the generated level. */
  place?: (level: Level) => void;
  tip?: string;
}

export function campaignStage(n: number): CampaignStage {
  return { dungeon: stageSpec(n) };
}
