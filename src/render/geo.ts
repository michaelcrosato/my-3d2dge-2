/**
 * Tiny procedural modeling kit: vertex-colored primitives that can be transformed and merged
 * into one geometry (one draw call). Props, decor, item meshes and creature parts are all built
 * from these, so every asset in the game is code that agents can read, tweak and regenerate.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Color = THREE.ColorRepresentation;

const tmpColor = new THREE.Color();

/** Strips uvs, adds a flat vertex color. */
export function paint(g: THREE.BufferGeometry, color: Color): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  tmpColor.set(color);
  for (let i = 0; i < n; i++) tmpColor.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export interface Place {
  at?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
}

export function place(g: THREE.BufferGeometry, p: Place = {}): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
  const s = typeof p.scale === 'number' ? new THREE.Vector3(p.scale, p.scale, p.scale) : new THREE.Vector3(...(p.scale ?? [1, 1, 1]));
  m.compose(new THREE.Vector3(...(p.at ?? [0, 0, 0])), q, s);
  g.applyMatrix4(m);
  return g;
}

export const box = (w: number, h: number, d: number, color: Color, p?: Place) => place(paint(new THREE.BoxGeometry(w, h, d), color), p);
export const cyl = (rt: number, rb: number, h: number, color: Color, p?: Place, seg = 8) => place(paint(new THREE.CylinderGeometry(rt, rb, h, seg), color), p);
export const cone = (r: number, h: number, color: Color, p?: Place, seg = 6) => place(paint(new THREE.ConeGeometry(r, h, seg), color), p);
export const sphere = (r: number, color: Color, p?: Place, w = 8, hs = 6) => place(paint(new THREE.SphereGeometry(r, w, hs), color), p);
export const torus = (r: number, tube: number, color: Color, p?: Place, rs = 6, ts = 12, arc = Math.PI * 2) => place(paint(new THREE.TorusGeometry(r, tube, rs, ts, arc), color), p);
export const ico = (r: number, color: Color, p?: Place, detail = 0) => place(paint(new THREE.IcosahedronGeometry(r, detail), color), p);
export const octa = (r: number, color: Color, p?: Place) => place(paint(new THREE.OctahedronGeometry(r, 0), color), p);
export const lathe = (pts: Array<[number, number]>, color: Color, p?: Place, seg = 10) =>
  place(paint(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color), p);

/** Merges parts (all indexed or all non-indexed handled) into one geometry. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.filter(Boolean);
  const indexed = list.every((g) => g.index);
  const norm = indexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(norm, false);
  if (!merged) throw new Error('merge failed: mismatched attributes');
  merged.computeBoundingSphere();
  return merged;
}

/** Darken/lighten a hex color. */
export function tone(color: Color, k: number): THREE.Color {
  const c = new THREE.Color(color);
  return c.multiplyScalar(k);
}
