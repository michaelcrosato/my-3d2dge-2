/** Pinnacle bosses: every tenth depth, three phases with adds, a guaranteed unique. */
import { beforeAll, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { buildStageLevel } from '../src/agent/tools/content';
import { campaignStage } from '../src/content/campaign';
import { MONSTERS } from '../src/content/monsters';
import { PINNACLE_IDS } from '../src/content/pinnacles';
import { autoHero } from '../src/sim/autobuild';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));
beforeAll(async () => {
  await initPhysics();
});

it('every tenth depth ends in a pinnacle, cycling through all of them', () => {
  const seen = new Set<string>();
  for (let n = 10; n <= 120; n += 10) {
    const def = campaignStage(n).dungeon.boss!.def;
    expect(PINNACLE_IDS).toContain(def);
    seen.add(def);
  }
  expect(seen.size).toBe(PINNACLE_IDS.length);
  expect(PINNACLE_IDS).not.toContain(campaignStage(9).dungeon.boss?.def);
});

it('fights in three phases, calls adds, and drops a unique', () => {
  const sim = new Sim(buildStageLevel({ stage: 20 }), clips, 4, { hero: autoHero({ level: 44 }) });
  const boss = [...sim.characters.values()].find((c) => c.monster?.boss)!;
  expect(MONSTERS[boss.monster!.def].boss!.phases).toBe(3);
  for (const c of [...sim.characters.values()]) if (c.monster && c !== boss) sim.despawn(c.id);
  boss.ai.awake = true;
  const p = sim.player!;
  sim.teleport('player', boss.pos.x + 5, boss.pos.z);
  const adds = () => [...sim.characters.values()].filter((c) => c.owner === boss.id && c.state !== 'dead').length;
  boss.life = boss.maxLife * 0.6;
  for (let i = 0; i < 240 && boss.monster!.phase < 2; i++) sim.step();
  expect(boss.monster!.phase).toBe(2);
  expect(adds()).toBe(3);
  boss.life = boss.maxLife * 0.3;
  // Phase changes land when the boss next decides (after its current swing).
  for (let i = 0; i < 240 && boss.monster!.phase < 3; i++) sim.step();
  expect(boss.monster!.phase).toBe(3);
  expect(sim.events.some((e) => e.type === 'boss.phase' && e.final)).toBe(true);
  sim.kill(boss, p);
  expect(sim.stage.bossDead).toBe(true);
  expect(sim.pickups.some((q) => q.item?.rarity === 'unique')).toBe(true);
  expect(sim.pickups.filter((q) => q.item && q.item.rarity !== 'normal' && q.item.rarity !== 'magic').length).toBeGreaterThanOrEqual(2);
  sim.dispose();
});
