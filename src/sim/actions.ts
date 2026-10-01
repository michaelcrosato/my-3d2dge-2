/**
 * Skill execution: starts skills (cost, cooldown, aim), advances their timelines (motion windows,
 * i-frames, channels, combo buffering, cancel windows), fires effects (strikes, projectiles,
 * zones, chains, buffs, summons, heals) and steps projectiles and zones every frame.
 *
 * The same code runs the hero's Fireball, a cultist's bolt and a boss's meteor rain; only the
 * data in content/skills.ts differs.
 */
import { config } from '../config';
import { animSegments, skill as skillDef, type Effect, type HitSpec, type ProjectileSpec, type Shape, type SkillDef, type ZoneSpec } from '../content/skills';
import type { DamageType } from '../content/stats';
import { addStatus, applyPacket, hostile, rollPacket, skillTags } from './combat';
import type { P2 } from './nav';
import type { Sim } from './sim';
import type { ActionState, Character, Packet, Projectile, Zone } from './types';

const sortedEffects = new Map<string, Effect[]>();
export function effectsOf(s: SkillDef): Effect[] {
  let list = sortedEffects.get(s.id);
  if (!list) sortedEffects.set(s.id, (list = [...s.effects].sort((a, b) => a.at - b.at)));
  return list;
}

const CHEST = 1.1;

// ---------------------------------------------------------------- numbers

export function slowFactor(ch: Character): number {
  let slow = 0;
  for (const s of ch.statuses) if (s.id === 'chill' || s.id === 'slowed') slow = Math.max(slow, s.magnitude);
  return 1 - Math.min(70, slow) / 100;
}

/** Timeline speed: attack or cast speed (weapon speed for hero attacks), slows, difficulty. */
export function skillSpeed(sim: Sim, ch: Character, s: SkillDef): number {
  const st = sim.stats(ch);
  const tags = skillTags(s);
  let speed = 1;
  if (s.kind === 'attack') {
    speed = st.get('attackSpeed', tags) / 100;
    if (ch.id === sim.heroId && sim.heroBuild && !s.id.startsWith('m_')) speed *= sim.heroBuild.weapon.speed;
  } else if (s.kind === 'spell') speed = st.get('castSpeed', tags) / 100;
  if (s.id === 'dodge') speed = 1;
  speed *= slowFactor(ch);
  speed *= ch.team === 'hero' ? config['tune.playerSpeed'] : config['tune.enemySpeed'];
  return Math.max(0.2, speed);
}

export function cooldownOf(sim: Sim, ch: Character, s: SkillDef): number {
  if (s.id === 'dodge') {
    const st = sim.stats(ch);
    return st.has('dodgeNoCooldown') ? 0.12 : st.get('dodgeCooldown');
  }
  if (!s.cooldown) return 0;
  return s.cooldown / (sim.stats(ch).get('cooldownRecovery', skillTags(s)) / 100);
}

export function costOf(sim: Sim, ch: Character, s: SkillDef): number {
  if (!s.cost || ch.monster) return 0;
  return s.cost * (sim.stats(ch).get('cost', skillTags(s)) / 100);
}

/** Why a skill can't be used right now (null = usable). */
export function blockedReason(sim: Sim, ch: Character, id: string): string | null {
  const s = skillDef(id);
  if ((ch.cooldowns[id] ?? 0) > 0) return 'cooldown';
  const cost = costOf(sim, ch, s);
  if (cost > 0) {
    if (sim.stats(ch).has('bloodMagic')) {
      if (ch.life <= cost) return 'life';
    } else if (ch.mana < cost) return 'mana';
  }
  return null;
}

export function areaScale(sim: Sim, ch: Character, s: SkillDef): number {
  return Math.sqrt(sim.stats(ch).get('area', skillTags(s)) / 100);
}

function scaleShape(shape: Shape, k: number): Shape {
  switch (shape.kind) {
    case 'circle': return { kind: 'circle', radius: shape.radius * k };
    case 'cone': return { kind: 'cone', radius: shape.radius * k, arc: shape.arc };
    case 'line': return { kind: 'line', length: shape.length * k, width: shape.width * Math.sqrt(k) };
    case 'ring': return { kind: 'ring', radius: shape.radius * k, width: shape.width * k };
  }
}

