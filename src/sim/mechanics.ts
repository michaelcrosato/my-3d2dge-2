/**
 * Level mechanics, each a self-contained set of prop kinds and/or a level system registered into
 * the prop registry. Every one is optional to engage with (casual players can just fight) and
 * rewards players who exploit it (mechanic kills give +50% experience and count toward the
 * stage's mastery score):
 *
 *   kegs       Blast Kegs        hit a keg, it blows after a short fuse and chains to its neighbours
 *   spikes     Spike Traps       plates cycle down / warn / up and stab anything standing on them
 *   shrines    Shrines           touch for 20 s of frenzy, power, haste, fortune, conduit or fortify
 *   launchpads Launch Pads       fling whoever steps on them across walls; the landing is a shockwave
 *   ice        Black Ice         no traction, knockback sends things sliding
 *   lightless  Lightless         darkness empowers monsters; light beacons to push it back
 *   boulders   Rolling Boulders  chutes release rolling boulders that crush; hit them to aim them
 *   rifts      Rift Gates        paired gates teleport the hero across the level
 *   vents      Fire Vents        vents warn, then erupt in fire that ignites
 *   totems     Totems            empower and heal nearby monsters until broken
 *   wells      Gravity Wells     pull everything toward their centre
 *   chrono     Chrono Fields     everything inside is slowed
 *   imps       Loot Imps         treasure imps flee, shed gold when hit and escape if not caught
 */
import { addStatus } from './combat';
import { startSkill } from './actions';
import { envBlast, envHit } from './env';
import { dropContainer, spawnGold } from './loot';
import { breakProp, registerProp, registerSystem } from './props';
import type { Sim } from './sim';
import type { Character, Prop } from './types';

const heroTeam = (c: Character | null) => !!c && c.team === 'hero';
const creditOf = (c: Character | null) => (c ? c.owner ?? c.id : null);

// ---------------------------------------------------------------- Blast Kegs

function igniteKeg(sim: Sim, p: Prop, credit: string | null, fuse = 36) {
  if (p.dead || p.state === 'lit') return;
  p.state = 'lit';
  p.timer = fuse;
  p.data.credit = credit;
  sim.emit('keg.lit', { id: p.id, x: p.x, z: p.z });
}

registerProp('keg', { radius: 0.36, height: 0.95, solid: true, hittable: true, anyTeam: true, hp: 1 }, {
  hit(sim, p, by, _s, _h, interact) {
    if (interact) return;
    igniteKeg(sim, p, creditOf(by));
  },
  step(sim, p) {
    if (p.state !== 'lit' || p.dead) return;
    if (--p.timer > 0) return;
    p.dead = true;
    p.state = 'gone';
    sim.removePropCollider(p);
    const credit = (p.data.credit as string | null) ?? null;
    sim.emit('explosion', { x: p.x, z: p.z, radius: 3.4, color: '#ff8a3d', skill: 'keg' });
    if (credit && sim.characters.get(credit)?.team === 'hero') sim.stage.mechanicUses++;
    envBlast(sim, p.x, p.z, 3.4, { dmg: { fire: 22, physical: 10 }, credit, knock: 10, stagger: 200, heavy: true, ailments: { ignite: 60 } });
    // Chain reactions and collateral.
    for (const o of sim.props.values()) {
      if (o.dead || o === p) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d > 3.6) continue;
      if (o.kind === 'keg') igniteKeg(sim, o, credit, 8 + Math.round(d * 3));
      else if (['urn', 'crate', 'barrel', 'coffin'].includes(o.kind)) breakProp(sim, o, credit ? sim.characters.get(credit) ?? null : null);
    }
  },
});

// ---------------------------------------------------------------- Spike Traps

