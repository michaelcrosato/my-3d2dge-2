/** Monster affixes stay dangerous without punishing a strong hero for being strong. */
import { beforeAll, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { probeSim, spawnProbeMonster } from '../src/agent/probe';
import { autoHero } from '../src/sim/autobuild';
import { initPhysics, type ClipTable } from '../src/sim/sim';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));

beforeAll(async () => {
  await initPhysics();
});

it('thorns reflect is bounded by the monster, never a one-shot for a strong hero', async () => {
  const sim = await probeSim(clips, autoHero({ level: 170, gear: 'rare' }));
  const p = sim.player!;
  const m = spawnProbeMonster(sim, 'golem', 170, 'rare', ['thorns']);
  m.ai.awake = false;
  sim.teleport('player', m.pos.x, m.pos.z + 1.6);
  const life0 = p.life;
  let reflected = 0, dealt = 0, seq = sim.lastEventSeq;
  for (let f = 0; f < 240 && m.state !== 'dead'; f++) {
    p.input.attackHeld = true;
    p.input.aim = { x: m.pos.x, z: m.pos.z };
    sim.step();
    for (const e of sim.eventsSince(seq)) {
      if (e.type === 'hit' && e.target === m.id) dealt = Math.max(dealt, Number(e.damage));
      if (e.type === 'dot' && e.target === 'player' && e.source === m.id) reflected = Math.max(reflected, Number(e.damage));
    }
    seq = sim.lastEventSeq;
  }
  // Big enough that an unbounded 15% reflect would exceed the 10% cap.
  expect(dealt).toBeGreaterThan(p.maxLife);
  expect(reflected).toBeGreaterThan(0);
  expect(reflected).toBeLessThanOrEqual(p.maxLife * 0.1 + 1);
  expect(p.state).not.toBe('dead');
  expect(p.life).toBeGreaterThan(life0 * 0.3);
  sim.dispose();
});