/** Is a circle of radius pr at (px,pz) touched by `shape` placed at (ox,oz) facing yaw? */
export function inShape(shape: Shape, ox: number, oz: number, yaw: number, px: number, pz: number, pr: number): boolean {
  const dx = px - ox, dz = pz - oz;
  const d = Math.hypot(dx, dz);
  switch (shape.kind) {
    case 'circle':
      return d <= shape.radius + pr;
    case 'ring':
      return d <= shape.radius + pr && d >= shape.radius - shape.width - pr;
    case 'cone': {
      if (d > shape.radius + pr) return false;
      if (d < pr + 0.4) return true;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const cos = (dx * fx + dz * fz) / d;
      const half = (shape.arc / 2) * (Math.PI / 180);
      // Widen the arc by the target's angular size.
      return Math.acos(Math.max(-1, Math.min(1, cos))) <= half + Math.asin(Math.min(1, pr / d));
    }
    case 'line': {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const along = dx * fx + dz * fz;
      const across = Math.abs(dx * fz - dz * fx);
      return along >= -pr && along <= shape.length + pr && across <= shape.width / 2 + pr;
    }
  }
}

// ---------------------------------------------------------------- targeting

/** Nearest hostile in front of `ch` within range with line of sight (auto-aim). */
export function autoTarget(sim: Sim, ch: Character, range: number, preferDir?: P2): Character | null {
  const fx = preferDir?.x ?? Math.sin(ch.yaw), fz = preferDir?.z ?? Math.cos(ch.yaw);
  let best: Character | null = null, bestScore = Infinity;
  for (const o of sim.characters.values()) {
    if (o === ch || o.state === 'dead' || !hostile(ch.team, o.team)) continue;
    const dx = o.pos.x - ch.pos.x, dz = o.pos.z - ch.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range + o.radius) continue;
    const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    // Prefer targets in front: distance plus a penalty for being off-axis.
    const score = d + (1 - cos) * 3;
    if (score < bestScore && sim.lineOfSight({ x: ch.pos.x, y: ch.pos.y + CHEST, z: ch.pos.z }, { x: o.pos.x, y: o.pos.y + CHEST * o.scale, z: o.pos.z })) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

// ---------------------------------------------------------------- starting

export function startSkill(sim: Sim, ch: Character, id: string, aim: P2 | null, moveDir?: P2 | null): boolean {
  const s = skillDef(id);
  if (blockedReason(sim, ch, id)) return false;
  const cost = costOf(sim, ch, s);
  if (cost > 0) {
    if (sim.stats(ch).has('bloodMagic')) ch.life -= cost;
    else ch.mana -= cost;
  }
  const cd = cooldownOf(sim, ch, s);
  if (cd > 0) ch.cooldowns[id] = cd;
  const speed = skillSpeed(sim, ch, s);
  let ax: number, az: number;
  if (s.aim === 'self') {
    ax = ch.pos.x + Math.sin(ch.yaw);
    az = ch.pos.z + Math.cos(ch.yaw);
    if (aim) {
      ax = aim.x;
      az = aim.z;
    }
  } else if (s.aim === 'direction') {
    const d = moveDir && Math.hypot(moveDir.x, moveDir.z) > 0.1 ? moveDir : aim ? { x: aim.x - ch.pos.x, z: aim.z - ch.pos.z } : { x: Math.sin(ch.yaw), z: Math.cos(ch.yaw) };
    const l = Math.hypot(d.x, d.z) || 1;
    ax = ch.pos.x + (d.x / l) * s.range;
    az = ch.pos.z + (d.z / l) * s.range;
  } else if (aim) {
    ax = aim.x;
    az = aim.z;
  } else {
    const t = autoTarget(sim, ch, s.range + 2.5);
    if (t) {
      ax = t.pos.x;
      az = t.pos.z;
    } else {
      ax = ch.pos.x + Math.sin(ch.yaw) * s.range;
      az = ch.pos.z + Math.cos(ch.yaw) * s.range;
    }
  }
  let dx = ax - ch.pos.x, dz = az - ch.pos.z;
  let dl = Math.hypot(dx, dz);
  if (dl < 1e-3) {
    dx = Math.sin(ch.yaw);
    dz = Math.cos(ch.yaw);
    dl = 1;
  }
  const dirX = dx / dl, dirZ = dz / dl;
  if (s.aim !== 'self' || aim) ch.yaw = Math.atan2(dirX, dirZ);
  let destX = ax, destZ = az;
  const m = s.motion;
  if (m && (m.kind === 'dash' || m.kind === 'leap' || m.kind === 'blink')) {
    const maxD = m.distance ?? 5;
    const want = m.toAim ? Math.min(maxD, Math.max(m.kind === 'blink' ? 1 : 2.5, dl)) : maxD;
    const goal = { x: ch.pos.x + dirX * want, z: ch.pos.z + dirZ * want };
    const dest = m.over ? sim.nav.nearestFree(goal) : sim.nav.clampLine({ x: ch.pos.x, z: ch.pos.z }, goal);
    destX = dest.x;
    destZ = dest.z;
  }
  const a: ActionState = {
    skill: id, t: 0, dur: s.time / speed, next: 0, aimX: ax, aimZ: az, dirX, dirZ, startX: ch.pos.x, startZ: ch.pos.z,
    destX, destZ, swept: [], sweepUntil: -1, sweepRadius: 0, sweepHit: null, loops: 0, queued: false,
  };
  ch.action = a;
  ch.state = 'action';
  ch.stateTime = 0;
  ch.order = null;
  if (id === 'dodge') ch.since.dodge = 0;
  // Telegraphed strikes become zones right away, so the warning shows for the whole wind-up.
  for (const e of effectsOf(s)) {
    if (e.type !== 'strike' || !e.telegraph) continue;
    const k = areaScale(sim, ch, s);
    const off = e.offset ?? 0;
    const zx = ch.pos.x + dirX * off, zz = ch.pos.z + dirZ * off;
    const spec: ZoneSpec = { shape: e.shape, delay: e.at * a.dur, duration: 0, hit: e.hit, visual: 'telegraph' };
    addZone(sim, ch, s, spec, zx, zz, ch.yaw, k);
  }
  const seg = animSegments(s)[0];
  sim.playClip(ch, seg.clip, seg.from ?? 0);
  sim.emit('skill', { id: ch.id, skill: id, x: ch.pos.x, z: ch.pos.z, ax: Math.round(ax * 100) / 100, az: Math.round(az * 100) / 100 });
  return true;
}

// ---------------------------------------------------------------- per frame

export interface ActionOutput {
  wantX: number;
  wantZ: number;
  /** Acceleration multiplier (>=3 = snap to the wanted velocity). */
  control: number;
  ghost: boolean;
  /** Flying over walls: no collisions at all. */
  fly: boolean;
  done: boolean;
}

export function updateAction(sim: Sim, ch: Character, held: boolean, moveX: number, moveZ: number, runSpeed: number): ActionOutput {
  const a = ch.action!;
  const s = skillDef(a.skill);
  const out: ActionOutput = { wantX: 0, wantZ: 0, control: 3, ghost: false, fly: false, done: false };
  const dt = sim.dt;
  const prevT = a.t;
  a.t += dt / Math.max(0.05, a.dur);
  // Channels loop while held and paid for.
  if (s.channel) {
    if (s.channel.costPerSecond && !ch.monster) {
      const cost = s.channel.costPerSecond * dt * (sim.stats(ch).get('cost', skillTags(s)) / 100);
      if (sim.stats(ch).has('bloodMagic')) ch.life -= cost;
      else if (ch.mana >= cost) ch.mana -= cost;
      else held = false;
    }
    if (a.t >= s.channel.to && held) {
      a.t = s.channel.from + (a.t - s.channel.to);
      a.loops++;
      a.next = effectsOf(s).findIndex((e) => e.at >= s.channel!.from);
      if (a.next < 0) a.next = effectsOf(s).length;
    }
    const ms = s.channel.moveSpeed ?? 0;
    if (ms > 0) {
      out.wantX = moveX * runSpeed * ms;
      out.wantZ = moveZ * runSpeed * ms;
      out.control = 1;
    }
  }
  // Motion windows.
  const m = s.motion;
  if (m && a.t >= m.from && prevT <= m.to) {
    const win = Math.max(1e-3, (m.to - m.from) * a.dur);
    if (m.kind === 'lunge') {
      out.wantX = a.dirX * (m.speed ?? 2);
      out.wantZ = a.dirZ * (m.speed ?? 2);
    } else if (m.kind === 'dash' || m.kind === 'leap') {
      const dist = Math.hypot(a.destX - a.startX, a.destZ - a.startZ);
      const v = dist / win;
      if (a.t <= m.to) {
        out.wantX = a.dirX * v;
        out.wantZ = a.dirZ * v;
      }
      out.ghost = !!m.ghost;
      out.fly = !!m.over && a.t <= m.to;
      if (m.kind === 'leap') {
        const u = Math.min(1, Math.max(0, (a.t - m.from) / (m.to - m.from)));
        ch.lift = (m.height ?? 1.5) * 4 * u * (1 - u);
      }
    } else if (m.kind === 'blink' && prevT < m.from && a.t >= m.from) {
      sim.emit('blink', { id: ch.id, fromX: ch.pos.x, fromZ: ch.pos.z, toX: a.destX, toZ: a.destZ });
      sim.teleport(ch.id, a.destX, a.destZ);
      ch.state = 'action';
    }
  } else if (m?.kind === 'leap') ch.lift = 0;
  if (s.iframes) ch.iframes = a.t >= s.iframes[0] && a.t <= s.iframes[1] ? dt * 2 : 0;
  // Visual spin.
  const seg = animSegments(s);
  const cur = seg.find((x) => a.t >= x.start && a.t < x.start + x.span) ?? seg[seg.length - 1];
  if (cur.spin) ch.spin += cur.spin * Math.PI * 2 * dt;
  // Effects.
  const effects = effectsOf(s);
  while (a.next < effects.length && effects[a.next].at <= a.t) fire(sim, ch, s, effects[a.next++]);
  // Sweeps hit everything they pass through once.
  if (a.sweepUntil >= 0 && a.t <= a.sweepUntil) sweep(sim, ch, s, a);
  // Pose the humanoid clip from timeline progress.
  const local = Math.min(1, Math.max(0, (a.t - cur.start) / Math.max(1e-6, cur.span)));
  const clipDur = sim.clipDuration(cur.clip);
  const from = cur.from ?? 0, to = cur.to ?? clipDur;
  sim.scrubClip(ch, cur.clip, from + local * (to - from));
  if (a.t >= 1) {
    out.done = true;
    ch.lift = 0;
  }
  return out;
}

function sweep(sim: Sim, ch: Character, s: SkillDef, a: ActionState) {
  for (const o of sim.characters.values()) {
    if (o === ch || o.state === 'dead' || !hostile(ch.team, o.team) || a.swept.includes(o.id)) continue;
    if (Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z) > a.sweepRadius + o.radius) continue;
    a.swept.push(o.id);
    const p = rollPacket(sim, ch, s, a.sweepHit ?? undefined, o);
    applyPacket(sim, o, p, ch.pos.x - a.dirX, ch.pos.z - a.dirZ);
  }
  sim.hitProps({ kind: 'circle', radius: a.sweepRadius }, ch.pos.x, ch.pos.z, 0, ch, s, a.sweepHit ?? undefined);
}

