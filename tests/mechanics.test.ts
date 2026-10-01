/** Level mechanics: each one placed by the campaign and doing its job in the sim. */
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { resetConfig } from '../src/config';
import { AUTHORED, campaignStage, stageMechanics, stageTitle } from '../src/content/campaign';
import type { Level } from '../src/content/level';
import { MECHANIC_IDS } from '../src/content/mechanics';
import { skill } from '../src/content/skills';
import { generateDungeon } from '../src/content/procgen/dungeon';
import { newHero } from '../src/sim/hero';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';
import type { Character, Prop } from '../src/sim/types';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));

beforeAll(async () => {
  await initPhysics();
  resetConfig();
});

function stageLevel(n: number): Level {
  const s = campaignStage(n);
  const level = generateDungeon(s.dungeon);
  s.place?.(level);
  return level;
}

function stageSim(n: number) {
  const hero = newHero();
  const sim = new Sim(stageLevel(n), clips, 3, { hero });
  return { sim, hero, p: sim.get('player') };
}

const propsOf = (sim: Sim, kind: string) => [...sim.props.values()].filter((p) => p.kind === kind);
const monsters = (sim: Sim) => [...sim.characters.values()].filter((c) => c.monster && c.state !== 'dead');
const put = (sim: Sim, c: Character, x: number, z: number) => {
  const q = sim.nav.nearestFree({ x, z });
  sim.teleport(c.id, q.x, q.z);
};
const steps = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) sim.step();
};
/** Puts every monster to sleep far away so a test controls exactly who is where. */
function calm(sim: Sim, except: Character[] = []) {
  for (const m of monsters(sim)) if (!except.includes(m)) sim.despawn(m.id);
}

describe('campaign', () => {
  it('introduces every mechanic once, names levels after them, then combines and goes on forever', () => {
    const intro = AUTHORED.slice(0, MECHANIC_IDS.length);
    expect(new Set(intro.flatMap((a) => a.mechanics))).toEqual(new Set(MECHANIC_IDS));
    for (const a of intro) expect(a.mechanics).toHaveLength(1);
    expect(stageTitle(1)).toBe('Blast Kegs');
    for (const n of [30, 77, 250, 1000]) {
      expect(stageMechanics(n).length).toBeGreaterThanOrEqual(2);
      expect(stageTitle(n).length).toBeGreaterThan(3);
      const level = stageLevel(n);
      expect(level.mechanics).toEqual(stageMechanics(n));
      expect(level.characters.some((c) => c.monster?.rarity === 'unique')).toBe(true);
    }
  });

  it('places each mechanic\'s props into its level', () => {
    const expectKind: Record<string, string> = {
      kegs: 'keg', spikes: 'spikes', shrines: 'shrine', launchpads: 'launchpad', ice: 'ice', lightless: 'beacon', boulders: 'chute',
      rifts: 'rift', vents: 'vent', totems: 'totem', wells: 'well', chrono: 'chrono',
    };
    AUTHORED.slice(0, 13).forEach((a, i) => {
      const level = stageLevel(i + 1);
      const m = a.mechanics[0];
      if (m === 'imps') expect(level.characters.some((c) => c.monster?.def === 'imp')).toBe(true);
      else expect(level.props!.some((p) => p.kind === expectKind[m]), m).toBe(true);
    });
  });
});

