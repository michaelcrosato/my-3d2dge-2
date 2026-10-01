/** Rapier integration: determinism, queries (ground, line of sight, occlusion), sword reach and crates. */
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { resetConfig } from '../src/config';
import { DEFAULT_LEVEL, type CharacterDef, type Level } from '../src/content/level';
import { isoBasis } from '../src/render/pixelGrid';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));

const levelWith = (characters: CharacterDef[]): Level => ({ ...structuredClone(DEFAULT_LEVEL), characters });
const typesOf = (sim: Sim) => sim.events.map((e) => e.type);

/** Swing once and let the attack play out. */
function swing(sim: Sim, id = 'player') {
  sim.setInput(id, { attack: true }, 1);
  for (let i = 0; i < 60; i++) sim.step();
}

beforeAll(async () => {
  await initPhysics();
  resetConfig();
});

describe('determinism', () => {
  const script = (sim: Sim) => {
    for (let f = 0; f < 480; f++) {
      if (f % 120 === 0) sim.setInput('player', { moveX: Math.sin(f), moveZ: -Math.cos(f), gait: f % 240 ? 'run' : 'sprint' }, 90);
      if (f === 200) sim.setInput('player', { attack: true }, 1);
      if (f === 300) sim.setInput('player', { jump: true }, 1);
      sim.step();
    }
  };

  it('replays identically for the same seed and inputs', () => {
    const a = new Sim(DEFAULT_LEVEL, clips, 7);
    const b = new Sim(DEFAULT_LEVEL, clips, 7);
    script(a);
    script(b);
    expect(a.hash()).toBe(b.hash());
    expect(a.events).toEqual(b.events);
    a.dispose();
    b.dispose();
  });

  it('restores a checkpoint to the exact same future', () => {
    const sim = new Sim(DEFAULT_LEVEL, clips, 3);
    for (let i = 0; i < 90; i++) sim.step();
    const cp = sim.save();
    script(sim);
    const expected = sim.hash();
    sim.restore(cp);
    script(sim);
    expect(sim.hash()).toBe(expected);
    sim.dispose();
  });
});

describe('events', () => {
  it('recentEvents skips events that are older than the window', () => {
    const sim = new Sim(DEFAULT_LEVEL, clips, 5);
    const seq = sim.lastEventSeq;
    sim.emit('test.old');
    for (let i = 0; i < 90; i++) sim.step();
    sim.emit('test.new');
    const types = (es: { type: string }[]) => es.map((e) => e.type).filter((t) => t.startsWith('test.'));
    expect(types(sim.eventsSince(seq))).toEqual(['test.old', 'test.new']);
    expect(types(sim.recentEvents(seq, 60))).toEqual(['test.new']);
    sim.dispose();
  });
});

