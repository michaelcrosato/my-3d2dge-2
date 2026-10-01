/**
 * Dynamic lighting with a fixed pool of point lights. three.js recompiles every material when the
 * number of lights changes, so the pool keeps N lights alive forever and, each frame, hands them
 * to the N most important requests near the camera (torches, fireballs, explosions, loot beams,
 * portals, the hero's lantern). Unused lights sit at intensity 0. Toon materials quantize the
 * falloff into hard bands, which reads beautifully at pixel resolution.
 */
import * as THREE from 'three';

export interface LightRequest {
  x: number;
  y: number;
  z: number;
  color: THREE.ColorRepresentation;
  intensity: number;
  range: number;
  /** Higher wins when the pool is full (explosions > projectiles > torches). */
  priority?: number;
}

export const POOL_SIZE = 16;

export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private requests: LightRequest[] = [];
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'light-pool';
    for (let i = 0; i < POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 1.4);
      l.castShadow = false;
      l.name = `pool${i}`;
      this.lights.push(l);
      this.group.add(l);
    }
  }

  begin() {
    this.requests.length = 0;
  }

  add(r: LightRequest) {
    if (r.intensity > 0.01) this.requests.push(r);
  }

  /** Assigns the best requests to pool lights. `fx, fz` = view center; `reach` = view radius. */
  commit(fx: number, fz: number, reach: number) {
    const scored = this.requests
      .map((r) => {
        const d = Math.hypot(r.x - fx, r.z - fz);
        return { r, score: (r.priority ?? 0) * 10 - Math.max(0, d - r.range * 0.5) + (d > reach + r.range ? -1000 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    for (let i = 0; i < POOL_SIZE; i++) {
      const l = this.lights[i];
      const s = scored[i];
      if (!s || s.score < -500) {
        l.intensity = 0;
        continue;
      }
      l.position.set(s.r.x, s.r.y, s.r.z);
      l.color.set(s.r.color);
      l.intensity = s.r.intensity;
      l.distance = s.r.range;
    }
  }

  get active() {
    return this.lights.filter((l) => l.intensity > 0).length;
  }
}
