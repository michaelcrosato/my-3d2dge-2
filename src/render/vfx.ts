/**
 * Visual effects, all driven by sim state and sim events (the sim never knows they exist):
 * pooled instanced particles (sparks, embers, debris, snow), slash arcs on strikes, telegraph
 * decals that fill up before a boss slam lands, lingering ground zones, projectile meshes with
 * trails and lights, explosions, chain lightning, blink puffs, level-up pillars and screen shake.
 * Rendered in the low-res pass like everything else, so effects become crisp pixel art.
 */
import * as THREE from 'three';
import { SKILLS, type Shape } from '../content/skills';
import { DAMAGE_COLORS, type DamageType } from '../content/stats';
import type { Sim, SimEvent } from '../sim/sim';
import type { Projectile, Zone } from '../sim/types';
import { cone, merge, octa, sphere, box } from './geo';
import type { LightPool } from './lights';
import { writesNormals } from './materials';
import { LAYER } from './pixelPipeline';
import { SHRINE_COLORS } from '../sim/mechanics';

const MAX_PARTICLES = 3000;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  glow: boolean;
}

interface Flash { x: number; y: number; z: number; color: string; intensity: number; range: number; t: number; max: number }

interface Transient {
  mesh: THREE.Object3D;
  t: number;
  max: number;
  update(o: THREE.Object3D, u: number): void;
}

const fxMaterial = (color: THREE.ColorRepresentation, opacity: number) =>
  writesNormals(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }), 'fx');

/** Flat ground geometry for a skill shape (telegraphs and zones), centered at the origin facing +Z. */
export function shapeGeometry(shape: Shape): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (shape.kind) {
    case 'circle':
      g = new THREE.CircleGeometry(shape.radius, 28);
      break;
    case 'ring':
      g = new THREE.RingGeometry(Math.max(0.01, shape.radius - shape.width), shape.radius, 32);
      break;
    case 'cone': {
      const half = (shape.arc / 2) * (Math.PI / 180);
      // CircleGeometry's theta starts on +X; rotate so the wedge faces +Z after laying flat.
      g = new THREE.CircleGeometry(shape.radius, 20, Math.PI / 2 - half, half * 2);
      break;
    }
    case 'line':
      g = new THREE.PlaneGeometry(shape.width, shape.length);
      g.translate(0, shape.length / 2, 0);
      break;
  }
  g.rotateX(-Math.PI / 2);
  // After rotateX(-90°), +Y (plane up) became -Z; flip so shapes face +Z (the character's forward).
  g.rotateY(Math.PI);
  return g;
}

export class Vfx {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private inst: THREE.InstancedMesh;
  private instGlow: THREE.InstancedMesh;
  private flashes: Flash[] = [];
  private transients: Transient[] = [];
  private zoneMeshes = new Map<number, { mesh: THREE.Mesh; fill: THREE.Mesh | null; zone: Zone }>();
  private projMeshes = new Map<number, THREE.Object3D>();
  private dummy = new THREE.Object3D();
  private lastSeq = 0;
  private sim: Sim | null = null;
  /** Screen shake in art pixels (decays). */
  shake = 0;

  constructor() {
    this.group.name = 'vfx';
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    this.inst = new THREE.InstancedMesh(geo, writesNormals(new THREE.MeshLambertMaterial({ color: 0xffffff })), MAX_PARTICLES);
    this.instGlow = new THREE.InstancedMesh(geo, writesNormals(new THREE.MeshBasicMaterial({ color: 0xffffff })), MAX_PARTICLES);
    for (const m of [this.inst, this.instGlow]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
    }
  }

  // ---------------------------------------------------------------- particles