describe('Rapier queries', () => {
  it('probes the ground under characters, including crate tops', () => {
    const sim = new Sim(levelWith([{ id: 'player', preset: 'ranger', x: 0, z: 4.5, brain: 'input' }]), clips, 1);
    sim.step();
    const ch = sim.get('player');
    expect(ch.groundY).toBeCloseTo(0, 2);
    // Drop the player onto the 1.4 m crate at (6, 6).
    sim.teleport('player', 6, 6);
    ch.body.setTranslation({ x: 6, y: 3, z: 6 }, true);
    ch.body.setNextKinematicTranslation({ x: 6, y: 3, z: 6 });
    for (let i = 0; i < 90; i++) sim.step();
    expect(ch.grounded).toBe(true);
    expect(ch.groundY).toBeCloseTo(1.4, 1);
    expect(ch.pos.y).toBeCloseTo(1.4, 1);
    sim.dispose();
  });

  it('blocks line of sight through walls but not over knee-high walls', () => {
    const sim = new Sim(levelWith([]), clips, 1);
    sim.step();
    // partition_a: z = -1.5, x in [-8, -3.5], 1.6 m tall.
    expect(sim.lineOfSight({ x: -6, y: 1.1, z: -3 }, { x: -6, y: 1.1, z: 0 })).toBe(false);
    expect(sim.lineOfSight({ x: -6, y: 1.1, z: 0 }, { x: -2, y: 1.1, z: 0 })).toBe(true);
    // wall_south_low is 0.45 m: chest-height lines pass over it.
    expect(sim.lineOfSight({ x: 0, y: 1.1, z: 7.5 }, { x: 0, y: 1.1, z: 9 })).toBe(true);
    sim.dispose();
  });

  it('ray casts report the first floor, wall or crate hit (pointer picking)', () => {
    const sim = new Sim(levelWith([]), clips, 1);
    sim.step();
    const crate = sim.raycast({ x: 0.8, y: 5, z: 1.2 }, { x: 0, y: -2, z: 0 });
    expect(crate).toMatchObject({ id: 'crate_push_1', y: 1, distance: 4 });
    expect(sim.raycast({ x: 0, y: 5, z: 4.5 }, { x: 0, y: -1, z: 0 })).toMatchObject({ id: 'floor', y: 0 });
    expect(sim.raycast({ x: -6, y: 1, z: 0 }, { x: 0, y: 0, z: -1 })).toMatchObject({ id: 'partition_a', z: -1.3 });
    expect(sim.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    sim.dispose();
  });

  it('reports view occlusion only for characters hidden behind walls', () => {
    const sim = new Sim(levelWith([
      { id: 'hidden', preset: 'dummy', x: -6, z: -2.5, brain: 'idle' },
      { id: 'open', preset: 'dummy', x: 0, z: 4.5, brain: 'idle' },
    ]), clips, 1);
    sim.step();
    const b = isoBasis(45, 30);
    expect(sim.occluded('hidden', b.forward, b.right)).toBe(true);
    expect(sim.occluded('open', b.forward, b.right)).toBe(false);
    sim.dispose();
  });
});

describe('combat through Rapier', () => {
  it('lands a sword hit in the open', () => {
    const sim = new Sim(levelWith([
      { id: 'player', preset: 'ranger', x: -1, z: -3.2, yawDeg: 0, brain: 'input' },
      { id: 'dummy', preset: 'dummy', x: -1, z: -1.8, brain: 'dummy' },
    ]), clips, 1);
    sim.step();
    swing(sim);
    expect(typesOf(sim)).toContain('hit');
    expect(sim.get('dummy').life).toBeLessThan(sim.get('dummy').maxLife);
    sim.dispose();
  });

  it('does not hit through a wall', () => {
    // Same distance as above, but partition_a stands between them.
    const sim = new Sim(levelWith([
      { id: 'player', preset: 'ranger', x: -6, z: -2.3, yawDeg: 0, brain: 'input' },
      { id: 'dummy', preset: 'dummy', x: -6, z: -0.7, brain: 'dummy' },
    ]), clips, 1);
    sim.step();
    swing(sim);
    expect(typesOf(sim)).not.toContain('hit');
    expect(typesOf(sim)).toContain('whiff');
    expect(sim.get('dummy').life).toBe(sim.get('dummy').maxLife);
    sim.dispose();
  });

  it('shoves a pushable crate with an impulse', () => {
    // crate_push_1 sits at (0.8, 1.2); stand south of it facing north (-Z).
    const sim = new Sim(levelWith([{ id: 'player', preset: 'ranger', x: 0.8, z: 2.6, yawDeg: 180, brain: 'input' }]), clips, 1);
    sim.step();
    const crate = sim.crates.get('crate_push_1')!;
    const before = { ...crate.pos };
    swing(sim);
    expect(typesOf(sim)).toContain('crate.hit');
    expect(before.z - crate.pos.z).toBeGreaterThan(0.1);
    sim.dispose();
  });

  it('reports crate contacts with walls from the collision event queue', () => {
    const sim = new Sim(levelWith([]), clips, 1);
    sim.step();
    // crate_push_3 at (5.2, -1.8); throw it east into wall_east_low (x = 8.25).
    const crate = sim.crates.get('crate_push_3')!;
    crate.body.applyImpulse({ x: crate.body.mass() * 30, y: 0, z: 0 }, true);
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.events.some((e) => e.type === 'crate.contact' && e.crate === 'crate_push_3' && e.with === 'wall_east_low')).toBe(true);
    sim.dispose();
  });
});