registerProp('spikes', { radius: 0.55, height: 0.1, solid: false, hittable: false, initial: 'down' }, {
  step(sim, p) {
    const period = (p.data.period as number) ?? 150;
    const phase = (sim.frame + ((p.data.phase as number) ?? 0)) % period;
    const next = phase < period - 75 ? 'down' : phase < period - 45 ? 'warn' : 'up';
    if (next !== p.state) {
      p.state = next;
      if (next === 'up') {
        p.data.hit = [];
        sim.emit('spikes.up', { id: p.id, x: p.x, z: p.z });
      }
    }
    if (p.state !== 'up') return;
    const hit = p.data.hit as string[];
    for (const c of sim.characters.values()) {
      if (c.state === 'dead' || c.lift > 0.3 || hit.includes(c.id) || c.iframes > 0) continue;
      if (Math.abs(c.pos.x - p.x) > 0.55 + c.radius * 0.5 || Math.abs(c.pos.z - p.z) > 0.55 + c.radius * 0.5) continue;
      hit.push(c.id);
      envHit(sim, c, p.x, p.z, { dmg: { physical: 16 }, credit: (p.data.credit as string) ?? sim.heroId, stagger: 120, heavy: true, knock: 2, ailments: { bleed: 60 }, heroScale: 0.5 });
    }
  },
});

// ---------------------------------------------------------------- Shrines

const SHRINE_BUFFS = ['frenzy', 'power', 'haste', 'fortune', 'conduit', 'fortify'] as const;
export const SHRINE_COLORS: Record<string, string> = { frenzy: '#5aff6a', power: '#ffd04d', haste: '#7fffd4', fortune: '#ffb84d', conduit: '#9fdcff', fortify: '#c9c9d9' };

function activateShrine(sim: Sim, p: Prop, ch: Character) {
  if (p.state === 'used' || !heroTeam(ch) || ch.owner) return;
  const buff = (p.data.buff as string) ?? SHRINE_BUFFS[0];
  p.state = 'used';
  addStatus(sim, ch, buff, 20, 1, p.id);
  if (buff === 'fortune') for (let i = 0; i < 4; i++) spawnGold(sim, p.x, p.z, sim.level.monsterLevel ?? 1, 1);
  sim.stage.mechanicUses++;
  sim.emit('shrine', { id: p.id, buff, x: p.x, z: p.z });
}

registerProp('shrine', { radius: 0.9, height: 1.3, solid: false, hittable: false, interact: true, touch: true, label: 'Shrine' }, {
  hit(sim, p, by, _s, _h, interact) {
    if (interact && by) activateShrine(sim, p, by);
  },
  touch(sim, p, ch) {
    if (ch.id === sim.heroId) activateShrine(sim, p, ch);
  },
});

// ---------------------------------------------------------------- Launch Pads

registerProp('launchpad', { radius: 0.7, height: 0.2, solid: false, hittable: false, touch: true }, {
  step(_sim, p) {
    if (p.timer > 0) p.timer--;
  },
  touch(sim, p, ch) {
    if (p.timer > 0 || ch.state === 'dead' || ch.lift > 0.2 || (ch.cooldowns.pad ?? 0) > 0) return;
    if (ch.action?.skill === 'pad_leap') return;
    if (ch.state !== 'idle' && ch.state !== 'move' && ch.state !== 'recover' && ch.state !== 'action') return;
    const to = p.data.to as { x: number; z: number } | undefined;
    if (!to) return;
    ch.action = null;
    if (!startSkill(sim, ch, 'pad_leap', to)) return;
    ch.cooldowns.pad = 2.2;
    p.timer = 12;
    if (ch.id === sim.heroId) sim.stage.mechanicUses++;
    sim.emit('launch', { id: ch.id, pad: p.id, x: p.x, z: p.z, toX: to.x, toZ: to.z });
  },
});

// ---------------------------------------------------------------- Black Ice / Gravity Wells / Chrono Fields

registerProp('ice', { radius: 1, height: 0.02, solid: false, hittable: false, field: { radius: 1, friction: 0.1, knockMult: 2.6 } });
registerProp('well', { radius: 1, height: 0.05, solid: false, hittable: false, field: { radius: 1, pull: 4.2 } });
registerProp('chrono', { radius: 1, height: 2, solid: false, hittable: false }, {
  step(sim, p) {
    if (sim.frame % 10 !== 0) return;
    const r = p.scale;
    for (const c of sim.characters.values()) {
      if (c.state === 'dead') continue;
      if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) <= r) addStatus(sim, c, 'slowed', 0.3, 45, p.id);
    }
  },
});

// ---------------------------------------------------------------- Lightless (darkness + beacons)

registerProp('beacon', { radius: 0.45, height: 1.3, solid: true, hittable: true, interact: true, initial: 'unlit', label: 'Beacon' }, {
  hit(sim, p, by) {
    if (p.state === 'lit' || !heroTeam(by)) return;
    p.state = 'lit';
    sim.stage.mechanicUses++;
    sim.emit('beacon.lit', { id: p.id, x: p.x, z: p.z });
  },
});