// ---------------------------------------------------------------- effects

function fire(sim: Sim, ch: Character, s: SkillDef, e: Effect) {
  const a = ch.action!;
  const st = sim.stats(ch);
  const tags = skillTags(s);
  switch (e.type) {
    case 'strike': {
      if (e.telegraph) return;
      const shape = scaleShape(e.shape, areaScale(sim, ch, s));
      const off = e.offset ?? 0;
      const ox = ch.pos.x + a.dirX * off, oz = ch.pos.z + a.dirZ * off;
      strikeArea(sim, ch, s, shape, ox, oz, ch.yaw, e.hit);
      sim.emit('strike', { id: ch.id, skill: s.id, x: ox, z: oz, yaw: Math.round(ch.yaw * 1000) / 1000, shape });
      break;
    }
    case 'projectile': {
      const extra = s.tags.includes('projectile') ? Math.round(st.get('projectiles', tags)) : 0;
      const count = (e.count ?? 1) + extra;
      const spread = ((e.spread ?? (count > 1 ? 12 * (count - 1) : 0)) * Math.PI) / 180;
      const baseYaw = Math.atan2(a.dirX, a.dirZ);
      for (let i = 0; i < count; i++) {
        const yaw = count > 1 ? baseYaw - spread / 2 + (spread * i) / (count - 1) : baseYaw;
        launch(sim, ch, s, e.projectile, yaw, a.aimX, a.aimZ);
      }
      break;
    }
    case 'zone': {
      const k = areaScale(sim, ch, s);
      const n = e.count ?? 1;
      for (let i = 0; i < n; i++) {
        let x = e.where === 'aim' ? a.aimX : ch.pos.x, z = e.where === 'aim' ? a.aimZ : ch.pos.z;
        if (e.where === 'front') {
          x += a.dirX * 1.5;
          z += a.dirZ * 1.5;
        }
        if (e.where === 'aim') {
          // Clamp the aim point to the skill range and to walkable ground.
          const d = Math.hypot(x - ch.pos.x, z - ch.pos.z);
          if (d > s.range + 1) {
            x = ch.pos.x + ((x - ch.pos.x) / d) * (s.range + 1);
            z = ch.pos.z + ((z - ch.pos.z) / d) * (s.range + 1);
          }
        }
        if (e.scatter && n > 1) {
          const ang = sim.rng.next() * Math.PI * 2, r = Math.sqrt(sim.rng.next()) * e.scatter;
          x += Math.cos(ang) * r;
          z += Math.sin(ang) * r;
        }
        addZone(sim, ch, s, e.zone, x, z, ch.yaw, k);
      }
      break;
    }
    case 'chain': {
      const jumps = e.jumps + Math.round(st.get('chain', tags));
      const pts: Array<[number, number]> = [[ch.pos.x, ch.pos.z]];
      const hit = new Set<string>();
      // First target: nearest to the aim point within range, in front.
      let cur: Character | null = null;
      let bestD = Infinity;
      for (const o of sim.characters.values()) {
        if (o.state === 'dead' || !hostile(ch.team, o.team)) continue;
        const dc = Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z);
        if (dc > e.range + o.radius) continue;
        const da = Math.hypot(o.pos.x - a.aimX, o.pos.z - a.aimZ);
        if (da < bestD && sim.lineOfSight({ x: ch.pos.x, y: CHEST, z: ch.pos.z }, { x: o.pos.x, y: CHEST, z: o.pos.z })) {
          bestD = da;
          cur = o;
        }
      }
      let fromX = ch.pos.x, fromZ = ch.pos.z;
      for (let j = 0; cur && j <= jumps; j++) {
        hit.add(cur.id);
        pts.push([cur.pos.x, cur.pos.z]);
        applyPacket(sim, cur, rollPacket(sim, ch, s, e.hit, cur), fromX, fromZ);
        fromX = cur.pos.x;
        fromZ = cur.pos.z;
        let next: Character | null = null, nd = Infinity;
        for (const o of sim.characters.values()) {
          if (o.state === 'dead' || hit.has(o.id) || !hostile(ch.team, o.team)) continue;
          const d = Math.hypot(o.pos.x - fromX, o.pos.z - fromZ);
          if (d < e.jumpRange && d < nd) {
            nd = d;
            next = o;
          }
        }
        cur = next;
      }
      if (pts.length === 1) pts.push([a.aimX, a.aimZ]);
      sim.emit('chain', { id: ch.id, skill: s.id, visual: e.visual, pts: pts.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]) });
      break;
    }
    case 'sweep':
      a.sweepUntil = e.until;
      a.sweepRadius = e.radius * areaScale(sim, ch, s);
      a.sweepHit = e.hit ?? null;
      break;
    case 'buff': {
      const targets = e.target === 'self' ? [ch] : [...sim.characters.values()].filter((o) => o.team === ch.team && o.state !== 'dead' && Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z) <= (e.radius ?? 8));
      for (const t of targets) addStatus(sim, t, e.status, e.duration, e.magnitude ?? 1, ch.id);
      break;
    }
    case 'heal': {
      const targets = e.target === 'self' ? [ch] : [...sim.characters.values()].filter((o) => o.team === ch.team && o.state !== 'dead' && Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z) <= (e.radius ?? 8));
      for (const t of targets) {
        t.life = Math.min(t.maxLife, t.life + (t.maxLife * e.pct) / 100);
        sim.emit('heal', { target: t.id, x: t.pos.x, z: t.pos.z });
      }
      break;
    }
    case 'summon':
      sim.summon(ch, e.monster, e.count, e.duration);
      break;
    case 'selfDestruct':
      ch.life = 0;
      sim.kill(ch, null);
      break;
  }
}