  emit(x: number, y: number, z: number, n: number, o: { color: THREE.ColorRepresentation; speed?: number; up?: number; life?: number; size?: number; gravity?: number; drag?: number; glow?: boolean; spread?: number }) {
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (o.speed ?? 2) * (0.4 + Math.random() * 0.8);
      const sp = o.spread ?? 1;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.2 * sp, y, z: z + (Math.random() - 0.5) * 0.2 * sp,
        vx: Math.cos(a) * s, vy: (o.up ?? 2) * (0.5 + Math.random()), vz: Math.sin(a) * s,
        life: (o.life ?? 0.5) * (0.6 + Math.random() * 0.8), max: 0, size: (o.size ?? 0.12) * (0.7 + Math.random() * 0.6),
        color: new THREE.Color(o.color), gravity: o.gravity ?? 9, drag: o.drag ?? 1.5, glow: o.glow ?? true,
      });
      const p = this.particles[this.particles.length - 1];
      p.max = p.life;
    }
  }

  /** Short point light (explosions, hits, blinks). */
  flash(x: number, y: number, z: number, color: string, intensity: number, range: number, time: number) {
    this.flashes.push({ x, y, z, color, intensity, range, t: 0, max: time });
  }

  private transient(mesh: THREE.Object3D, max: number, update: Transient['update']) {
    mesh.layers.set(LAYER.MAIN);
    this.group.add(mesh);
    this.transients.push({ mesh, t: 0, max, update });
  }

  // ---------------------------------------------------------------- per frame

  update(sim: Sim, dt: number, lights: LightPool, heroId: string) {
    if (sim !== this.sim) {
      this.reset();
      this.sim = sim;
      this.lastSeq = sim.lastEventSeq;
    }
    for (const e of sim.eventsSince(this.lastSeq)) this.onEvent(sim, e, heroId);
    this.lastSeq = sim.lastEventSeq;
    this.syncZones(sim);
    this.syncProjectiles(sim, lights);
    this.stepParticles(dt);
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.t += dt;
      const u = Math.min(1, t.t / t.max);
      t.update(t.mesh, u);
      if (u >= 1) {
        t.mesh.removeFromParent();
        disposeDeep(t.mesh);
        this.transients.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = 1 - f.t / f.max;
      if (k <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      lights.add({ x: f.x, y: f.y, z: f.z, color: f.color, intensity: f.intensity * k, range: f.range, priority: 3 });
    }
    this.shake = Math.max(0, this.shake - dt * 18);
  }

  reset() {
    this.particles.length = 0;
    this.flashes.length = 0;
    for (const t of this.transients) {
      t.mesh.removeFromParent();
      disposeDeep(t.mesh);
    }
    this.transients.length = 0;
    for (const z of this.zoneMeshes.values()) {
      z.mesh.removeFromParent();
      disposeDeep(z.mesh);
    }
    this.zoneMeshes.clear();
    for (const p of this.projMeshes.values()) {
      p.removeFromParent();
      disposeDeep(p);
    }
    this.projMeshes.clear();
    this.shake = 0;
  }

  private stepParticles(dt: number) {
    let n = 0, g = 0;
    const d = this.dummy;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      p.vy -= p.gravity * dt;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const s = p.size * Math.min(1, (p.life / p.max) * 2);
      d.position.set(p.x, p.y, p.z);
      d.scale.setScalar(s);
      d.rotation.set(p.life * 7, p.life * 5, 0);
      d.updateMatrix();
      const target = p.glow ? this.instGlow : this.inst;
      const idx = p.glow ? g++ : n++;
      target.setMatrixAt(idx, d.matrix);
      target.setColorAt(idx, p.color);
    }
    this.inst.count = n;
    this.instGlow.count = g;
    this.inst.instanceMatrix.needsUpdate = true;
    this.instGlow.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
    if (this.instGlow.instanceColor) this.instGlow.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- zones & projectiles

  private syncZones(sim: Sim) {
    const alive = new Set<number>();
    for (const z of sim.zones) {
      alive.add(z.id);
      let entry = this.zoneMeshes.get(z.id);
      if (!entry) {
        const telegraph = !z.resolved && z.spec.delay > 0.05;
        const color = telegraph ? (z.team === 'hero' ? '#ffd27a' : '#ff3a2a') : zoneColor(z);
        const mesh = new THREE.Mesh(shapeGeometry(z.shape), fxMaterial(color, telegraph ? 0.28 : 0.35));
        mesh.renderOrder = 5;
        mesh.layers.set(LAYER.FX);
        let fill: THREE.Mesh | null = null;
        if (telegraph) {
          fill = new THREE.Mesh(shapeGeometry(z.shape), fxMaterial(color, 0.45));
          fill.renderOrder = 6;
          fill.layers.set(LAYER.FX);
          mesh.add(fill);
        }
        this.group.add(mesh);
        entry = { mesh, fill, zone: z };
        this.zoneMeshes.set(z.id, entry);
      }
      entry.zone = z;
      const m = entry.mesh;
      m.position.set(z.x, 0.04 + (z.id % 7) * 0.002, z.z);
      m.rotation.y = z.yaw;
      if (entry.fill) {
        const total = Math.max(0.01, z.spec.delay);
        const u = 1 - Math.max(0, z.delay) / total;
        entry.fill.scale.setScalar(Math.max(0.01, u));
        entry.fill.position.y = 0.002;
        if (z.resolved) {
          entry.fill.visible = false;
          (m.material as THREE.MeshBasicMaterial).color.set(zoneColor(z));
        }
      }
      if (z.resolved && z.life > 0) {
        // Lingering zones breathe and emit particles.
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.22 + 0.1 * Math.sin(performance.now() / 120 + z.id);
        if (Math.random() < 0.35) {
          const r = (z.shape.kind === 'circle' || z.shape.kind === 'ring' || z.shape.kind === 'cone') ? z.shape.radius : 1;
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r;
          this.emit(z.x + Math.cos(a) * rr, 0.1, z.z + Math.sin(a) * rr, 1, { color: zoneColor(z), speed: 0.3, up: 1.5, life: 0.6, size: 0.1, gravity: -1 });
        }
        if (z.follow) {
          m.rotation.y = z.angle;
          if (z.spec.visual === 'vortex') this.vortexBlades(z);
        }
      }
    }
    for (const [id, e] of this.zoneMeshes) {
      if (alive.has(id)) continue;
      e.mesh.removeFromParent();
      disposeDeep(e.mesh);
      this.zoneMeshes.delete(id);
    }
  }

  private vortexBlades(z: Zone) {
    const r = z.shape.kind === 'ring' ? z.shape.radius - z.shape.width / 2 : 2;
    for (let i = 0; i < 3; i++) {
      const a = z.angle * 1.6 + (i * Math.PI * 2) / 3;
      this.emit(z.x + Math.cos(a) * r, 1, z.z + Math.sin(a) * r, 1, { color: '#e8eef6', speed: 0.1, up: 0, life: 0.15, size: 0.22, gravity: 0, glow: true });
    }
  }

  private syncProjectiles(sim: Sim, lights: LightPool) {
    const alive = new Set<number>();
    for (const p of sim.projectiles) {
      alive.add(p.id);
      let m = this.projMeshes.get(p.id);
      if (!m) {
        m = projectileMesh(p);
        m.layers.set(LAYER.MAIN);
        m.traverse((o) => o.layers.set(LAYER.MAIN));
        this.group.add(m);
        this.projMeshes.set(p.id, m);
      }
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = Math.atan2(p.vx, p.vz);
      if (p.lob) m.rotation.x = 0.4;
      const glowy = p.spec.visual !== 'knife' && p.spec.visual !== 'arrow';
      if (glowy) {
        lights.add({ x: p.x, y: p.y, z: p.z, color: p.color, intensity: 2, range: 4.5, priority: 2 });
        if (Math.random() < 0.7) this.emit(p.x, p.y, p.z, 1, { color: p.color, speed: 0.4, up: 0.3, life: 0.3, size: 0.13, gravity: 0 });
      }
    }
    for (const [id, m] of this.projMeshes) {
      if (alive.has(id)) continue;
      m.removeFromParent();
      disposeDeep(m);
      this.projMeshes.delete(id);
    }
  }

  // ---------------------------------------------------------------- events

  private onEvent(sim: Sim, e: SimEvent, heroId: string) {
    const ch = (id: unknown) => (typeof id === 'string' ? sim.characters.get(id) : undefined);
    switch (e.type) {
      case 'hit': {
        const t = ch(e.target);
        const color = DAMAGE_COLORS[(e.dmgType as DamageType) ?? 'physical'] ?? '#ffffff';
        const y = t ? t.pos.y + 1.1 * Math.min(1.6, t.scale) : 1;
        const big = !!e.crit || !!e.heavy;
        this.emit(e.x as number, y, e.z as number, big ? 14 : 7, { color, speed: big ? 4 : 2.6, up: 2.5, life: 0.35, size: big ? 0.16 : 0.11 });
        if (e.target === heroId) this.shake = Math.max(this.shake, big ? 3 : 1.5);
        else if (big) this.shake = Math.max(this.shake, 1.5);
        if (big) this.flash(e.x as number, y, e.z as number, color, 3, 4, 0.12);
        break;
      }
      case 'strike': {
        const c = ch(e.id);
        if (!c) break;
        const tint = SKILLS[String(e.skill)]?.color;
        this.slashArc(c.pos.x, c.pos.y, c.pos.z, e.yaw as number, e.shape as Shape, tint ?? (c.team === 'hero' ? '#f4f0ff' : '#ffb0a0'));
        break;
      }
      case 'death': {
        const x = e.x as number, z = e.z as number;
        this.emit(x, 0.8, z, e.boss ? 60 : 16, { color: e.boss ? '#ffb84d' : '#c8bca8', speed: e.boss ? 5 : 2.5, up: 3, life: 0.7, size: 0.13, glow: false });
        if (e.boss) {
          this.shake = 8;
          this.flash(x, 1.5, z, '#ffd27a', 8, 12, 1.2);
          this.pillar(x, z, '#ffd27a', 1.6);
        }
        break;
      }
      case 'explosion': {
        const x = e.x as number, z = e.z as number, r = e.radius as number;
        this.emit(x, 0.5, z, 26, { color: e.color as string, speed: r * 2.6, up: 3, life: 0.45, size: 0.18 });
        this.shockwave(x, z, r, e.color as string, 0.3);
        this.flash(x, 1, z, e.color as string, 6, r * 3, 0.3);
        this.shake = Math.max(this.shake, 2.5);
        break;
      }
      case 'zone.resolve': {
        const z = sim.zones.find((q) => q.id === e.id);
        const r = z && (z.shape.kind === 'circle' || z.shape.kind === 'ring' || z.shape.kind === 'cone') ? z.shape.radius : 2;
        const color = z ? zoneColor(z) : '#ffffff';
        if (e.visual === 'telegraph') {
          this.emit(e.x as number, 0.3, e.z as number, 18, { color: '#e8d8c8', speed: 4, up: 2, life: 0.4, size: 0.14, glow: false });
          this.shake = Math.max(this.shake, 2);
          break;
        }
        this.shockwave(e.x as number, e.z as number, r, color, 0.35);
        this.emit(e.x as number, 0.3, e.z as number, Math.round(10 + r * 6), { color, speed: r * 2.2, up: 2.5, life: 0.5, size: 0.15 });
        if (e.visual === 'meteor' || e.visual === 'slam' || e.visual === 'burst') {
          this.shake = Math.max(this.shake, 4);
          this.flash(e.x as number, 1, e.z as number, color, 6, r * 3.5, 0.35);
        }
        break;
      }
      case 'zone': {
        if (e.visual === 'meteor') {
          // Falling rock: a glowing body dropping onto the target over the zone delay.
          const x = e.x as number, z = e.z as number, delay = (e.delay as number) || 0.8;
          const rock = new THREE.Mesh(merge([sphere(0.45, '#ff8a3d', {}, 7, 5), cone(0.3, 1.2, '#ffd070', { at: [0, 0.8, 0] })]), writesNormals(new THREE.MeshBasicMaterial({ vertexColors: true })));
          this.transient(rock, delay, (o, u) => {
            o.position.set(x - 4 * (1 - u), 0.4 + 12 * (1 - u), z - 4 * (1 - u));
            o.rotation.z = -0.4;
          });
        }
        break;
      }
      case 'chain':
        this.lightning(e.pts as Array<[number, number]>, e.visual === 'lightning' ? '#ffe95c' : '#9fdcff');
        break;
      case 'blink':
        this.emit(e.fromX as number, 1, e.fromZ as number, 16, { color: '#a98bff', speed: 2, up: 1, life: 0.5, size: 0.12, gravity: -1 });
        this.emit(e.toX as number, 1, e.toZ as number, 16, { color: '#c8b8ff', speed: 2, up: 1, life: 0.5, size: 0.12, gravity: -1 });
        this.flash(e.toX as number, 1, e.toZ as number, '#a98bff', 3, 4, 0.2);
        break;
      case 'skill': {
        const c = ch(e.id);
        if (!c) break;
        if (e.skill === 'dodge') this.emit(c.pos.x, 0.15, c.pos.z, 8, { color: '#a89a88', speed: 1.5, up: 0.8, life: 0.4, size: 0.12, glow: false });
        else if (e.skill === 'warcry') this.shockwave(c.pos.x, c.pos.z, 4.5, '#ffb84d', 0.3);
        break;
      }
      case 'levelup': {
        const c = sim.characters.get(heroId);
        if (!c) break;
        this.pillar(c.pos.x, c.pos.z, '#ffe14d', 1.4);
        this.emit(c.pos.x, 0.2, c.pos.z, 50, { color: '#ffe14d', speed: 2.5, up: 6, life: 1, size: 0.12, gravity: 4 });
        this.flash(c.pos.x, 2, c.pos.z, '#ffe14d', 6, 9, 1);
        break;
      }
      case 'prop.break':
        this.emit(e.x as number, 0.4, e.z as number, 18, { color: '#9a7a5a', speed: 3, up: 3.5, life: 0.9, size: 0.16, glow: false, gravity: 14 });
        this.shake = Math.max(this.shake, 1);
        break;
      case 'chest.open':
        this.pillar(e.x as number, e.z as number, '#ffd27a', 0.8);
        this.emit(e.x as number, 0.6, e.z as number, 30, { color: '#ffd27a', speed: 2, up: 4, life: 0.8, size: 0.1 });
        break;
      case 'pickup':
        if (e.kind === 'gold') this.emit(e.x as number, 0.3, e.z as number, 6, { color: '#ffd84a', speed: 1, up: 2.5, life: 0.4, size: 0.08 });
        else if (e.kind === 'orb') this.emit(e.x as number, 0.5, e.z as number, 14, { color: e.orb === 'mana' ? '#5a8aff' : '#ff4a5a', speed: 1.5, up: 3, life: 0.5, size: 0.1 });
        break;
      case 'heal':
        this.emit(e.x as number, 0.8, e.z as number, 10, { color: '#7aff8a', speed: 0.6, up: 2.5, life: 0.7, size: 0.1, gravity: -1 });
        break;
      case 'status': {
        const t = ch(e.target);
        if (!t) break;
        if (e.status === 'freeze') this.emit(t.pos.x, 1, t.pos.z, 10, { color: '#cdf3ff', speed: 1.5, up: 2, life: 0.5, size: 0.12 });
        break;
      }
      case 'vortex': {
        const c = ch(e.id);
        if (c) this.shockwave(c.pos.x, c.pos.z, 6, '#9a8cff', 0.5, true);
        break;
      }
      case 'exit.open':
        this.pillar(e.x as number, e.z as number, '#7ab8ff', 1.5);
        break;
      case 'keg.lit':
        this.emit(e.x as number, 1.05, e.z as number, 6, { color: '#ffd070', speed: 1, up: 2, life: 0.3, size: 0.07 });
        break;
      case 'spikes.up':
        this.emit(e.x as number, 0.1, e.z as number, 4, { color: '#a89a88', speed: 1, up: 1.5, life: 0.3, size: 0.08, glow: false });
        break;
      case 'shrine':
        this.pillar(e.x as number, e.z as number, SHRINE_COLORS[e.buff as string] ?? '#ffffff', 1.2);
        this.emit(e.x as number, 1.2, e.z as number, 30, { color: SHRINE_COLORS[e.buff as string] ?? '#ffffff', speed: 2.5, up: 3, life: 0.8, size: 0.1 });
        break;
      case 'launch':
        this.emit(e.x as number, 0.2, e.z as number, 18, { color: '#7affd8', speed: 2.5, up: 3, life: 0.5, size: 0.1 });
        this.shockwave(e.x as number, e.z as number, 2, '#7affd8', 0.3);
        break;
      case 'beacon.lit':
        this.emit(e.x as number, 1.5, e.z as number, 30, { color: '#ffd070', speed: 2.5, up: 3, life: 0.7, size: 0.1 });
        this.flash(e.x as number, 1.6, e.z as number, '#ffd070', 6, 12, 0.6);
        break;
      case 'boulder':
        this.emit(e.x as number, 0.3, e.z as number, 10, { color: '#8a8070', speed: 2, up: 2, life: 0.6, size: 0.12, glow: false });
        this.shake = Math.max(this.shake, 1);
        break;
      case 'imp.escape':
        this.emit(e.x as number, 0.6, e.z as number, 24, { color: '#ffd84a', speed: 2, up: 2, life: 0.6, size: 0.1 });
        break;
      case 'mechanic.kill':
        this.emit(e.x as number, 1, e.z as number, 8, { color: '#ffe14d', speed: 1.5, up: 3, life: 0.5, size: 0.08 });
        break;
      case 'summon': {
        const c = ch(e.id);
        if (c) this.emit(c.pos.x, 0.3, c.pos.z, 12, { color: '#b388ff', speed: 1.5, up: 2, life: 0.6, size: 0.12 });
        break;
      }
    }
  }

  /**
   * Strike trail: a thin crescent at weapon height for swings (bright where the swing ends,
   * feathered on the inside), a tapered streak along the ground for line strikes, and a thin
   * ground ring for area strikes. Per-vertex alpha, tinted by the skill.
   */
  private slashArc(x: number, y: number, z: number, yaw: number, shape: Shape, color: string) {
    const col = new THREE.Color(color);
    const pos: number[] = [], rgba: number[] = [], idx: number[] = [];
    const vert = (px: number, pz: number, a: number) => {
      pos.push(px, 0, pz);
      rgba.push(col.r, col.g, col.b, a);
      return pos.length / 3 - 1;
    };
    let height = 0.9, peak = 0.8;
    if (shape.kind === 'cone') {
      const half = (shape.arc / 2) * (Math.PI / 180);
      const r1 = shape.radius * 0.95, r0 = shape.radius * 0.72, n = 16;
      for (let i = 0; i <= n; i++) {
        const t = i / n, th = -half + t * half * 2;
        const a = Math.pow(t, 1.4);
        vert(Math.sin(th) * r0, Math.cos(th) * r0, a * 0.15);
        vert(Math.sin(th) * r1, Math.cos(th) * r1, a);
        if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
      }
    } else if (shape.kind === 'circle' || shape.kind === 'ring') {
      const r1 = shape.radius * 0.95, r0 = shape.radius * 0.82, n = 32;
      for (let i = 0; i <= n; i++) {
        const th = (i / n) * Math.PI * 2;
        vert(Math.sin(th) * r0, Math.cos(th) * r0, 0.1);
        vert(Math.sin(th) * r1, Math.cos(th) * r1, 1);
        if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
      }
      height = 0.07;
      peak = 0.55;
    } else {
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const t = i / n, w = (shape.width / 2) * (1 - 0.7 * t);
        const a = 1 - t;
        vert(-w, t * shape.length, a * 0.25);
        vert(0, t * shape.length, a);
        vert(w, t * shape.length, a * 0.25);
        if (i) {
          const b = 3 * (i - 1), c = 3 * i;
          idx.push(b, b + 1, c, b + 1, c + 1, c, b + 1, b + 2, c + 1, b + 2, c + 2, c + 1);
        }
      }
      height = 0.07;
      peak = 0.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
    g.setIndex(idx);
    const mat = writesNormals(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: peak, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }), 'fx');
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y + height, z);
    mesh.rotation.y = yaw;
    mesh.renderOrder = 8;
    mesh.layers.set(LAYER.FX);
    this.group.add(mesh);
    this.transients.push({
      mesh, t: 0, max: 0.16, update: (o, u) => {
        (((o as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = peak * (1 - u * u);
        o.scale.setScalar(0.9 + u * 0.18);
      },
    });
  }

  shockwave(x: number, z: number, r: number, color: string, time: number, inward = false) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), fxMaterial(color, 0.7));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.06, z);
    mesh.renderOrder = 7;
    mesh.layers.set(LAYER.FX);
    this.group.add(mesh);
    this.transients.push({
      mesh, t: 0, max: time, update: (o, u) => {
        const k = inward ? r * (1 - u) + 0.2 : r * (0.2 + 0.8 * u);
        o.scale.set(k, k, 1);
        (((o as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - u);
      },
    });
  }

  pillar(x: number, z: number, color: string, time: number) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 6, 10, 1, true), fxMaterial(color, 0.4));
    mesh.position.set(x, 3, z);
    mesh.renderOrder = 7;
    mesh.layers.set(LAYER.FX);
    this.group.add(mesh);
    this.transients.push({
      mesh, t: 0, max: time, update: (o, u) => {
        o.scale.set(1 - u * 0.7, 1, 1 - u * 0.7);
        (((o as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - u);
      },
    });
  }

  private lightning(pts: Array<[number, number]>, color: string) {
    const verts: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const seg = 6;
      let px = ax, py = 1.1, pz = az;
      for (let k = 1; k <= seg; k++) {
        const u = k / seg;
        const jitter = k < seg ? 0.35 : 0;
        const nx = ax + (bx - ax) * u + (Math.random() - 0.5) * jitter, nz = az + (bz - az) * u + (Math.random() - 0.5) * jitter;
        const ny = 1.1 + (k < seg ? (Math.random() - 0.5) * 0.4 : 0);
        // Thin ribbon quad (two triangles) facing up-ish so it reads at the iso angle.
        const w = 0.06;
        verts.push(px - w, py, pz, nx - w, ny, nz, nx + w, ny + w, nz, px - w, py, pz, nx + w, ny + w, nz, px + w, py + w, pz);
        px = nx;
        py = ny;
        pz = nz;
      }
      this.emit(bx, 1.1, bz, 8, { color, speed: 2, up: 1, life: 0.25, size: 0.1 });
      this.flash(bx, 1.2, bz, color, 3, 4, 0.18);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mesh = new THREE.Mesh(g, writesNormals(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
    mesh.layers.set(LAYER.MAIN);
    this.group.add(mesh);
    this.transients.push({ mesh, t: 0, max: 0.18, update: (o, u) => (o.visible = u < 0.4 || u > 0.6) });
  }

  get particleCount() {
    return this.particles.length;
  }
}

function zoneColor(z: Zone): string {
  switch (z.spec.visual) {
    case 'meteor': case 'molten': case 'burst': return '#ff6a2a';
    case 'frostnova': return '#8fd8ff';
    case 'venom': case 'puddle': return '#8fe36a';
    case 'hex': return '#c77dff';
    case 'vortex': return '#d8dce6';
    case 'warcry': return '#ffb84d';
    default: return z.color;
  }
}

function projectileMesh(p: Projectile): THREE.Object3D {
  const mat = writesNormals(new THREE.MeshBasicMaterial({ vertexColors: true }));
  let g: THREE.BufferGeometry;
  switch (p.spec.visual) {
    case 'knife':
      g = merge([box(0.05, 0.03, 0.4, '#e8eef6'), box(0.07, 0.05, 0.1, '#5a3a24', { at: [0, 0, -0.22] })]);
      break;
    case 'arrow':
      g = merge([box(0.03, 0.03, 0.6, '#8a6a4a'), cone(0.05, 0.12, '#c8ccd4', { at: [0, 0, 0.34], rot: [Math.PI / 2, 0, 0] })]);
      break;
    case 'icespear':
      g = merge([cone(0.12, 0.8, '#cdf3ff', { rot: [Math.PI / 2, 0, 0] }), cone(0.08, 0.4, '#ffffff', { at: [0, 0, -0.2], rot: [-Math.PI / 2, 0, 0] })]);
      break;
    case 'spit':
      g = merge([sphere(0.22, p.color, {}, 6, 5), sphere(0.12, '#ffffff', { at: [0.06, 0.06, 0.06] }, 4, 3)]);
      break;
    default:
      g = merge([octa(p.spec.radius * 1.1, p.color), sphere(p.spec.radius * 0.6, '#ffffff', {}, 5, 4)]);
  }
  const m = new THREE.Mesh(g, mat);
  m.name = `proj:${p.id}`;
  return m;
}

function disposeDeep(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}
