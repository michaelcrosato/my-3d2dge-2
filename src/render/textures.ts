/**
 * Procedural pixel-art textures (canvas, nearest-filtered): themed floors painted tile by tile
 * from the level grid, wall bricks/blocks/planks, crate faces. Deterministic hash noise, so a
 * level always looks the same, and cheap enough to build at level load.
 */
import * as THREE from 'three';
import { gridAt, type Level } from '../content/level';
import type { Theme } from '../content/themes';

/** Integer hash -> [0,1). */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(c: [number, number, number], k: number): [number, number, number] {
  return [Math.max(0, Math.min(255, c[0] * k)), Math.max(0, Math.min(255, c[1] * k)), Math.max(0, Math.min(255, c[2] * k))];
}

export function makeTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Texels per meter of generated floors. */
export const FLOOR_TPM = 8;

/**
 * Floor texture for a grid level: one texel block per tile, pattern by theme. Wall and void
 * tiles are painted with the grout color (they are covered by walls or not drawn).
 */
export function floorTexture(level: Level, th: Theme): THREE.CanvasTexture {
  const g = level.grid!;
  const T = FLOOR_TPM * g.cell;
  const W = g.cols * T, H = g.rows * T;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const base = hex(th.floor.base), alt = hex(th.floor.alt), grout = hex(th.floor.grout), accent = hex(th.floor.accent);
  const seed = level.seed ?? 1;
  const put = (x: number, y: number, col: [number, number, number]) => {
    const i = (y * W + x) * 4;
    img.data[i] = col[0];
    img.data[i + 1] = col[1];
    img.data[i + 2] = col[2];
    img.data[i + 3] = 255;
  };
  const pattern = th.floor.pattern;
  for (let r = 0; r < g.rows; r++)
    for (let col = 0; col < g.cols; col++) {
      const cell = gridAt(g, col, r);
      const tileRand = hash2(col, r, seed);
      const tone = tileRand < 0.5 ? base : alt;
      const tileK = 0.92 + hash2(col, r, seed + 7) * 0.16;
      const mossy = hash2(col >> 2, r >> 2, seed + 3) > 0.78;
      for (let ty = 0; ty < T; ty++)
        for (let tx = 0; tx < T; tx++) {
          const x = col * T + tx, y = r * T + ty;
          if (cell !== '.') {
            put(x, y, shade(grout, 0.8));
            continue;
          }
          const n = hash2(x, y, seed + 11);
          let px: [number, number, number] = shade(tone, tileK + (n - 0.5) * 0.08);
          switch (pattern) {
            case 'flagstone': {
              // Two stones per tile row, offset every other row.
              const off = (r & 1) * (T / 2);
              const sx = (tx + off) % T;
              if (ty === 0 || sx === 0 || (ty === T / 2 && hash2(col, r, seed + 5) > 0.5)) px = grout;
              else if (n > 0.985) px = shade(tone, 0.7);
              break;
            }
            case 'brick': {
              const row = ty >> 2;
              const sx = (tx + (row & 1) * 4) % T;
              if (ty % 4 === 0 || sx === 0) px = grout;
              break;
            }
            case 'cobble': {
              const cx = (tx + Math.floor(hash2(col, r, seed) * 3)) % 4, cy = ty % 4;
              if ((cx === 0 && cy === 0) || n > 0.93) px = grout;
              else px = shade(px, 0.94 + hash2((x >> 2), (y >> 2), seed) * 0.14);
              break;
            }
            case 'tile':
              if (tx === 0 || ty === 0) px = grout;
              else if (tx === 1 || ty === 1) px = shade(tone, tileK * 1.12);
              break;
            case 'plank': {
              if (ty % 4 === 0) px = grout;
              else if ((tx + (Math.floor(ty / 4) * 3 + col * 5)) % 16 === 0) px = grout;
              else px = shade(px, 0.95 + ((tx * 7 + ty) % 5) * 0.02);
              if (tx % 8 === 2 && ty % 4 === 2 && n > 0.6) px = shade(grout, 1.4);
              break;
            }
            case 'dirt':
              px = mix(tone, grout, n * 0.35);
              if (n > 0.97) px = accent;
              break;
            case 'grass':
              px = mix(tone, accent, n > 0.82 ? 0.7 : n * 0.25);
              if (n < 0.04) px = grout;
              break;
          }
          if (mossy && pattern !== 'grass' && hash2(x >> 1, y >> 1, seed + 21) > 0.82) px = mix(px, accent, 0.55);
          // Darken tiles next to walls (ambient-occlusion-like contact shading).
          const nearWall = (dx: number, dy: number) => gridAt(g, col + dx, r + dy) === '#';
          if ((tx === 0 && nearWall(-1, 0)) || (ty === 0 && nearWall(0, -1)) || (tx === T - 1 && nearWall(1, 0)) || (ty === T - 1 && nearWall(0, 1))) px = shade(px, 0.7);
          put(x, y, px);
        }
    }
  ctx.putImageData(img, 0, 0);
  return makeTexture(c);
}

/** Repeating wall texture (2 m x 2 m per repeat at 8 texels/m). */
export function wallTexture(th: Theme): THREE.CanvasTexture {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const side = [255, 255, 255] as [number, number, number];
  const line = shade(side, 0.68);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = hash2(x, y, 99);
      let px: [number, number, number] = shade(side, 0.94 + n * 0.08);
      switch (th.wall.pattern) {
        case 'brick':
          if (y % 4 === 0 || (x + ((y >> 2) & 1) * 4) % 8 === 0) px = line;
          break;
        case 'block':
          if (y % 8 === 0 || (x + ((y >> 3) & 1) * 8) % 16 === 0) px = line;
          else if (y % 8 === 1) px = shade(side, 1.06);
          break;
        case 'rough':
          px = shade(side, 0.86 + n * 0.2);
          if (hash2(x >> 1, y >> 1, 7) > 0.85) px = line;
          break;
        case 'plank':
          if (x % 4 === 0) px = line;
          else px = shade(side, 0.92 + ((y * 3 + x) % 7) * 0.02);
          break;
        case 'hedge':
          px = shade(side, 0.75 + n * 0.35);
          break;
      }
      const i = (y * S + x) * 4;
      img.data[i] = px[0];
      img.data[i + 1] = px[1];
      img.data[i + 2] = px[2];
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return makeTexture(c, true);
}

export function checkerTexture(a: string, b: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 2, 2);
  g.fillStyle = b;
  g.fillRect(1, 0, 1, 1);
  g.fillRect(0, 1, 1, 1);
  const t = makeTexture(c, true);
  return t;
}

export function crateTexture(pushable: boolean): THREE.Texture {
  const n = 24;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = pushable ? '#b98150' : '#8a5a36';
  g.fillRect(0, 0, n, n);
  g.fillStyle = pushable ? '#d39a62' : '#9d6a41';
  for (let y = 3; y < n - 3; y += 6) g.fillRect(3, y, n - 6, 3);
  g.fillStyle = pushable ? '#4d4a56' : '#5a3a22';
  g.fillRect(0, 0, n, 3);
  g.fillRect(0, n - 3, n, 3);
  g.fillRect(0, 0, 3, n);
  g.fillRect(n - 3, 0, 3, n);
  if (!pushable) {
    for (let i = 3; i < n - 3; i++) g.fillRect(i, i, 2, 2);
  } else {
    g.fillStyle = '#8f8a99';
    g.fillRect(n / 2 - 1, 0, 2, n);
  }
  return makeTexture(c);
}