/** Hits every hostile character and breakable prop touched by a shape (with line of sight). */
export function strikeArea(sim: Sim, ch: Character, s: SkillDef, shape: Shape, ox: number, oz: number, yaw: number, hit: HitSpec | undefined) {
  const from = { x: ch.pos.x, y: ch.pos.y + CHEST * ch.scale, z: ch.pos.z };
  let hits = 0;
  for (const o of sim.characters.values()) {
    if (o === ch || o.state === 'dead' || !hostile(ch.team, o.team)) continue;
    if (!inShape(shape, ox, oz, yaw, o.pos.x, o.pos.z, o.radius)) continue;
    if (!sim.lineOfSight(from, { x: o.pos.x, y: o.pos.y + CHEST * Math.min(1.5, o.scale), z: o.pos.z })) continue;
    hits++;
    applyPacket(sim, o, rollPacket(sim, ch, s, hit, o), ch.pos.x, ch.pos.z);
  }
  const props = sim.hitProps(shape, ox, oz, yaw, ch, s, hit);
  sim.knockCrates(ch, shape, ox, oz, yaw, hit?.knock ?? 3);
  if (hits) {
    // Local hitstop: the attacker's swing bites for a few frames.
    ch.freeze = Math.max(ch.freeze, Math.min(4, 1 + hits));
    if (hit?.heavy) sim.hitstop = Math.max(sim.hitstop, Math.round(config['sim.hitstopFrames'] * 0.6));
  } else if (!props) sim.emit('whiff', { id: ch.id, skill: s.id });
  return hits;
}

