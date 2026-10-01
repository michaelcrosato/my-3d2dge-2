/** The Codex: kills per species, uniques found and pinnacles defeated, saved safely. */
import { beforeAll, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { buildStageLevel } from '../src/agent/tools/content';
import { normalizeHero } from '../src/save';
import { autoHero } from '../src/sim/autobuild';
import { rollItem } from '../src/sim/items';
import { spawnPickup, pickupItem } from '../src/sim/loot';
import { Rng } from '../src/sim/rng';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));
beforeAll(async () => {
  await initPhysics();
});

it('records kills, uniques and pinnacles', () => {
  const hero = autoHero({ level: 22 });
  const sim = new Sim(buildStageLevel({ stage: 10 }), clips, 2, { hero });
  const p = sim.player!;
  const mons = [...sim.characters.values()].filter((c) => c.monster && !c.monster.boss).slice(0, 3);
  for (const m of mons) sim.kill(m, p);
  for (const m of mons) expect(hero.progress.codex.kills[m.monster!.def]).toBeGreaterThan(0);
  const boss = [...sim.characters.values()].find((c) => c.monster?.boss)!;
  sim.kill(boss, p);
  expect(hero.progress.codex.pinnacles).toEqual([boss.monster!.def]);
  expect(sim.events.some((e) => e.type === 'codex.pinnacle')).toBe(true);
  const u = rollItem(new Rng(3), { ilvl: 40, rarity: 'unique', uid: 'u1' });
  const q = spawnPickup(sim, 'item', p.pos.x, p.pos.z, 1, u);
  q.delay = 0;
  expect(pickupItem(sim, q)).toBe(true);
  expect(hero.progress.codex.uniques).toContain(u.unique);
  sim.dispose();
});

it('survives a save round trip and drops garbage', () => {
  const hero = autoHero({ level: 5 });
  hero.progress.codex = { kills: { hollow: 12, 'sp:wolf:3': 4 }, uniques: ['nope'], pinnacles: ['pinnacle_hollow_king', 'fake'] };
  const back = normalizeHero(JSON.parse(JSON.stringify(hero)));
  expect(back.progress.codex.kills).toEqual({ hollow: 12, 'sp:wolf:3': 4 });
  expect(back.progress.codex.uniques).toEqual([]);
  expect(back.progress.codex.pinnacles).toEqual(['pinnacle_hollow_king']);
  expect(normalizeHero({}).progress.codex).toEqual({ kills: {}, uniques: [], pinnacles: [] });
});
