/**
 * Genome -> rigged, skinned creature mesh. Bones are created at rest with identity rotations, so
 * every animation rotation is about world-aligned axes (X right, Y up, Z forward). Body, neck,
 * tail and limbs are tubes skinned along their bone chains (joints blend 50/50 between the two
 * bones they connect); heads, eyes, horns, spikes, plates and feet are rigid to one bone. One
 * SkinnedMesh, two materials (toon body with vertex colors + unlit glowing eyes).
 */
import * as THREE from 'three';
import type { CreatureGenome } from '../../content/procgen/creature';
import { hash2 } from '../textures';

export interface Palette3 {
  primary: string;
  secondary: string;
  accent: string;
  glow: string;
}

export interface LegRig {
  side: 1 | -1;
  pair: number;
  upper: THREE.Bone;
  lower: THREE.Bone;
  mid: THREE.Bone | null;
  foot: THREE.Bone;
  /** Gait phase offset in radians. */
  phase: number;
  front: boolean;
}

export interface CreatureRig {
  genome: CreatureGenome;
  root: THREE.Bone;
  bones: THREE.Bone[];
  spine: THREE.Bone[];
  neck: THREE.Bone[];
  head: THREE.Bone;
  jaw: THREE.Bone | null;
  tail: THREE.Bone[];
  legs: LegRig[];
  arms: Array<{ side: 1 | -1; upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone }>;
  wings: Array<{ side: 1 | -1; bone: THREE.Bone }>;
  tentacles: THREE.Bone[][];
  mesh: THREE.SkinnedMesh;
  /** Body center height at rest (camera framing, health bars). */
  height: number;
  info: { bones: number; vertices: number; triangles: number; parts: string[] };
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  body: number[] = [];
  glow: number[] = [];
  parts: string[] = [];

  /** Appends a (transformed) primitive bound to bone weights. */
  add(g: THREE.BufferGeometry, color: THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color), weights: (p: THREE.Vector3) => Array<[number, number]>, glow = false, name = '') {
    const ng = g.index ? g : g;
    if (!ng.attributes.normal) ng.computeVertexNormals();
    const base = this.pos.length / 3;
    const P = ng.attributes.position, N = ng.attributes.normal;
    const p = V(), n = V();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      const c = typeof color === 'function' ? color(p, n) : color;
      this.col.push(c.r, c.g, c.b);
      const w = weights(p).slice(0, 4);
      let sum = 0;
      for (const [, x] of w) sum += x;
      for (let k = 0; k < 4; k++) {
        this.si.push(w[k]?.[0] ?? 0);
        this.sw.push(w[k] ? w[k][1] / (sum || 1) : 0);
      }
    }
    const target = glow ? this.glow : this.body;
    if (ng.index) for (let i = 0; i < ng.index.count; i++) target.push(base + ng.index.getX(i));
    else for (let i = 0; i < P.count; i++) target.push(base + i);
    if (name) this.parts.push(name);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex([...this.body, ...this.glow]);
    g.addGroup(0, this.body.length, 0);
    g.addGroup(this.body.length, this.glow.length, 1);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Tube along a polyline. `bones[j]` owns segment j (points j -> j+1). Rings at joints blend the
 * two bones; mid-segment rings follow one bone.
 */