function launch(sim: Sim, ch: Character, s: SkillDef, spec: ProjectileSpec, yaw: number, aimX: number, aimZ: number) {
  const st = sim.stats(ch);
  const tags = skillTags(s);
  const speed = spec.speed * (st.get('projectileSpeed', tags) / 100);
  const vx = Math.sin(yaw) * speed, vz = Math.cos(yaw) * speed;
  const packet = rollPacket(sim, ch, s, spec.hit, null);
  const color = s.color ?? elementColor(packet);
  let lob: Projectile['lob'] = null;
  if (spec.lob) {
    const d = Math.min(spec.range, Math.hypot(aimX - ch.pos.x, aimZ - ch.pos.z));
    const dirX = Math.sin(yaw), dirZ = Math.cos(yaw);
    const t = sim.nav.clampLine({ x: ch.pos.x, z: ch.pos.z }, { x: ch.pos.x + dirX * d, z: ch.pos.z + dirZ * d });
    lob = { fx: ch.pos.x, fz: ch.pos.z, tx: t.x, tz: t.z, t: 0, T: Math.max(0.35, d / speed) };
  }
  const p: Projectile = {
    id: sim.nextId(), owner: ch.id, team: ch.team, skill: s.id, spec, packet,
    x: ch.pos.x + Math.sin(yaw) * 0.5, y: ch.pos.y + 1.15 * Math.min(1.6, ch.scale), z: ch.pos.z + Math.cos(yaw) * 0.5,
    prevX: ch.pos.x, prevZ: ch.pos.z, vx, vz, traveled: 0, range: spec.range,
    pierce: (spec.pierce ?? 0) + Math.round(st.get('pierce', tags)), chain: (spec.chain ?? 0) + Math.round(st.get('chain', tags)),
    hit: [], lob, dead: false, color,
  };
  sim.projectiles.push(p);
  sim.emit('projectile', { id: p.id, owner: ch.id, visual: spec.visual });
}