export const BEACON_RADIUS = 9;
export const LANTERN_RADIUS = 4.5;

registerSystem('lightless', (sim) => {
  if (sim.frame % 20 !== 0) return;
  const lit = [...sim.props.values()].filter((p) => p.kind === 'beacon' && p.state === 'lit');
  const hero = sim.player;
  for (const c of sim.characters.values()) {
    if (!c.monster || c.state === 'dead') continue;
    const inLight = lit.some((b) => Math.hypot(b.x - c.pos.x, b.z - c.pos.z) < BEACON_RADIUS) ||
      (hero && Math.hypot(hero.pos.x - c.pos.x, hero.pos.z - c.pos.z) < LANTERN_RADIUS * (sim.stats(hero).get('lightRadius') / 100));
    if (!inLight) addStatus(sim, c, 'shrouded', 0.5, 1, 'dark');
  }
});

// ---------------------------------------------------------------- Rolling Boulders

let boulderN = 0;
registerProp('chute', { radius: 0.7, height: 1.6, solid: true, hittable: false, navBlock: true }, {
  step(sim, p) {
    const period = (p.data.period as number) ?? 260;
    if ((sim.frame + ((p.data.phase as number) ?? 0)) % period !== 0) return;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const b = sim.addProp({ id: `boulder${p.id}_${boulderN++}`, kind: 'boulder', x: p.x + fx * 1.2, z: p.z + fz * 1.2, data: { life: 540, hit: [] } });
    if (!b?.body) return;
    const m = b.body.mass();
    b.body.applyImpulse({ x: fx * 9 * m, y: 0, z: fz * 9 * m }, true);
    sim.emit('boulder', { id: b.id, x: b.x, z: b.z });
  },
});

registerProp('boulder', { radius: 0.62, height: 1.24, solid: true, hittable: true, anyTeam: true, dynamic: true, ball: true, density: 25, damping: 0.08, friction: 0.6 }, {
  hit(_sim, p, by) {
    if (!p.body || !by) return;
    const dx = p.x - by.pos.x, dz = p.z - by.pos.z, d = Math.hypot(dx, dz) || 1;
    const m = p.body.mass();
    p.body.applyImpulse({ x: (dx / d) * 10 * m, y: 0, z: (dz / d) * 10 * m }, true);
    p.data.credit = creditOf(by);
    p.data.hit = [];
  },
  step(sim, p) {
    const life = ((p.data.life as number) ?? 540) - 1;
    p.data.life = life;
    const speed = Math.hypot(p.vx, p.vz);
    if (life <= 0 || (life < 400 && speed < 0.15)) {
      p.dead = true;
      p.state = 'gone';
      sim.removePropCollider(p);
      sim.emit('prop.break', { id: p.id, kind: 'boulder', x: p.x, z: p.z });
      return;
    }
    if (speed < 2.2) return;
    const hit = p.data.hit as string[];
    for (const c of sim.characters.values()) {
      if (c.state === 'dead' || hit.includes(c.id) || c.iframes > 0 || c.lift > 0.5) continue;
      if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) > 0.62 * p.scale + c.radius + 0.15) continue;
      hit.push(c.id);
      envHit(sim, c, p.x - p.vx, p.z - p.vz, { dmg: { physical: 7 + speed * 2.5 }, credit: (p.data.credit as string) ?? sim.heroId, knock: speed * 1.1, stagger: 200, heavy: true, heroScale: 0.45 });
    }
  },
});

// ---------------------------------------------------------------- Rift Gates

registerProp('rift', { radius: 0.8, height: 2.2, solid: false, hittable: false, touch: true, label: 'Rift Gate' }, {
  step(_sim, p) {
    if (p.timer > 0) p.timer--;
  },
  touch(sim, p, ch) {
    if (ch.id !== sim.heroId || p.timer > 0 || ch.state === 'dead') return;
    const other = sim.props.get(p.data.to as string);
    if (!other) return;
    const ang = other.yaw;
    const dest = sim.nav.nearestFree({ x: other.x + Math.sin(ang) * 1.6, z: other.z + Math.cos(ang) * 1.6 });
    sim.emit('blink', { id: ch.id, fromX: ch.pos.x, fromZ: ch.pos.z, toX: dest.x, toZ: dest.z });
    sim.teleport(ch.id, dest.x, dest.z);
    p.timer = 90;
    other.timer = 90;
    sim.stage.mechanicUses++;
    sim.emit('rift', { from: p.id, to: other.id });
    // Minions follow their master through.
    for (const m of sim.characters.values()) if (m.owner === ch.id && m.state !== 'dead') {
      const q = sim.nav.nearestFree({ x: dest.x + 1, z: dest.z + 1 });
      sim.teleport(m.id, q.x, q.z);
    }
  },
});