describe('mechanics in the sim', () => {
  it('Blast Kegs: a struck keg explodes, chains and credits the kill to the hero', () => {
    const { sim, p } = stageSim(1);
    const keg = propsOf(sim, 'keg')[0];
    const m = monsters(sim)[0];
    calm(sim, [m]);
    put(sim, m, keg.x + 0.9, keg.z);
    put(sim, p, keg.x - 1.4, keg.z);
    p.yaw = Math.PI / 2;
    sim.setInput('player', { attack: true, aim: { x: keg.x, z: keg.z } }, 1);
    steps(sim, 120);
    const types = sim.events.map((e) => e.type);
    expect(types).toContain('keg.lit');
    expect(types).toContain('explosion');
    expect(sim.events.some((e) => e.type === 'hit' && e.target === m.id && e.skill === 'env')).toBe(true);
    sim.dispose();
  });

  it('Spike Traps: plates rise on a cycle and stab whoever stands on them', () => {
    const { sim } = stageSim(2);
    const plate = propsOf(sim, 'spikes')[0];
    const m = monsters(sim)[0];
    calm(sim, [m]);
    m.ai.awake = false;
    put(sim, m, plate.x, plate.z);
    const life = m.life;
    steps(sim, 260);
    expect(sim.events.some((e) => e.type === 'spikes.up')).toBe(true);
    expect(m.life).toBeLessThan(life);
    sim.dispose();
  });

  it('Shrines: touching one grants a 20 s buff', () => {
    const { sim, p } = stageSim(3);
    calm(sim);
    const shrine = propsOf(sim, 'shrine')[0];
    put(sim, p, shrine.x + 0.3, shrine.z);
    steps(sim, 2);
    expect(shrine.state).toBe('used');
    expect(p.statuses.some((s) => s.id === shrine.data.buff)).toBe(true);
    sim.dispose();
  });

  it('Launch Pads: fling the hero over walls to the partner pad', () => {
    const { sim, p } = stageSim(4);
    calm(sim);
    const pad = propsOf(sim, 'launchpad')[0];
    const to = pad.data.to as { x: number; z: number };
    put(sim, p, pad.x, pad.z);
    steps(sim, 2);
    expect(p.action?.skill).toBe('pad_leap');
    steps(sim, 120);
    expect(Math.hypot(p.pos.x - to.x, p.pos.z - to.z)).toBeLessThan(2);
    sim.dispose();
  });

  it('Black Ice: momentum carries on after input stops', () => {
    // Fraction of speed kept 10 frames after letting go.
    const carry = (onIce: boolean) => {
      const { sim, p } = stageSim(5);
      calm(sim);
      const ice = propsOf(sim, 'ice').sort((a, b) => b.scale - a.scale)[0];
      if (!onIce) sim.props.forEach((q) => q.kind === 'ice' && (q.dead = true));
      put(sim, p, ice.x - ice.scale * 0.6, ice.z);
      sim.setInput('player', { moveX: 1, moveZ: 0 }, 50);
      steps(sim, 50);
      const before = Math.hypot(p.vel.x, p.vel.z);
      steps(sim, 10);
      const after = Math.hypot(p.vel.x, p.vel.z);
      sim.dispose();
      return after / Math.max(0.01, before);
    };
    expect(carry(true)).toBeGreaterThan(0.6);
    expect(carry(false)).toBeLessThan(0.2);
  });

  it('Lightless: monsters in the dark are shrouded until a beacon is lit nearby', () => {
    const { sim, p } = stageSim(6);
    expect(sim.level.dark).toBe(true);
    const beacon = propsOf(sim, 'beacon')[1];
    const m = monsters(sim)[0];
    calm(sim, [m]);
    m.ai.awake = false;
    put(sim, m, beacon.x + 2, beacon.z);
    put(sim, p, beacon.x + 30, beacon.z + 30);
    steps(sim, 25);
    expect(m.statuses.some((s) => s.id === 'shrouded')).toBe(true);
    beacon.state = 'lit';
    steps(sim, 45);
    expect(m.statuses.some((s) => s.id === 'shrouded')).toBe(false);
    sim.dispose();
  });

  it('Rolling Boulders: chutes release boulders that roll', () => {
    const { sim } = stageSim(7);
    calm(sim);
    steps(sim, 400);
    const boulders = propsOf(sim, 'boulder');
    expect(sim.events.some((e) => e.type === 'boulder')).toBe(true);
    expect(boulders.some((b) => Math.hypot(b.vx, b.vz) > 0.5 || b.dead)).toBe(true);
    sim.dispose();
  });

  it('Rift Gates: stepping in comes out at the twin', () => {
    const { sim, p } = stageSim(8);
    calm(sim);
    const gate = propsOf(sim, 'rift')[0];
    const twin = sim.props.get(gate.data.to as string) as Prop;
    put(sim, p, gate.x, gate.z);
    steps(sim, 2);
    expect(Math.hypot(p.pos.x - twin.x, p.pos.z - twin.z)).toBeLessThan(3);
    sim.dispose();
  });

  it('Fire Vents: erupt and burn', () => {
    const { sim } = stageSim(9);
    const vent = propsOf(sim, 'vent')[0];
    const m = monsters(sim)[0];
    calm(sim, [m]);
    m.ai.awake = false;
    put(sim, m, vent.x, vent.z);
    const life = m.life;
    steps(sim, 240);
    expect(sim.events.some((e) => e.type === 'vent.erupt')).toBe(true);
    expect(m.life).toBeLessThan(life);
    sim.dispose();
  });

  it('Totems: empower nearby monsters; breaking one empowers the hero', () => {
    const { sim, p } = stageSim(10);
    const totem = propsOf(sim, 'totem')[0];
    const m = monsters(sim)[0];
    calm(sim, [m]);
    m.ai.awake = false;
    put(sim, m, totem.x + 2, totem.z);
    steps(sim, 35);
    expect(m.statuses.some((s) => s.id === 'empowered')).toBe(true);
    put(sim, p, totem.x - 1.2, totem.z);
    for (let i = 0; i < 10; i++) sim.hitProps({ kind: 'circle', radius: 3 }, p.pos.x, p.pos.z, 0, p, skill('slash1'), undefined);
    expect(totem.dead).toBe(true);
    expect(p.statuses.some((s) => s.id === 'power')).toBe(true);
    sim.dispose();
  });

  it('Gravity Wells: pull characters toward the centre', () => {
    const { sim } = stageSim(11);
    const well = propsOf(sim, 'well')[0];
    const m = monsters(sim)[0];
    calm(sim, [m]);
    m.ai.awake = false;
    put(sim, m, well.x + well.scale * 0.7, well.z);
    const before = Math.hypot(m.pos.x - well.x, m.pos.z - well.z);
    m.ai.awake = true;
    sim.despawn('player');
    steps(sim, 60);
    expect(Math.hypot(m.pos.x - well.x, m.pos.z - well.z)).toBeLessThan(before - 0.5);
    sim.dispose();
  });

  it('Chrono Fields: slow whoever is inside', () => {
    const { sim, p } = stageSim(12);
    calm(sim);
    const field = propsOf(sim, 'chrono')[0];
    put(sim, p, field.x, field.z);
    steps(sim, 12);
    expect(p.statuses.some((s) => s.id === 'slowed')).toBe(true);
    sim.dispose();
  });

  it('Loot Imps: flee, and escape if not caught', () => {
    const { sim, p } = stageSim(13);
    const imp = monsters(sim).find((c) => c.monster!.def === 'imp')!;
    calm(sim, [imp]);
    put(sim, p, imp.pos.x + 3, imp.pos.z);
    const d0 = Math.hypot(imp.pos.x - p.pos.x, imp.pos.z - p.pos.z);
    steps(sim, 90);
    expect(Math.hypot(imp.pos.x - p.pos.x, imp.pos.z - p.pos.z)).toBeGreaterThan(d0);
    steps(sim, 60 * 17);
    expect(sim.events.some((e) => e.type === 'imp.escape')).toBe(true);
    sim.dispose();
  });
});