export function elementColor(p: Packet): string {
  let best: DamageType = 'physical', v = -1;
  for (const [k, x] of Object.entries(p.dmg) as Array<[DamageType, number]>) if (x > v) {
    v = x;
    best = k;
  }
  return ({ physical: '#e8e0d0', fire: '#ff8a3d', cold: '#8fd8ff', lightning: '#ffe95c', chaos: '#a6e04a' } as const)[best];
}

export function addZone(sim: Sim, ch: Character, s: SkillDef, spec: ZoneSpec, x: number, z: number, yaw: number, areaK = 1): Zone {
  const packet = rollPacket(sim, ch, s, spec.hit, null);
  const zone: Zone = {
    id: sim.nextId(), owner: ch.id, team: ch.team, skill: s.id, spec, shape: scaleShape(spec.shape, areaK), packet,
    x, z, yaw, delay: spec.delay, life: spec.duration, tickIn: spec.tick ?? 0.5, resolved: false,
    follow: spec.follow ? ch.id : null, angle: 0, color: s.color ?? elementColor(packet), dead: false,
  };
  sim.zones.push(zone);
  sim.emit('zone', { id: zone.id, owner: ch.id, skill: s.id, visual: spec.visual, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, delay: spec.delay });
  return zone;
}

// ---------------------------------------------------------------- projectiles & zones