function tube(b: Builder, pts: THREE.Vector3[], radii: number[], bones: number[], color: (u: number, p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, opts: { sides?: number; squash?: number; cap?: boolean; name?: string } = {}) {
  const sides = opts.sides ?? 7;
  const squash = opts.squash ?? 1;
  const ringsPerSeg = 2;
  const rings: Array<{ c: THREE.Vector3; r: number; dir: THREE.Vector3; w: Array<[number, number]>; u: number }> = [];
  const total = pts.length - 1;
  for (let j = 0; j < total; j++) {
    for (let k = 0; k < ringsPerSeg; k++) {
      const t = k / ringsPerSeg;
      const c = pts[j].clone().lerp(pts[j + 1], t);
      const r = radii[j] + (radii[j + 1] - radii[j]) * t;
      const dir = pts[j + 1].clone().sub(pts[j]).normalize();
      let w: Array<[number, number]>;
      if (k === 0 && j > 0) w = [[bones[j - 1], 0.5], [bones[j], 0.5]];
      else w = [[bones[j], 1]];
      rings.push({ c, r, dir, w, u: (j + t) / total });
    }
  }
  rings.push({ c: pts[total].clone(), r: radii[total], dir: pts[total].clone().sub(pts[total - 1]).normalize(), w: [[bones[total - 1], 1]], u: 1 });
  const positions: number[] = [];
  const weights: Array<Array<[number, number]>> = [];
  const us: number[] = [];
  for (const ring of rings) {
    // Frame: dir plus a side vector that stays horizontal when possible.
    const up = Math.abs(ring.dir.y) > 0.9 ? V(0, 0, 1) : V(0, 1, 0);
    const side = V().crossVectors(up, ring.dir).normalize();
    const vup = V().crossVectors(ring.dir, side).normalize();
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const p = ring.c.clone().addScaledVector(side, Math.cos(a) * ring.r).addScaledVector(vup, Math.sin(a) * ring.r * squash);
      positions.push(p.x, p.y, p.z);
      weights.push(ring.w);
      us.push(ring.u);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < rings.length; i++)
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s, bb = i * sides + ((s + 1) % sides), c = (i + 1) * sides + s, d = (i + 1) * sides + ((s + 1) % sides);
      idx.push(a, c, bb, bb, c, d);
    }
  if (opts.cap !== false) {
    // End caps: fan around the end centers.
    const startC = positions.length / 3;
    positions.push(rings[0].c.x, rings[0].c.y, rings[0].c.z);
    weights.push(rings[0].w);
    us.push(0);
    const endC = positions.length / 3;
    const last = rings[rings.length - 1];
    const tip = last.c.clone().addScaledVector(last.dir, last.r * 0.6);
    positions.push(tip.x, tip.y, tip.z);
    weights.push(last.w);
    us.push(1);
    const lastRing = (rings.length - 1) * sides;
    for (let s = 0; s < sides; s++) {
      idx.push(startC, s, (s + 1) % sides);
      idx.push(endC, lastRing + ((s + 1) % sides), lastRing + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  let vi = 0;
  const tmpN = V();
  b.add(g, (p, n) => {
    tmpN.copy(n);
    return color(us[vi], p, tmpN);
  }, () => weights[vi++], false, opts.name ?? '');
}

const T = (g: THREE.BufferGeometry, at: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3) => {
  const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), scale ?? V(1, 1, 1));
  g.applyMatrix4(m);
  return g;
};

export function buildCreature(g: CreatureGenome, pal: Palette3): CreatureRig {
  const b = new Builder();
  const bones: THREE.Bone[] = [];
  const bone = (name: string, parent: THREE.Bone | null, worldPos: THREE.Vector3) => {
    const bn = new THREE.Bone();
    bn.name = name;
    bn.userData.rest = worldPos.clone();
    if (parent) {
      bn.position.copy(worldPos).sub(parent.userData.rest as THREE.Vector3);
      parent.add(bn);
    } else bn.position.copy(worldPos);
    bones.push(bn);
    return bn;
  };
  const idx = (bn: THREE.Bone) => bones.indexOf(bn);
  const primary = new THREE.Color(pal.primary), secondary = new THREE.Color(pal.secondary), accent = new THREE.Color(pal.accent).lerp(new THREE.Color('#e8e0d0'), 0.35);
  const glowC = new THREE.Color(pal.glow);
  const claw = new THREE.Color('#e8e0c8').lerp(accent, 0.3);

  const root = bone('root', null, V(0, 0, 0));
  // ---- spine (back -> front)
  const H = g.height + g.float;
  const n = Math.max(1, g.spine);
  const dir = V(0, Math.sin(g.pitch), Math.cos(g.pitch));
  const start = V(0, H, 0).addScaledVector(dir, -g.length / 2);
  if (g.pitch > 0.5) start.y = H;
  const spinePts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = start.clone().addScaledVector(dir, g.length * u);
    p.y += Math.sin(Math.PI * u) * g.hump;
    spinePts.push(p);
  }
  const spine: THREE.Bone[] = [];
  for (let i = 0; i < n; i++) spine.push(bone(`spine${i}`, i ? spine[i - 1] : root, spinePts[i]));
  const front = bone('chest', spine[n - 1], spinePts[n]);
  const girthAt = (u: number) => g.girth * (1 + (g.taper - 1) * u) * (0.8 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.1)));
  const bodyRadii = spinePts.map((_, i) => girthAt(i / n));
  const pattern = (u: number, p: THREE.Vector3, nrm: THREE.Vector3) => {
    let c = primary.clone();
    const below = nrm.y < -0.25;
    if (g.pattern === 'belly' && below) c = secondary.clone();
    else if (g.pattern === 'stripes' && Math.floor(u * 9) % 2 === 1 && nrm.y > -0.2) c.lerp(secondary, 0.65);
    else if (g.pattern === 'spots' && hash2(Math.round(p.x * 13), Math.round(p.z * 13 + p.y * 7), g.seed) > 0.86) c.lerp(accent, 0.7);
    if (below && g.pattern !== 'belly') c.lerp(secondary, 0.35);
    return c;
  };
  if (g.plan === 'blob') {
    const s = new THREE.SphereGeometry(g.girth, 12, 9);
    T(s, V(0, g.girth * g.squash, 0), undefined, V(1, g.squash, 1));
    b.add(s, (p, nrm) => pattern(0.5, p, nrm), () => [[idx(spine[0]), 1]], false, 'body');
  } else if (g.plan === 'floater') {
    const s = new THREE.SphereGeometry(g.girth, 12, 9);
    T(s, V(0, H, 0));
    b.add(s, (p, nrm) => pattern(0.5, p, nrm), () => [[idx(spine[0]), 1]], false, 'body');
  } else {
    tube(b, [...spinePts, spinePts[n].clone().addScaledVector(dir, g.girth * 0.3)], [...bodyRadii, bodyRadii[n] * 0.7], [...spine.map(idx), idx(front)], pattern, { sides: 9, squash: g.squash, name: 'body' });
  }
  // Dorsal spikes / shell plates.
  for (let k = 0; k < g.spikes.count; k++) {
    const u = (k + 0.5) / g.spikes.count;
    const si = Math.min(n - 1, Math.floor(u * n));
    const p = spinePts[0].clone().lerp(spinePts[n], u);
    const r = girthAt(u) * g.squash;
    const cg = new THREE.ConeGeometry(g.spikes.size * 0.35, g.spikes.size * (0.8 + hash2(k, 3, g.seed) * 0.6), 4);
    T(cg, p.clone().add(V(0, r * 0.95 + g.spikes.size * 0.3, 0)), new THREE.Euler(-0.35, 0, 0));
    b.add(cg, accent, () => [[idx(spine[si]), 1]], false, 'spike');
  }
  if (g.plates) {
    for (let k = 0; k < n * 2; k++) {
      const u = (k + 0.5) / (n * 2);
      const si = Math.min(n - 1, Math.floor(u * n));
      const p = spinePts[0].clone().lerp(spinePts[n], u);
      const r = girthAt(u);
      const pg = new THREE.SphereGeometry(r * 1.08, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.45);
      T(pg, p.clone().add(V(0, r * g.squash * 0.25, 0)), undefined, V(1, 0.75, 0.55));
      b.add(pg, k % 2 ? secondary.clone().lerp(accent, 0.3) : secondary, () => [[idx(spine[si]), 1]], false, 'plate');
    }
  }

  // ---- neck & head
  const neckDir = V(0, g.neck.up, 1).normalize();
  if (g.pitch > 0.5) neckDir.set(0, 0.35, 1).normalize();
  const neckPts = [spinePts[n].clone()];
  const neck: THREE.Bone[] = [];
  const neckSegs = Math.max(1, g.neck.segments);
  for (let i = 0; i < neckSegs; i++) {
    const p = neckPts[i].clone().addScaledVector(neckDir, g.neck.length / neckSegs);
    neckPts.push(p);
    neck.push(bone(`neck${i}`, i ? neck[i - 1] : front, neckPts[i]));
  }
  const headPos = neckPts[neckPts.length - 1].clone();
  if (g.plan === 'floater' || g.plan === 'blob') headPos.copy(g.plan === 'blob' ? V(0, g.girth * g.squash * 1.1, g.girth * 0.55) : V(0, H, g.girth * 0.5));
  const head = bone('head', neck[neck.length - 1], headPos);
  if (g.neck.length > 0.05 && g.plan !== 'floater' && g.plan !== 'blob') {
    tube(b, neckPts, neckPts.map((_, i) => girthAt(1) * (0.62 - i * 0.08 / neckSegs)), [...neck.map(idx)], (_u, p, nrm) => pattern(1, p, nrm), { sides: 7, squash: 0.95, name: 'neck' });
  }
  const hs = g.head.size;
  const fwd = (d: number) => headPos.clone().add(V(0, 0, d));
  let jaw: THREE.Bone | null = null;
  const headBind = (): Array<[number, number]> => [[idx(head), 1]];
  switch (g.head.shape) {
    case 'snout': case 'maw': case 'skull': case 'beak': case 'mandible': {
      const wide = g.head.shape === 'maw' ? 1.35 : 1;
      const skull = new THREE.SphereGeometry(hs, 10, 7);
      T(skull, fwd(hs * 0.4), undefined, V(wide, 0.85, g.head.shape === 'snout' ? 1.25 : 1));
      b.add(skull, (p, nrm) => pattern(1, p, nrm), headBind, false, 'head');
      if (g.head.shape === 'snout') {
        const sn = new THREE.CylinderGeometry(hs * 0.45, hs * 0.6, g.head.length, 7);
        T(sn, fwd(hs * 0.9 + g.head.length * 0.35).add(V(0, -hs * 0.15, 0)), new THREE.Euler(Math.PI / 2, 0, 0));
        b.add(sn, primary, headBind, false, 'snout');
        const nose = new THREE.SphereGeometry(hs * 0.18, 5, 4);
        T(nose, fwd(hs * 0.9 + g.head.length * 0.85).add(V(0, -hs * 0.05, 0)));
        b.add(nose, new THREE.Color('#1a1414'), headBind, false, 'nose');
      }
      if (g.head.shape === 'beak') {
        const bk = new THREE.ConeGeometry(hs * 0.45, g.head.length * 1.2, 6);
        T(bk, fwd(hs + g.head.length * 0.5), new THREE.Euler(Math.PI / 2, 0, 0));
        b.add(bk, accent, headBind, false, 'beak');
      }
      if (g.head.shape === 'skull') {
        const brow = new THREE.BoxGeometry(hs * 1.7, hs * 0.25, hs * 0.5);
        T(brow, fwd(hs * 0.7).add(V(0, hs * 0.45, 0)));
        b.add(brow, primary.clone().multiplyScalar(0.85), headBind, false, 'brow');
      }
      if (g.head.jaw) {
        jaw = bone('jaw', head, headPos.clone().add(V(0, -hs * 0.35, hs * 0.1)));
        const jb = (): Array<[number, number]> => [[idx(jaw!), 1]];
        if (g.head.shape === 'mandible') {
          for (const s of [-1, 1]) {
            const m = new THREE.ConeGeometry(hs * 0.18, hs * 1.4, 4);
            T(m, fwd(hs * 1.3).add(V(s * hs * 0.45, -hs * 0.35, 0)), new THREE.Euler(Math.PI / 2, 0, -s * 0.5));
            b.add(m, claw, jb, false, 'mandible');
          }
        } else {
          const jg = new THREE.BoxGeometry(hs * 1.2 * wide, hs * 0.3, hs * (g.head.shape === 'snout' ? 1.3 + g.head.length * 2 : 1.4));
          T(jg, fwd(hs * (g.head.shape === 'snout' ? 0.9 : 0.6)).add(V(0, -hs * 0.45, 0)));
          b.add(jg, secondary, jb, false, 'jaw');
          // Teeth.
          for (let t = 0; t < 4; t++) {
            const tg = new THREE.ConeGeometry(hs * 0.07, hs * 0.25, 3);
            T(tg, fwd(hs * (0.6 + t * 0.22)).add(V((t % 2 ? 1 : -1) * hs * 0.35 * wide, -hs * 0.22, 0)));
            b.add(tg, claw, jb, false, 'tooth');
          }
        }
      }
      break;
    }
    case 'eye': {
      const ball = new THREE.SphereGeometry(Math.max(hs, g.girth * 0.7), 12, 9);
      T(ball, g.plan === 'floater' ? V(0, H, 0) : fwd(hs * 0.5), undefined, V(1, 0.95, 1));
      b.add(ball, (p, nrm) => pattern(1, p, nrm), headBind, false, 'head');
      if (g.head.jaw) {
        jaw = bone('jaw', head, headPos.clone().add(V(0, -hs * 0.4, 0)));
        const jg = new THREE.SphereGeometry(hs * 0.7, 8, 4, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
        T(jg, headPos.clone().add(V(0, -hs * 0.1, hs * 0.35)));
        b.add(jg, secondary, () => [[idx(jaw!), 1]], false, 'jaw');
      }
      break;
    }
  }
  // Eyes (glowing).
  const eyeCount = g.head.eyes;
  const big = g.head.shape === 'eye' && eyeCount === 1;
  for (let e = 0; e < eyeCount; e++) {
    const row = Math.floor(e / 2), side = eyeCount === 1 ? 0 : e % 2 ? 1 : -1;
    const er = big ? g.head.eyeSize * 1.4 : g.head.eyeSize;
    const baseR = g.head.shape === 'eye' ? Math.max(hs, g.girth * 0.7) : hs;
    const ep = (g.plan === 'floater' ? V(0, H, 0) : headPos.clone()).add(V(side * baseR * 0.42, baseR * (0.25 - row * 0.22), baseR * (g.head.shape === 'eye' ? 0.92 : 0.85) + (g.head.shape === 'snout' ? hs * 0.1 : 0)));
    const eg = new THREE.SphereGeometry(er, 6, 5);
    T(eg, ep);
    b.add(eg, glowC, headBind, true, 'eye');
    if (big) {
      const pupil = new THREE.SphereGeometry(er * 0.45, 5, 4);
      T(pupil, ep.clone().add(V(0, 0, er * 0.75)));
      b.add(pupil, new THREE.Color('#0b0a10'), headBind, false, 'pupil');
    }
  }
  // Horns.
  for (let h = 0; h < g.horns.count; h++) {
    const side = g.horns.count === 1 ? 0 : h % 2 ? 1 : -1;
    const row = Math.floor(h / 2);
    const hl = g.horns.length * (1 - row * 0.3);
    const base = headPos.clone().add(V(side * hs * 0.55, hs * 0.65, hs * (0.2 - row * 0.4)));
    const c1 = new THREE.ConeGeometry(hs * 0.16, hl * 0.6, 5);
    T(c1, base.clone().add(V(side * hl * 0.12, hl * 0.25, -hl * 0.05)), new THREE.Euler(-0.3, 0, -side * 0.45));
    b.add(c1, accent, headBind, false, 'horn');
    const c2 = new THREE.ConeGeometry(hs * 0.1, hl * 0.5, 5);
    T(c2, base.clone().add(V(side * hl * 0.32, hl * 0.55, -hl * (0.15 + g.horns.curve * 0.25))), new THREE.Euler(-0.3 - g.horns.curve * 0.9, 0, -side * 0.2));
    b.add(c2, accent, headBind, false, 'horn');
  }

  // ---- tail
  const tail: THREE.Bone[] = [];
  if (g.tail.segments > 0 && g.tail.length > 0) {
    const tdir = V(0, g.tail.up - (g.pitch > 0.5 ? 0.6 : 0), -1).normalize();
    const pts = [spinePts[0].clone()];
    const seg = g.tail.length / g.tail.segments;
    // Stinger tails curl up and over the back (scorpions); others run straight back.
    const curl = g.tail.tip === 'stinger';
    for (let i = 0; i < g.tail.segments; i++) {
      let dir = tdir;
      if (curl) {
        const th = 0.35 + (Math.min(2.5, 1.3 + g.tail.up) - 0.35) * (i / Math.max(1, g.tail.segments - 1));
        dir = V(0, Math.sin(th), -Math.cos(th));
      }
      const p = pts[i].clone().addScaledVector(dir, curl ? seg * 1.15 : seg);
      pts.push(p);
      tail.push(bone(`tail${i}`, i ? tail[i - 1] : spine[0], pts[i]));
    }
    const tr = pts.map((_, i) => girthAt(0) * (0.6 - (0.6 - g.tail.taper * 0.6) * (i / g.tail.segments)) + 0.02);
    tube(b, pts, tr, tail.map(idx), (u, p, nrm) => pattern(-u, p, nrm), { sides: 6, name: 'tail' });
    const tipBone = idx(tail[tail.length - 1]);
    const tipP = pts[pts.length - 1];
    if (g.tail.tip === 'club') {
      const cg = new THREE.IcosahedronGeometry(girthAt(0) * 0.55, 0);
      T(cg, tipP);
      b.add(cg, accent, () => [[tipBone, 1]], false, 'club');
    } else if (g.tail.tip === 'stinger') {
      const sg = new THREE.ConeGeometry(0.06, 0.3, 5);
      // Point the stinger along the end of the curl (forward and down over the back).
      const last = tipP.clone().sub(pts[pts.length - 2]).normalize();
      const aim = last.clone().add(V(0, -0.8, 0.6)).normalize();
      T(sg, tipP.clone().addScaledVector(aim, 0.1), new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), aim)));
      b.add(sg, claw, () => [[tipBone, 1]], false, 'stinger');
    } else if (g.tail.tip === 'spikes') {
      for (const s of [-1, 1]) {
        const sg = new THREE.ConeGeometry(0.04, 0.22, 4);
        T(sg, tipP.clone().add(V(s * 0.08, 0.04, 0)), new THREE.Euler(0, 0, -s * 1.2));
        b.add(sg, accent, () => [[tipBone, 1]], false, 'tailspike');
      }
    } else if (g.tail.tip === 'fin') {
      const fg = new THREE.BoxGeometry(0.02, 0.3, 0.35);
      T(fg, tipP.clone().add(V(0, 0.05, -0.1)));
      b.add(fg, accent, () => [[tipBone, 1]], false, 'fin');
    }
  }
  if (g.plan === 'serpent' || g.plan === 'centipede') {
    // Long bodies taper to a point at the back.
    const tipG = new THREE.ConeGeometry(girthAt(0) * 0.8, g.girth * 1.6, 7);
    T(tipG, spinePts[0].clone().add(V(0, 0, -g.girth * 0.75)), new THREE.Euler(-Math.PI / 2, 0, 0), V(1, 1, g.squash));
    b.add(tipG, primary, () => [[idx(spine[0]), 1]], false, 'tailtip');
  }

  // ---- legs
  const legs: LegRig[] = [];
  const pairs = g.legs.pairs;
  const gaitPhase = (pair: number, side: 1 | -1) => {
    switch (g.plan) {
      case 'quadruped': return (pair === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0);
      case 'hexapod': return ((pair % 2 === 0) === side > 0 ? 0 : Math.PI);
      case 'arachnid': return ((pair % 2 === 0) === side > 0 ? 0 : Math.PI);
      case 'centipede': return pair * 0.8 + (side > 0 ? Math.PI : 0);
      default: return side > 0 ? Math.PI : 0;
    }
  };
  for (let k = 0; k < pairs; k++) {
    const u = pairs === 1 ? 0 : k / (pairs - 1);
    const attach = spinePts[0].clone().lerp(spinePts[n], g.plan === 'arachnid' ? 0.7 + u * 0.25 : g.plan === 'hexapod' ? 0.15 + u * 0.7 : u);
    const si = Math.min(n - 1, Math.floor((g.plan === 'arachnid' ? 0.75 : u) * n));
    const parent = pairs === 1 && g.pitch > 0.5 ? spine[0] : spine[si];
    for (const side of [-1, 1] as const) {
      const fan = g.plan === 'arachnid' ? (-0.9 + u * 1.8) : g.plan === 'hexapod' ? (-0.6 + u * 1.2) : 0;
      const lat = V(side * Math.cos(fan), 0, Math.sin(fan));
      const hip = attach.clone().add(V(side * g.legs.splay * 0.9, -girthAt(u) * g.squash * 0.4, 0));
      const L = g.legs.length;
      let knee: THREE.Vector3, mid: THREE.Vector3 | null = null, foot: THREE.Vector3;
      if (g.legs.joints === 3) {
        knee = hip.clone().addScaledVector(lat, L * 0.38).add(V(0, L * 0.32, 0));
        mid = hip.clone().addScaledVector(lat, L * 0.72).add(V(0, L * 0.12, 0));
        foot = hip.clone().addScaledVector(lat, L * 0.92);
        foot.y = 0.02;
      } else {
        const back = u < 0.5 && pairs > 1 ? -1 : 1;
        knee = hip.clone().addScaledVector(lat, L * 0.08).add(V(0, -(hip.y) * 0.48, back * L * 0.12));
        foot = hip.clone().addScaledVector(lat, L * 0.12).add(V(0, 0, back * -0.02));
        foot.y = 0.04;
      }
      const upper = bone(`leg${k}${side > 0 ? 'R' : 'L'}_upper`, parent, hip);
      const lower = bone(`leg${k}${side > 0 ? 'R' : 'L'}_lower`, upper, knee);
      const midB = mid ? bone(`leg${k}${side > 0 ? 'R' : 'L'}_mid`, lower, mid) : null;
      const footB = bone(`leg${k}${side > 0 ? 'R' : 'L'}_foot`, midB ?? lower, foot);
      const chain = mid ? [hip, knee, mid, foot] : [hip, knee, foot];
      const chainBones = mid ? [upper, lower, midB!] : [upper, lower];
      const th = g.legs.thickness;
      tube(b, chain, chain.map((_, i) => th * (1 - i * 0.18)), chainBones.map(idx), (_u, p, nrm) => pattern(u, p, nrm).multiplyScalar(0.92), { sides: 5, name: 'leg' });
      // Feet.
      const fb = (): Array<[number, number]> => [[idx(footB), 1]];
      if (g.legs.foot === 'paw' || g.legs.foot === 'hoof') {
        const fg = new THREE.SphereGeometry(th * 1.05, 6, 4);
        T(fg, foot.clone().add(V(0, 0, th * 0.5)), undefined, V(1, 0.5, 1.3));
        b.add(fg, g.legs.foot === 'hoof' ? new THREE.Color('#2a2220') : primary.clone().multiplyScalar(0.8), fb, false, 'foot');
      } else if (g.legs.foot === 'claw') {
        for (let c = -1; c <= 1; c++) {
          const cg = new THREE.ConeGeometry(th * 0.35, th * 2.2, 3);
          T(cg, foot.clone().add(V(c * th * 0.6, 0.02, th * 1.1)), new THREE.Euler(Math.PI / 2, 0, 0));
          b.add(cg, claw, fb, false, 'claw');
        }
      }
      legs.push({ side, pair: k, upper, lower, mid: midB, foot: footB, phase: gaitPhase(k, side), front: u > 0.5 || pairs === 1 });
    }
  }

  // ---- arms
  const arms: CreatureRig['arms'] = [];
  if (g.arms) {
    const shoulder = spinePts[n].clone();
    for (const side of [-1, 1] as const) {
      const S = shoulder.clone().add(V(side * girthAt(1) * 1.05, -girthAt(1) * 0.1, 0));
      let E: THREE.Vector3, Hd: THREE.Vector3;
      if (g.arms.pincer) {
        E = S.clone().add(V(side * 0.12, -0.05, g.arms.length * 0.5));
        Hd = E.clone().add(V(-side * 0.05, 0, g.arms.length * 0.45));
      } else {
        E = S.clone().add(V(side * 0.08, -g.arms.length * 0.5, g.arms.length * 0.12));
        Hd = E.clone().add(V(0, -g.arms.length * 0.4, g.arms.length * 0.22));
      }
      const up = bone(`arm${side > 0 ? 'R' : 'L'}_upper`, front, S);
      const lo = bone(`arm${side > 0 ? 'R' : 'L'}_lower`, up, E);
      const hand = bone(`arm${side > 0 ? 'R' : 'L'}_hand`, lo, Hd);
      tube(b, [S, E, Hd], [g.arms.thickness, g.arms.thickness * 0.85, g.arms.thickness * 0.75], [idx(up), idx(lo)], (_u, p, nrm) => pattern(1, p, nrm), { sides: 6, name: 'arm' });
      const hb = (): Array<[number, number]> => [[idx(hand), 1]];
      if (g.arms.pincer) {
        for (const s of [-1, 1]) {
          const cg = new THREE.ConeGeometry(g.arms.thickness * 0.7, g.arms.length * 0.5, 4);
          T(cg, Hd.clone().add(V(s * g.arms.thickness * 0.6, 0, g.arms.length * 0.2)), new THREE.Euler(Math.PI / 2, 0, s * 0.3));
          b.add(cg, accent, hb, false, 'pincer');
        }
      } else {
        const fist = new THREE.SphereGeometry(g.arms.thickness * 1.3, 6, 5);
        T(fist, Hd);
        b.add(fist, primary.clone().multiplyScalar(0.9), hb, false, 'fist');
        for (let c = -1; c <= 1; c++) {
          const cg = new THREE.ConeGeometry(g.arms.thickness * 0.25, g.arms.thickness * 1.4, 3);
          T(cg, Hd.clone().add(V(c * g.arms.thickness * 0.5, -g.arms.thickness * 0.8, g.arms.thickness * 0.6)), new THREE.Euler(Math.PI * 0.7, 0, 0));
          b.add(cg, claw, hb, false, 'talon');
        }
      }
      arms.push({ side, upper: up, lower: lo, hand });
    }
  }

  // ---- wings
  const wings: CreatureRig['wings'] = [];
  if (g.wings) {
    const base = spinePts[Math.max(0, n - 1)].clone().add(V(0, girthAt(0.8) * 0.7, 0));
    for (const side of [-1, 1] as const) {
      const wb = bone(`wing${side > 0 ? 'R' : 'L'}`, spine[Math.max(0, n - 1)], base.clone().add(V(side * girthAt(0.8) * 0.6, 0, 0)));
      const span = g.wings.span / 2;
      const verts = [
        base.clone().add(V(side * girthAt(0.8) * 0.6, 0, 0.15)),
        base.clone().add(V(side * span, span * 0.35, -0.1)),
        base.clone().add(V(side * span * 0.85, span * 0.1, -span * 0.55)),
        base.clone().add(V(side * span * 0.4, 0, -span * 0.5)),
        base.clone().add(V(side * girthAt(0.8) * 0.6, 0, -0.25)),
      ];
      const pos: number[] = [];
      for (const k of [[0, 1, 2], [0, 2, 3], [0, 3, 4]]) for (const i of side > 0 ? k : [...k].reverse()) pos.push(verts[i].x, verts[i].y, verts[i].z);
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wg.computeVertexNormals();
      b.add(wg, secondary.clone().lerp(accent, 0.2), () => [[idx(wb), 1]], false, 'wing');
      // Back faces so the membrane reads from both sides.
      const wg2 = wg.clone();
      const arr = wg2.attributes.position.array as Float32Array;
      for (let t = 0; t < arr.length; t += 9) for (let k = 0; k < 3; k++) [arr[t + 3 + k], arr[t + 6 + k]] = [arr[t + 6 + k], arr[t + 3 + k]];
      wg2.computeVertexNormals();
      b.add(wg2, secondary.clone().multiplyScalar(0.8), () => [[idx(wb), 1]], false, 'wing');
      wings.push({ side, bone: wb });
    }
  }

  // ---- tentacles
  const tentacles: THREE.Bone[][] = [];
  if (g.tentacles) {
    for (let t = 0; t < g.tentacles.count; t++) {
      const a = (t / g.tentacles.count) * Math.PI * 2 + 0.3;
      const base = V(Math.cos(a) * g.girth * 0.55, H - g.girth * 0.6, Math.sin(a) * g.girth * 0.55);
      const pts = [base];
      const chain: THREE.Bone[] = [];
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        pts.push(pts[s].clone().add(V(Math.cos(a) * 0.05, -g.tentacles.length / segs, Math.sin(a) * 0.05)));
        chain.push(bone(`tentacle${t}_${s}`, s ? chain[s - 1] : spine[0], pts[s]));
      }
      tube(b, pts, pts.map((_, i) => 0.06 * (1 - i / (segs + 1)) + 0.015), chain.map(idx), () => secondary.clone(), { sides: 5, name: 'tentacle' });
      tentacles.push(chain);
    }
  }

  const geometry = b.build();
  const mesh = new THREE.SkinnedMesh(geometry, []);
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  return {
    genome: g, root, bones, spine, neck, head, jaw, tail, legs, arms, wings, tentacles, mesh,
    height: H + g.girth,
    info: { bones: bones.length, vertices: b.pos.length / 3, triangles: (b.body.length + b.glow.length) / 3, parts: [...new Set(b.parts)] },
  };
}
