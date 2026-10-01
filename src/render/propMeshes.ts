/**
 * Procedural meshes for props and decor, built from render/geo.ts primitives. Every builder
 * returns vertex-colored geometry (merged per level for decor) plus optional glowing parts and a
 * light. Colors come from the level theme, so the same urn is clay in the crypt and ice in the
 * frozen halls.
 */
import * as THREE from 'three';
import type { Theme } from '../content/themes';
import { box, cone, cyl, ico, lathe, merge, octa, sphere, tone, torus, type Color } from './geo';
import { hash2 } from './textures';

export interface PropMesh {
  body: THREE.BufferGeometry;
  glow?: THREE.BufferGeometry;
  /** Animated part (chest lid, keg fuse), pivot at its origin. */
  part?: THREE.BufferGeometry;
  partAt?: [number, number, number];
  light?: { y: number; color: Color; intensity: number; range: number; flicker?: number };
  /** Tall enough to need the hero cutaway. */
  tall?: boolean;
  /** Translucent overlay (ice sheets, time bubbles, gravity swirls). */
  fx?: { geo: THREE.BufferGeometry; color: string; opacity: number };
}

const METAL = '#4a4650', WOOD = '#6a4a2e', WOOD_D = '#4a3020', GOLD = '#c9a13b';

export function propMesh(kind: string, th: Theme, seed: number): PropMesh | null {
  const r = (k: number) => hash2(seed, k, 17);
  switch (kind) {
    case 'torch':
      return {
        body: merge([box(0.12, 0.3, 0.12, METAL, { at: [0, 0, 0] }), box(0.06, 0.06, 0.35, METAL, { at: [0, -0.05, -0.18] }), cyl(0.06, 0.04, 0.12, WOOD_D, { at: [0, 0.2, 0] })]),
        glow: merge([cone(0.09, 0.26, th.torch, { at: [0, 0.38, 0] }), cone(0.05, 0.16, '#fff0c0', { at: [0, 0.34, 0] })]),
        light: { y: 0.45, color: th.torch, intensity: 2.2, range: 7, flicker: 0.25 },
      };
    case 'brazier':
      return {
        body: merge([cyl(0.38, 0.22, 0.25, METAL, { at: [0, 0.75, 0] }), ...[0, 2.1, 4.2].map((a) => box(0.05, 0.75, 0.05, METAL, { at: [Math.cos(a) * 0.2, 0.37, Math.sin(a) * 0.2], rot: [Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2] }))]),
        glow: merge([cone(0.3, 0.45, th.torch, { at: [0, 1.05, 0] }), sphere(0.2, '#fff0c0', { at: [0, 0.9, 0] })]),
        light: { y: 1.2, color: th.torch, intensity: 3, range: 8, flicker: 0.3 },
      };
    case 'urn': {
      const c = tone(th.wall.side, 0.75 + r(1) * 0.3);
      return { body: lathe([[0, 0], [0.18, 0.02], [0.27, 0.25], [0.24, 0.5], [0.13, 0.62], [0.16, 0.72], [0, 0.72]], c, {}, 8) };
    }
    case 'barrel':
      return { body: merge([cyl(0.3, 0.3, 0.85, WOOD, { at: [0, 0.43, 0] }, 10), torus(0.31, 0.025, METAL, { at: [0, 0.2, 0], rot: [Math.PI / 2, 0, 0] }), torus(0.31, 0.025, METAL, { at: [0, 0.66, 0], rot: [Math.PI / 2, 0, 0] })]) };
    case 'crate':
      return { body: merge([box(0.8, 0.8, 0.8, '#9a6a40', { at: [0, 0.4, 0] }), box(0.84, 0.1, 0.84, WOOD_D, { at: [0, 0.75, 0] }), box(0.84, 0.1, 0.84, WOOD_D, { at: [0, 0.05, 0] }), box(0.1, 0.8, 0.84, WOOD_D, { at: [0, 0.4, 0], rot: [0, 0, 0.78] })]) };
    case 'coffin':
      return { body: merge([box(0.7, 0.45, 1.5, '#5a4030', { at: [0, 0.22, 0] }), box(0.74, 0.08, 1.54, '#3a2a20', { at: [0, 0.48, 0] }), box(0.08, 0.02, 0.6, GOLD, { at: [0, 0.53, -0.1] }), box(0.35, 0.02, 0.08, GOLD, { at: [0, 0.53, -0.25] })]) };
    case 'chest':
      return {
        body: merge([box(0.9, 0.45, 0.6, '#7a4a2a', { at: [0, 0.23, 0] }), box(0.94, 0.06, 0.64, GOLD, { at: [0, 0.03, 0] }), box(0.1, 0.2, 0.05, GOLD, { at: [0, 0.32, 0.31] })]),
        part: merge([box(0.92, 0.22, 0.62, '#8a5a32', { at: [0, 0.11, 0.31] }), box(0.96, 0.05, 0.66, GOLD, { at: [0, 0.2, 0.31] })]),
        partAt: [0, 0.45, -0.31],
      };
    case 'portal':
      return {
        body: merge([torus(1.0, 0.13, '#3a3450', { at: [0, 1.15, 0], rot: [0, Math.PI / 4, 0] }, 6, 16), box(1.6, 0.15, 0.7, '#3a3450', { at: [0, 0.07, 0], rot: [0, Math.PI / 4, 0] })]),
        glow: merge([cyl(0.9, 0.9, 0.05, '#7ab8ff', { at: [0, 1.15, 0], rot: [Math.PI / 2, 0, Math.PI / 4] }, 16)]),
        light: { y: 1.2, color: '#7ab8ff', intensity: 3, range: 7 },
        tall: true,
      };
    case 'waypoint':
      return {
        body: merge([cyl(1.2, 1.35, 0.25, '#6a6a72', { at: [0, 0.12, 0] }, 12), cyl(0.9, 1.0, 0.1, '#8a8a92', { at: [0, 0.3, 0] }, 12)]),
        glow: merge([torus(0.65, 0.05, '#7affd8', { at: [0, 0.37, 0], rot: [Math.PI / 2, 0, 0] }, 4, 16), octa(0.18, '#bfffee', { at: [0, 1.2, 0] })]),
        light: { y: 1.2, color: '#7affd8', intensity: 2.5, range: 7 },
      };
    case 'stash':
      return {
        body: merge([box(1.3, 0.7, 0.8, '#5a3a24', { at: [0, 0.35, 0] }), box(1.36, 0.1, 0.86, GOLD, { at: [0, 0.72, 0] }), box(0.16, 0.25, 0.06, GOLD, { at: [0, 0.5, 0.41] })]),
      };
    case 'anvil':
      return { body: merge([box(0.35, 0.4, 0.35, '#3a3a40', { at: [0, 0.2, 0] }), box(0.7, 0.18, 0.3, '#4a4a52', { at: [0, 0.48, 0] }), cone(0.12, 0.3, '#4a4a52', { at: [0.48, 0.5, 0], rot: [0, 0, -Math.PI / 2] })]) };
    case 'shrine_respec':
      return {
        body: merge([box(0.6, 1.8, 0.6, '#5a5a6a', { at: [0, 0.9, 0] }), cone(0.45, 0.5, '#5a5a6a', { at: [0, 2.05, 0] }, 4)]),
        glow: merge([box(0.62, 0.08, 0.62, '#c77dff', { at: [0, 1.2, 0] }), octa(0.15, '#e8c0ff', { at: [0, 2.5, 0] })]),
        light: { y: 1.6, color: '#c77dff', intensity: 2.2, range: 6 },
        tall: true,
      };
    case 'dummy_post':
      return { body: merge([cyl(0.08, 0.08, 1.6, WOOD, { at: [0, 0.8, 0] }), box(0.8, 0.08, 0.08, WOOD, { at: [0, 1.3, 0] })]) };
    case 'keg':
      return {
        body: merge([cyl(0.32, 0.32, 0.9, '#8a2a1a', { at: [0, 0.45, 0] }, 10), torus(0.33, 0.03, METAL, { at: [0, 0.18, 0], rot: [Math.PI / 2, 0, 0] }), torus(0.33, 0.03, METAL, { at: [0, 0.72, 0], rot: [Math.PI / 2, 0, 0] }),
          box(0.3, 0.12, 0.02, '#e8d8a0', { at: [0, 0.5, 0.32] }), box(0.06, 0.06, 0.02, '#1a1414', { at: [0, 0.5, 0.335] })]),
        glow: merge([cyl(0.015, 0.015, 0.18, '#ffe9a0', { at: [0.1, 1.0, 0] }, 4), sphere(0.04, '#ff9a3d', { at: [0.1, 1.1, 0] }, 4, 3)]),
      };
    case 'spikes':
      return {
        body: merge([box(0.96, 0.06, 0.96, '#3a3640', { at: [0, 0.03, 0] }), box(0.8, 0.02, 0.8, '#1a1820', { at: [0, 0.065, 0] })]),
        part: merge([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => cone(0.07, 0.45, '#c8ccd4', { at: [((i % 3) - 1) * 0.28, 0.22, (Math.floor(i / 3) - 1) * 0.28] }, 4))),
        partAt: [0, 0, 0],
      };
    case 'shrine':
      return {
        body: merge([cyl(0.5, 0.6, 0.25, '#6a6a76', { at: [0, 0.12, 0] }, 8), cyl(0.18, 0.24, 0.9, '#8a8a96', { at: [0, 0.65, 0] }, 6), cyl(0.32, 0.2, 0.12, '#6a6a76', { at: [0, 1.15, 0] }, 6)]),
        glow: merge([octa(0.22, '#ffffff', { at: [0, 1.5, 0], scale: [1, 1.4, 1] })]),
        light: { y: 1.5, color: '#ffffff', intensity: 2.4, range: 6 },
      };
    case 'launchpad':
      return {
        body: merge([cyl(0.78, 0.85, 0.16, '#4a4a56', { at: [0, 0.08, 0] }, 12)]),
        glow: merge([torus(0.55, 0.06, '#7affd8', { at: [0, 0.18, 0], rot: [Math.PI / 2, 0, 0] }, 4, 14), cone(0.18, 0.3, '#bfffee', { at: [0, 0.3, 0] }, 4)]),
        light: { y: 0.6, color: '#7affd8', intensity: 1.6, range: 4 },
      };
    case 'ice': {
      const g = new THREE.CircleGeometry(1, 6);
      g.rotateX(-Math.PI / 2);
      return { body: merge([box(0.1, 0.01, 0.1, '#cdf3ff', { at: [0, -0.2, 0] })]), fx: { geo: g, color: '#6fc8ff', opacity: 0.42 } };
    }
    case 'beacon':
      return {
        body: merge([cyl(0.08, 0.1, 1.1, METAL, { at: [0, 0.55, 0] }, 6), cyl(0.36, 0.24, 0.2, METAL, { at: [0, 1.18, 0] }, 8), cyl(0.3, 0.3, 0.06, '#2a2420', { at: [0, 1.26, 0] }, 8)]),
        glow: merge([cone(0.26, 0.5, th.torch, { at: [0, 1.5, 0] }, 6), sphere(0.15, '#fff0c0', { at: [0, 1.38, 0] }, 5, 4)]),
        light: { y: 1.6, color: th.torch, intensity: 4.5, range: 11, flicker: 0.2 },
      };
    case 'chute':
      return { body: merge([box(1.4, 1.6, 0.5, th.wall.side, { at: [0, 0.8, -0.3] }), box(0.35, 1.3, 0.9, th.wall.trim, { at: [-0.55, 0.65, 0.1] }), box(0.35, 1.3, 0.9, th.wall.trim, { at: [0.55, 0.65, 0.1] }), box(1.5, 0.3, 0.9, th.wall.top, { at: [0, 1.45, 0.1] })]), tall: true };
    case 'boulder':
      return { body: merge([ico(0.62, tone(th.wall.side, 0.85), {}, 1), ico(0.2, tone(th.wall.side, 0.6), { at: [0.35, 0.3, 0.2] })]) };
    case 'rift':
      return {
        body: merge([torus(0.9, 0.12, '#3a2a4a', { at: [0, 1.05, 0] }, 6, 16), box(1.2, 0.12, 0.5, '#3a2a4a', { at: [0, 0.06, 0] })]),
        glow: merge([cyl(0.78, 0.78, 0.04, '#c77dff', { at: [0, 1.05, 0], rot: [Math.PI / 2, 0, 0] }, 16)]),
        light: { y: 1.1, color: '#c77dff', intensity: 2.5, range: 6 },
        tall: true,
      };
    case 'vent':
      return {
        body: merge([box(1.0, 0.08, 1.0, '#2a2422', { at: [0, 0.04, 0] }), ...[-0.3, -0.1, 0.1, 0.3].map((x) => box(0.06, 0.03, 0.8, '#4a4040', { at: [x, 0.09, 0] }))]),
        glow: merge([box(0.8, 0.02, 0.8, '#ff6a2a', { at: [0, 0.07, 0] })]),
        light: { y: 0.6, color: '#ff6a2a', intensity: 0, range: 5 },
      };
    case 'pylon':
      return {
        body: merge([
          box(0.62, 0.22, 0.62, th.wall.trim, { at: [0, 0.11, 0] }),
          cyl(0.16, 0.22, 1.5, METAL, { at: [0, 0.95, 0] }, 6),
          ...[0.65, 1.0, 1.35].map((y) => torus(0.22, 0.05, '#b87333', { at: [0, y, 0], rot: [Math.PI / 2, 0, 0] }, 4, 10)),
          cyl(0.24, 0.12, 0.14, METAL, { at: [0, 1.75, 0] }, 6),
        ]),
        glow: merge([octa(0.2, '#9fdcff', { at: [0, 2.0, 0] })]),
        light: { y: 2.0, color: '#9fdcff', intensity: 0, range: 6 },
        tall: true,
      };
    case 'totem':
      return {
        body: merge([cyl(0.22, 0.28, 1.6, '#5a4030', { at: [0, 0.8, 0] }, 6), sphere(0.2, '#e8e0c8', { at: [0, 1.15, 0.12] }, 6, 5), sphere(0.2, '#e8e0c8', { at: [0, 1.65, 0.1] }, 6, 5), box(0.9, 0.1, 0.1, '#5a4030', { at: [0, 1.45, 0] })]),
        glow: merge([sphere(0.05, '#c77dff', { at: [-0.07, 1.18, 0.3] }, 4, 3), sphere(0.05, '#c77dff', { at: [0.07, 1.18, 0.3] }, 4, 3), octa(0.12, '#c77dff', { at: [0, 1.95, 0] })]),
        light: { y: 1.9, color: '#b388ff', intensity: 1.8, range: 5 },
        tall: true,
      };
    case 'well': {
      const g = new THREE.RingGeometry(0.15, 1, 24);
      g.rotateX(-Math.PI / 2);
      return { body: merge([cyl(0.25, 0.3, 0.1, '#1a1428', { at: [0, 0.05, 0] }, 10)]), glow: merge([octa(0.12, '#9a8cff', { at: [0, 0.5, 0] })]), fx: { geo: g, color: '#5a3a9a', opacity: 0.45 }, light: { y: 0.6, color: '#7a5aff', intensity: 1.2, range: 4 } };
    }
    case 'chrono': {
      const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      return { body: merge([cyl(0.2, 0.25, 0.4, '#c9a13b', { at: [0, 0.2, 0] }, 6)]), glow: merge([torus(0.18, 0.03, '#9fdcff', { at: [0, 0.5, 0], rot: [Math.PI / 2, 0, 0] }, 4, 10)]), fx: { geo: g, color: '#9fdcff', opacity: 0.18 }, light: { y: 0.8, color: '#9fdcff', intensity: 1.2, range: 5 } };
    }
    case 'pillar':
      return { body: merge([cyl(0.4, 0.45, 2.6, th.wall.side, { at: [0, 1.3, 0] }, 8), box(1, 0.25, 1, th.wall.top, { at: [0, 2.6, 0] }), box(1, 0.2, 1, th.wall.trim, { at: [0, 0.1, 0] })]), tall: true };
    default:
      return null;
  }
}

