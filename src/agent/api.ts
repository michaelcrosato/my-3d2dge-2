/**
 * Installs the agent tool registry on `window.agent`:
 *
 *   await agent.call('help')                                  every tool, grouped
 *   await agent.call('monster.inspect', { id: 'sp:drake:4', level: 20, rarity: 'rare' })
 *   await agent.call('creature.render', { plan: 'spider', seed: 9 })   -> images[0].png (data URL)
 *   agent.tools()                                              names, descriptions, JSON Schemas
 *
 * Present in every mode (open the console during play), not only `?agent`.
 */
import type { Game } from '../game';
import { clipTable } from '../render/assets';
import { callTool, describeTools } from './registry';
import './tools/audio';
import './tools/content';
import './tools/render';
import './tools/world';

export interface AgentApi {
  ready: boolean;
  step(frames?: number): void;
  idle(): Promise<void>;
  tools(group?: string): ReturnType<typeof describeTools>;
  call(name: string, args?: Record<string, unknown>): ReturnType<typeof callTool>;
}

export function createAgentApi(game: Game): AgentApi {
  const clips = clipTable(game.lib.manifest);
  return {
    ready: false,
    step: (frames = 1) => game.step(frames),
    idle: () => game.idle(),
    tools: (group) => describeTools(group),
    call: (name, args) => callTool(name, args ?? {}, { game, clips }),
  };
}