// ---------------------------------------------------------------- Fire Vents

registerProp('vent', { radius: 0.6, height: 0.12, solid: false, hittable: false, initial: 'idle' }, {
  step(sim, p) {
    const period = (p.data.period as number) ?? 200;
    const phase = (sim.frame + ((p.data.phase as number) ?? 0)) % period;
    const next = phase < period - 95 ? 'idle' : phase < period - 55 ? 'warn' : 'erupt';
    if (next !== p.state) {
      p.state = next;
      if (next === 'erupt') sim.emit('vent.erupt', { id: p.id, x: p.x, z: p.z });
    }
    if (p.state !== 'erupt' || sim.frame % 10 !== 0) return;
    for (const c of sim.characters.values()) {
      if (c.state === 'dead' || c.iframes > 0 || c.lift > 0.8) continue;
      if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) > 1.15 + c.radius * 0.5) continue;
      envHit(sim, c, p.x, p.z, { dmg: { fire: 5 }, credit: sim.heroId, stagger: 30, ailments: { ignite: 35 }, heroScale: 0.45 });
    }
  },
});

// ---------------------------------------------------------------- Totems

registerProp('totem', { radius: 0.4, height: 1.8, solid: true, hittable: true, hp: 8, navBlock: true, label: 'Totem' }, {
  hit(sim, p, by, _s, _h, interact) {
    if (interact || !heroTeam(by)) return;
    p.hp -= 1;
    p.timer = 8;
    sim.emit('prop.hit', { id: p.id, x: p.x, z: p.z });
    if (p.hp > 0) return;
    p.dead = true;
    p.state = 'gone';
    sim.removePropCollider(p);
    sim.stage.mechanicUses++;
    sim.emit('totem.break', { id: p.id, x: p.x, z: p.z });
    sim.emit('explosion', { x: p.x, z: p.z, radius: 2, color: '#b388ff', skill: 'totem' });
    const hero = sim.player;
    if (hero && hero.state !== 'dead') addStatus(sim, hero, 'power', 8, 0.6, p.id);
  },
  step(sim, p) {
    if (p.timer > 0) p.timer--;
    if (sim.frame % 30 !== 0) return;
    for (const c of sim.characters.values()) {
      if (!c.monster || c.state === 'dead' || Math.hypot(c.pos.x - p.x, c.pos.z - p.z) > 9) continue;
      addStatus(sim, c, 'empowered', 1.2, 1, p.id);
      if (c.life < c.maxLife) c.life = Math.min(c.maxLife, c.life + c.maxLife * 0.015);
    }
  },
});

// ---------------------------------------------------------------- Loot Imps

registerSystem('imps', (sim) => {
  for (const c of sim.characters.values()) {
    if (c.monster?.def !== 'imp' || c.state === 'dead') continue;
    const t = c.monster.timers;
    t.life = t.life ?? 0;
    if (c.ai.awake) t.life += sim.dt;
    // Shed gold while being chased.
    if (c.since.hurt === 0 && sim.rng.chance(0.6)) spawnGold(sim, c.pos.x, c.pos.z, c.level, 0.8);
    if (t.life > 16) {
      sim.emit('imp.escape', { id: c.id, x: c.pos.x, z: c.pos.z });
      sim.emit('blink', { id: c.id, fromX: c.pos.x, fromZ: c.pos.z, toX: c.pos.x, toZ: c.pos.z });
      c.monster.xp = 0;
      sim.kill(c, null, true);
      c.deadTime = 99;
    }
  }
});

/** A caught imp bursts into treasure (called from the death event path). */
export function impTreasure(sim: Sim, c: Character) {
  dropContainer(sim, c.pos.x, c.pos.z, c.level, 'boss');
  sim.stage.mechanicUses++;
}