/** Small floor decor pieces (merged per level; never collide). */
export function decorMesh(kind: string, th: Theme, seed: number): PropMesh | null {
  const r = (k: number) => hash2(seed, k, 31);
  switch (kind) {
    case 'bones':
      return { body: merge([box(0.5, 0.05, 0.06, '#e0d8c0', { at: [0, 0.03, 0], rot: [0, r(1) * 3, 0] }), box(0.35, 0.05, 0.05, '#d0c8b0', { at: [0.1, 0.03, 0.1], rot: [0, r(2) * 3, 0] }), sphere(0.05, '#e0d8c0', { at: [-0.2, 0.04, 0.05] }, 5, 4)]) };
    case 'skull':
      return { body: merge([sphere(0.13, '#e8e0c8', { at: [0, 0.12, 0] }, 6, 5), box(0.14, 0.06, 0.1, '#d8d0b8', { at: [0, 0.03, 0.06] })]) };
    case 'rubble':
      return { body: merge([0, 1, 2, 3].map((i) => ico(0.08 + r(i) * 0.1, tone(th.wall.side, 0.7 + r(i + 5) * 0.4), { at: [(r(i + 9) - 0.5) * 0.6, 0.05, (r(i + 13) - 0.5) * 0.6] }))) };
    case 'candles':
      return {
        body: merge([0, 1, 2].map((i) => cyl(0.035, 0.035, 0.15 + r(i) * 0.15, '#f0e8d0', { at: [(r(i + 3) - 0.5) * 0.35, 0.1, (r(i + 6) - 0.5) * 0.35] }, 5))),
        glow: merge([0, 1, 2].map((i) => cone(0.025, 0.06, '#ffd070', { at: [(r(i + 3) - 0.5) * 0.35, 0.2 + r(i) * 0.15, (r(i + 6) - 0.5) * 0.35] }, 4))),
      };
    case 'barrels':
      return { body: merge([cyl(0.28, 0.28, 0.8, WOOD, { at: [0, 0.4, 0] }, 8), cyl(0.28, 0.28, 0.8, WOOD, { at: [0.55, 0.4, 0.1] }, 8), cyl(0.3, 0.3, 0.05, METAL, { at: [0, 0.6, 0] }, 8)]), tall: false };
    case 'sacks':
      return { body: merge([sphere(0.25, '#a08a60', { at: [0, 0.18, 0], scale: [1, 0.7, 1] }, 6, 5), sphere(0.22, '#8a7a50', { at: [0.3, 0.15, 0.15], scale: [1, 0.7, 1] }, 6, 5)]) };
    case 'icicles':
    case 'crystals': {
      const c = kind === 'icicles' ? '#cdf3ff' : th.floor.accent;
      return {
        body: merge([cyl(0.12, 0.2, 0.08, tone(th.wall.side, 0.6), { at: [0, 0.04, 0] }, 6)]),
        glow: merge([0, 1, 2].map((i) => cone(0.07 + r(i) * 0.06, 0.4 + r(i + 4) * 0.5, c, { at: [(r(i + 7) - 0.5) * 0.3, 0.25, (r(i + 9) - 0.5) * 0.3], rot: [(r(i + 2) - 0.5) * 0.6, 0, (r(i + 3) - 0.5) * 0.6] }, 4))),
      };
    }
    case 'anvils':
      return propMesh('anvil', th, seed);
    case 'chains':
      return { body: merge([0, 1, 2, 3].map((i) => torus(0.07, 0.018, METAL, { at: [i * 0.11, 0.03, 0], rot: [Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0] }, 4, 8))) };
    case 'grass':
      return { body: merge([0, 1, 2, 3, 4].map((i) => cone(0.04, 0.25 + r(i) * 0.2, tone(th.floor.accent, 0.8 + r(i + 1) * 0.5), { at: [(r(i + 2) - 0.5) * 0.4, 0.12, (r(i + 3) - 0.5) * 0.4], rot: [(r(i + 4) - 0.5) * 0.5, 0, (r(i + 5) - 0.5) * 0.5] }, 3))) };
    case 'mushrooms':
      return {
        body: merge([0, 1].map((i) => cyl(0.04, 0.05, 0.18, '#e8e0d0', { at: [i * 0.18, 0.09, i * 0.1] }, 5))),
        glow: merge([0, 1].map((i) => sphere(0.1 + i * 0.03, '#d6ff7a', { at: [i * 0.18, 0.2, i * 0.1], scale: [1, 0.5, 1] }, 6, 4))),
      };
    case 'flowers':
      return { body: merge([0, 1, 2, 3].map((i) => sphere(0.05, ['#ff7aa8', '#ffe95c', '#9fd9ff', '#ffffff'][i], { at: [(r(i) - 0.5) * 0.4, 0.08, (r(i + 4) - 0.5) * 0.4] }, 4, 3))) };
    case 'embers':
      return { body: merge([box(0.3, 0.06, 0.3, '#2a2220', { at: [0, 0.03, 0] })]), glow: merge([0, 1, 2].map((i) => box(0.06, 0.04, 0.06, '#ff6a2a', { at: [(r(i) - 0.5) * 0.25, 0.06, (r(i + 3) - 0.5) * 0.25] }))) };
    case 'tentacles':
      return { body: merge([0, 1, 2].map((i) => cone(0.08, 0.6 + r(i) * 0.4, '#5a3a8a', { at: [(r(i + 1) - 0.5) * 0.5, 0.3, (r(i + 2) - 0.5) * 0.5], rot: [(r(i + 3) - 0.5) * 0.8, 0, (r(i + 4) - 0.5) * 0.8] }, 5))) };
    default:
      return null;
  }
}