export function stepProjectiles(sim: Sim) {
  const dt = sim.dt;
  for (const p of sim.projectiles) {
    if (p.dead) continue;
    const owner = sim.characters.get(p.owner) ?? null;
    p.prevX = p.x;
    p.prevZ = p.z;
    if (p.lob) {
      const L = p.lob;
      L.t += dt;
      const u = Math.min(1, L.t / L.T);
      p.x = L.fx + (L.tx - L.fx) * u;
      p.z = L.fz + (L.tz - L.fz) * u;
      p.y = 1.2 + 3 * u * (1 - u) * Math.min(2, L.T);
      if (u >= 1) {
        explode(sim, p, owner, p.x, p.z);
        p.dead = true;
      }
      continue;
    }
    // Homing toward the nearest hostile.
    if (p.spec.homing) {
      let best: Character | null = null, bd = 7;
      for (const o of sim.characters.values()) {
        if (o.state === 'dead' || !hostile(p.team, o.team) || p.hit.includes(o.id)) continue;
        const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        const sp = Math.hypot(p.vx, p.vz);
        const tx = best.pos.x - p.x, tz = best.pos.z - p.z, tl = Math.hypot(tx, tz) || 1;
        const k = Math.min(1, p.spec.homing * dt);
        p.vx = p.vx * (1 - k) + (tx / tl) * sp * k;
        p.vz = p.vz * (1 - k) + (tz / tl) * sp * k;
        const nl = Math.hypot(p.vx, p.vz) || 1;
        p.vx = (p.vx / nl) * sp;
        p.vz = (p.vz / nl) * sp;
      }
    }
    const step = Math.hypot(p.vx, p.vz) * dt;
    // Walls stop projectiles (Rapier ray cast along the step).
    const wall = sim.castBlockers(p.x, p.y, p.z, p.vx * dt, 0, p.vz * dt);
    const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    // Characters along the segment.
    let target: Character | null = null, tBest = Infinity;
    for (const o of sim.characters.values()) {
      if (o.state === 'dead' || !hostile(p.team, o.team) || p.hit.includes(o.id)) continue;
      const r = o.radius + p.spec.radius;
      const t = segmentCircle(p.x, p.z, nx, nz, o.pos.x, o.pos.z, r);
      if (t !== null && t < tBest) {
        tBest = t;
        target = o;
      }
    }
    const wallT = wall !== null ? wall / Math.max(1e-6, step) : Infinity;
    if (target && tBest <= wallT) {
      p.x += p.vx * dt * tBest;
      p.z += p.vz * dt * tBest;
      p.hit.push(target.id);
      const packet = owner && owner.state !== 'dead' ? rollPacket(sim, owner, skillDef(p.skill), p.spec.hit, target) : p.packet;
      applyPacket(sim, target, packet, p.x - p.vx, p.z - p.vz);
      if (p.spec.explode) explode(sim, p, owner, p.x, p.z);
      if (p.pierce > 0) {
        p.pierce--;
        continue;
      }
      if (p.chain > 0) {
        p.chain--;
        let next: Character | null = null, nd = 7;
        for (const o of sim.characters.values()) {
          if (o.state === 'dead' || !hostile(p.team, o.team) || p.hit.includes(o.id)) continue;
          const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
          if (d < nd) {
            nd = d;
            next = o;
          }
        }
        if (next) {
          const sp = Math.hypot(p.vx, p.vz), l = nd || 1;
          p.vx = ((next.pos.x - p.x) / l) * sp;
          p.vz = ((next.pos.z - p.z) / l) * sp;
          p.traveled = Math.max(0, p.traveled - 4);
          continue;
        }
      }
      p.dead = true;
      continue;
    }
    // Props (kegs, urns) in the way.
    const prop = sim.propOnSegment(p.x, p.z, nx, nz, p.spec.radius);
    if (prop && (wall === null || prop.t <= wallT)) {
      sim.damageProp(prop.prop, owner, skillDef(p.skill), p.spec.hit);
      if (p.spec.explode) explode(sim, p, owner, prop.prop.x, prop.prop.z);
      p.dead = true;
      continue;
    }
    if (wall !== null) {
      p.x += p.vx * dt * wallT;
      p.z += p.vz * dt * wallT;
      if (p.spec.explode) explode(sim, p, owner, p.x, p.z);
      sim.emit('projectile.wall', { id: p.id, x: p.x, z: p.z });
      p.dead = true;
      continue;
    }
    p.x = nx;
    p.z = nz;
    p.traveled += step;
    if (p.traveled >= p.range) {
      if (p.spec.explode) explode(sim, p, owner, p.x, p.z);
      p.dead = true;
    }
  }
  if (sim.projectiles.some((p) => p.dead)) sim.projectiles = sim.projectiles.filter((p) => !p.dead);
}

