/** Replays: a recorded run fed into a fresh sim reproduces it frame for frame. */
import { beforeAll, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { buildStageLevel } from '../src/agent/tools/content';
import { autoHero } from '../src/sim/autobuild';
import { Bot } from '../src/sim/bot';
import { decode, encode } from '../src/replays';
import { ReplayPlayer, ReplayRecorder, type Replay } from '../src/sim/replay';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));

beforeAll(async () => {
  await initPhysics();
});

/** The bot plays depth 3 for `frames` while a recorder listens; one loot click mid-run. */
function record(frames: number): { replay: Replay; live: Sim } {
  const level = buildStageLevel({ stage: 3 });
  const hero = autoHero({ level: 6 });
  const meta = { key: '3', title: 'test', level: structuredClone(level), seed: 11, hero: structuredClone(hero), config: {} };
  const sim = new Sim(level, clips, 11, { hero });
  const rec = new ReplayRecorder(sim, meta);
  const bot = new Bot(sim, {});
  let clicked = false;
  for (let f = 0; f < frames; f++) {
    bot.think();
    if (!clicked && sim.pickups.length && f > 200) clicked = sim.pickUp(sim.pickups[0].id) || true;
    rec.capture();
    sim.step();
  }
  expect(rec.valid).toBe(true);
  return { replay: rec.finish(sim.stage.time), live: sim };
}

function play(replay: Replay): ReplayPlayer {
  const r = JSON.parse(JSON.stringify(replay)) as Replay; // through storage
  const sim = new Sim(r.level, clips, r.seed, { hero: r.hero });
  const player = new ReplayPlayer(sim, r);
  while (!player.done) {
    player.apply();
    sim.step();
  }
  return player;
}

it('replays a bot run exactly, commands included, and stays compact', () => {
  const { replay, live } = record(1800);
  expect(replay.frames).toBe(1800);
  expect(replay.cmds.some(([, name]) => name === 'pickUp')).toBe(true);
  const player = play(replay);
  expect(player.sim.hash()).toBe(live.hash());
  expect(player.matches).toBe(true);
  // Input is stored as changes, not 1800 full frames.
  expect(replay.input.length).toBeLessThan(1800);
  live.dispose();
  player.sim.dispose();
});

it('notices a tampered replay', () => {
  const { replay, live } = record(900);
  const k = replay.input.findIndex(([, d]) => d.mx !== undefined && d.mx !== 0);
  replay.input[k][1].mx = -(replay.input[k][1].mx ?? 0);
  const player = play(replay);
  expect(player.matches).toBe(false);
  live.dispose();
  player.sim.dispose();
});

it('marks a run invalid when the build changes mid-depth', () => {
  const level = buildStageLevel({ stage: 2 });
  const hero = autoHero({ level: 4 });
  const sim = new Sim(level, clips, 5, { hero });
  const rec = new ReplayRecorder(sim, { key: '2', title: 't', level, seed: 5, hero: structuredClone(hero), config: {} });
  rec.capture();
  sim.step();
  hero.hotbar = [null, null, null, null, null];
  rec.capture();
  expect(rec.valid).toBe(false);
  rec.stop();
  sim.dispose();
});

it('encodes replays for storage and files, and refuses anything else', async () => {
  const { replay, live } = record(120);
  live.dispose();
  const text = await encode(replay);
  expect(text.startsWith('gz:')).toBe(true);
  expect(await decode(text)).toEqual(replay);
  expect(await decode(JSON.stringify(replay))).toEqual(replay);
  expect(await decode('gz:not-base64!')).toBeNull();
  expect(await decode('{"v":1,"key":"x"}')).toBeNull();
  expect(await decode(JSON.stringify({ ...replay, v: 999 }))).toBeNull();
});