function explode(sim: Sim, p: Projectile, owner: Character | null, x: number, z: number) {
  const s = skillDef(p.skill);
  const k = owner ? areaScale(sim, owner, s) : 1;
  const radius = (p.spec.explode ?? 0) * k;
  if (radius > 0) {
    for (const o of sim.characters.values()) {
      if (o.state === 'dead' || !hostile(p.team, o.team) || p.hit.includes(o.id)) continue;
      if (Math.hypot(o.pos.x - x, o.pos.z - z) > radius + o.radius) continue;
      const packet = owner && owner.state !== 'dead' ? rollPacket(sim, owner, s, p.spec.hit, o) : p.packet;
      applyPacket(sim, o, packet, x, z);
    }
    if (owner) sim.hitProps({ kind: 'circle', radius }, x, z, 0, owner, s, p.spec.hit);
    sim.emit('explosion', { x, z, radius, color: p.color, skill: p.skill });
  }
  if (p.spec.leaves && owner) addZone(sim, owner, s, p.spec.leaves, x, z, 0, k);
}

/** Parameter t in [0,1] where segment (a->b) first touches a circle, or null. */
export function segmentCircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): number | null {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const A = dx * dx + dz * dz;
  const C = fx * fx + fz * fz - r * r;
  if (C <= 0) return 0;
  if (A < 1e-12) return null;
  const B = 2 * (fx * dx + fz * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}

export function stepZones(sim: Sim) {
  const dt = sim.dt;
  for (const z of sim.zones) {
    if (z.dead) continue;
    const owner = sim.characters.get(z.owner) ?? null;
    if (z.follow) {
      const f = sim.characters.get(z.follow);
      if (!f || f.state === 'dead') {
        z.dead = true;
        continue;
      }
      z.x = f.pos.x;
      z.z = f.pos.z;
      z.angle += dt * 5;
    }
    if (!z.resolved) {
      z.delay -= dt;
      if (z.delay > 0) continue;
      z.resolved = true;
      if ((z.spec.hit?.mult ?? 1) > 0) zoneHit(sim, z, owner, 1);
      sim.emit('zone.resolve', { id: z.id, x: z.x, z: z.z, visual: z.spec.visual, skill: z.skill });
      if (z.spec.duration <= 0) {
        z.dead = true;
        continue;
      }
      z.life = z.spec.duration;
      z.tickIn = z.spec.tick ?? 0.5;
      continue;
    }
    z.life -= dt;
    if (z.spec.slow) {
      for (const o of sim.characters.values()) {
        if (o.state === 'dead' || !(z.hostileToAll || hostile(z.team, o.team))) continue;
        if (inShape(z.shape, z.x, z.z, z.yaw, o.pos.x, o.pos.z, o.radius)) addStatus(sim, o, 'slowed', 0.25, z.spec.slow, z.owner);
      }
    }
    z.tickIn -= dt;
    if (z.tickIn <= 0 && z.spec.tick) {
      z.tickIn += z.spec.tick;
      zoneHit(sim, z, owner, z.spec.tickMult ?? 0.25);
    }
    if (z.life <= 0) z.dead = true;
  }
  if (sim.zones.some((z) => z.dead)) sim.zones = sim.zones.filter((z) => !z.dead);
}

function zoneHit(sim: Sim, z: Zone, owner: Character | null, mult: number) {
  const s = skillDef(z.skill);
  for (const o of sim.characters.values()) {
    if (o.state === 'dead' || !(z.hostileToAll ? o.id !== z.owner : hostile(z.team, o.team))) continue;
    if (!inShape(z.shape, z.x, z.z, z.yaw, o.pos.x, o.pos.z, o.radius)) continue;
    let packet: Packet;
    if (owner && owner.state !== 'dead') packet = rollPacket(sim, owner, s, z.spec.hit, o, mult);
    else {
      packet = { ...z.packet, dmg: { ...z.packet.dmg } };
      for (const k of Object.keys(packet.dmg) as DamageType[]) packet.dmg[k]! *= mult;
    }
    applyPacket(sim, o, packet, z.x, z.z);
  }
  if (owner && mult > 0) sim.hitProps(z.shape, z.x, z.z, z.yaw, owner, s, z.spec.hit);
}
