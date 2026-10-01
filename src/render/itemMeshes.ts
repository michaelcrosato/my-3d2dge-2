/**
 * Procedural item meshes from an item base's `look` (shape + colors) and the item's seed and
 * rarity. The same builder makes the sword in the hero's hand, the loot lying on the floor and
 * the inventory icon (rendered through the pixel pipeline by render/icons.ts), so what drops is
 * exactly what you see equipped. Seeds vary proportions; uniques glow; rares get gold trim.
 */
import * as THREE from 'three';
import { itemBase, type Item, type ItemBase } from '../content/items';
import { box, cone, cyl, lathe, merge, octa, sphere, torus, tone, type Color } from './geo';
import { glowMaterial, toonMaterial } from './materials';
import { hash2 } from './textures';

export interface ItemLookInput {
  base: string;
  rarity: Item['rarity'];
  seed: number;
  unique?: string;
}

export interface ItemGeometry {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
}

const RARITY_TRIM: Record<Item['rarity'], string | null> = { normal: null, magic: '#8fa8ff', rare: '#ffd84a', unique: '#ff9a3d' };

/**
 * Geometry in "hand space": weapons point along +Y with the grip at the origin; armour pieces sit
 * centered at the origin about 0.5 m across.
 */
export function itemGeometry(it: ItemLookInput): ItemGeometry {
  const base: ItemBase = itemBase(it.base);
  const { shape, color, accent } = base.look;
  const s = base.look.size ?? 1;
  const r = (k: number) => hash2(it.seed, k, 5);
  const trim = RARITY_TRIM[it.rarity] ?? accent;
  const glowParts: THREE.BufferGeometry[] = [];
  const parts: THREE.BufferGeometry[] = [];
  const steel: Color = color;
  const grip = '#4a3020';
  const uniqueGlow = it.unique ? trim : null;
  switch (shape) {
    case 'sword': case 'greatsword': {
      const L = (shape === 'greatsword' ? 1.05 : 0.72) * s * (0.92 + r(1) * 0.16);
      const W = (shape === 'greatsword' ? 0.09 : 0.06) * (0.85 + r(2) * 0.3);
      parts.push(box(W, L, 0.02, steel, { at: [0, 0.1 + L / 2, 0] }));
      parts.push(cone(W * 0.72, 0.12, steel, { at: [0, 0.16 + L, 0] }, 4));
      parts.push(box(W * (2.6 + r(3) * 1.4), 0.04, 0.05, trim, { at: [0, 0.08, 0] }));
      parts.push(box(0.035, 0.18, 0.035, grip, { at: [0, -0.02, 0] }));
      parts.push(sphere(0.035, trim, { at: [0, -0.13, 0] }, 5, 4));
      if (uniqueGlow) glowParts.push(box(W * 0.35, L * 0.85, 0.024, uniqueGlow, { at: [0, 0.12 + L / 2, 0] }));
      break;
    }
    case 'dagger': {
      const L = 0.36 * s;
      parts.push(cone(0.045, L, steel, { at: [0, 0.08 + L / 2, 0] }, 4));
      parts.push(box(0.14, 0.03, 0.04, trim, { at: [0, 0.06, 0] }));
      parts.push(box(0.03, 0.13, 0.03, grip, { at: [0, -0.01, 0] }));
      if (uniqueGlow) glowParts.push(octa(0.04, uniqueGlow, { at: [0, -0.1, 0] }));
      break;
    }
    case 'axe': {
      const H = 0.7 * s;
      parts.push(cyl(0.025, 0.03, H, grip, { at: [0, H / 2 - 0.1, 0] }, 6));
      parts.push(box(0.26 + r(1) * 0.08, 0.2 + r(2) * 0.08, 0.025, steel, { at: [0.12, H - 0.18, 0] }));
      if (r(3) > 0.5) parts.push(box(0.12, 0.12, 0.025, steel, { at: [-0.08, H - 0.18, 0] }));
      parts.push(box(0.05, 0.05, 0.05, trim, { at: [0, H - 0.18, 0] }));
      if (uniqueGlow) glowParts.push(box(0.03, 0.22, 0.03, uniqueGlow, { at: [0.25, H - 0.18, 0] }));
      break;
    }
    case 'mace': {
      const H = 0.65 * s;
      parts.push(cyl(0.025, 0.03, H, grip, { at: [0, H / 2 - 0.1, 0] }, 6));
      parts.push(sphere(0.1 + r(1) * 0.03, steel, { at: [0, H - 0.08, 0] }, 7, 5));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(cone(0.03, 0.09, trim, { at: [Math.cos(a) * 0.11, H - 0.08, Math.sin(a) * 0.11], rot: [0, 0, -Math.PI / 2 + 0], scale: 1 }, 4));
      }
      if (uniqueGlow) glowParts.push(sphere(0.06, uniqueGlow, { at: [0, H + 0.04, 0] }, 5, 4));
      break;
    }
    case 'staff': {
      const H = 1.35 * s;
      parts.push(cyl(0.03, 0.035, H, color, { at: [0, H / 2 - 0.35, 0] }, 6));
      parts.push(torus(0.08, 0.02, trim, { at: [0, H - 0.3, 0] }, 4, 10));
      glowParts.push(octa(0.09 + r(1) * 0.04, accent, { at: [0, H - 0.25, 0] }));
      break;
    }
    case 'shield_round':
      parts.push(cyl(0.32 * s, 0.32 * s, 0.05, color, { rot: [Math.PI / 2, 0, 0] }, 12));
      parts.push(sphere(0.07, accent, { at: [0, 0, 0.04] }, 6, 4));
      parts.push(torus(0.32 * s, 0.02, trim, {}, 4, 14));
      break;
    case 'shield_kite':
      parts.push(merge([box(0.5, 0.55, 0.05, color, { at: [0, 0.08, 0] }), cone(0.36, 0.35, color, { at: [0, -0.37, 0], rot: [Math.PI, 0, 0], scale: [1, 1, 0.14] }, 4)]));
      parts.push(box(0.06, 0.6, 0.06, trim, { at: [0, 0, 0.03] }));
      parts.push(box(0.4, 0.06, 0.06, trim, { at: [0, 0.15, 0.03] }));
      break;
    case 'shield_tower':
      parts.push(box(0.55, 0.95, 0.06, color, {}));
      parts.push(box(0.6, 0.06, 0.08, trim, { at: [0, 0.45, 0] }));
      parts.push(box(0.6, 0.06, 0.08, trim, { at: [0, -0.45, 0] }));
      break;
    case 'orb':
      parts.push(cyl(0.05, 0.08, 0.1, accent, { at: [0, -0.1, 0] }, 6));
      glowParts.push(sphere(0.13, color, {}, 8, 6));
      break;
    case 'cap':
      parts.push(sphere(0.2, color, { at: [0, 0.02, 0], scale: [1, 0.8, 1.05] }, 8, 5));
      parts.push(box(0.36, 0.04, 0.16, accent, { at: [0, -0.06, 0.12] }));
      break;
    case 'helm':
      parts.push(sphere(0.21, color, { at: [0, 0.03, 0], scale: [1, 0.95, 1.05] }, 8, 6));
      parts.push(box(0.06, 0.22, 0.06, trim, { at: [0, 0, 0.19] }));
      parts.push(torus(0.2, 0.025, trim, { at: [0, -0.06, 0], rot: [Math.PI / 2, 0, 0] }, 4, 12));
      break;
    case 'greathelm':
      parts.push(cyl(0.21, 0.22, 0.34, color, { at: [0, 0.03, 0] }, 10));
      parts.push(box(0.3, 0.04, 0.02, '#1a1a1a', { at: [0, 0.06, 0.21] }));
      parts.push(cone(0.06, 0.16, trim, { at: [0, 0.27, 0] }, 4));
      break;
    case 'circlet':
      parts.push(torus(0.18, 0.02, color, { rot: [Math.PI / 2, 0, 0] }, 4, 16));
      glowParts.push(octa(0.04, accent, { at: [0, 0.02, 0.18] }));
      break;
    case 'vest': case 'mail': case 'robe': case 'plate': {
      const long = shape === 'robe' ? 0.65 : 0.45;
      parts.push(box(0.42, long, 0.22, color, { at: [0, -long / 2 + 0.2, 0] }));
      parts.push(box(0.18, 0.12, 0.24, shape === 'plate' ? trim : tone(color, 0.8), { at: [-0.26, 0.14, 0] }));
      parts.push(box(0.18, 0.12, 0.24, shape === 'plate' ? trim : tone(color, 0.8), { at: [0.26, 0.14, 0] }));
      parts.push(box(0.44, 0.05, 0.24, accent, { at: [0, -0.08, 0] }));
      break;
    }
    case 'gloves': case 'gauntlets':
      parts.push(box(0.14, 0.18, 0.08, color, { at: [-0.1, 0, 0] }));
      parts.push(box(0.14, 0.18, 0.08, color, { at: [0.1, 0, 0] }));
      parts.push(box(0.16, 0.05, 0.1, accent, { at: [-0.1, -0.09, 0] }));
      parts.push(box(0.16, 0.05, 0.1, accent, { at: [0.1, -0.09, 0] }));
      break;
    case 'boots': case 'greaves':
      for (const x of [-0.1, 0.1]) {
        parts.push(box(0.12, 0.22, 0.12, color, { at: [x, 0.05, 0] }));
        parts.push(box(0.13, 0.08, 0.22, tone(color, 0.85), { at: [x, -0.08, 0.05] }));
        parts.push(box(0.14, 0.04, 0.14, accent, { at: [x, 0.15, 0] }));
      }
      break;
    case 'belt':
      parts.push(torus(0.18, 0.035, color, { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.7] }, 4, 14));
      parts.push(box(0.08, 0.08, 0.04, accent, { at: [0, 0, 0.18] }));
      break;
    case 'amulet':
      parts.push(torus(0.14, 0.012, color, { at: [0, 0.08, 0] }, 4, 14, Math.PI));
      glowParts.push(octa(0.06, accent, { at: [0, -0.08, 0] }));
      break;
    case 'ring':
      parts.push(torus(0.08, 0.022, color, { rot: [0.5, 0, 0] }, 5, 12));
      glowParts.push(octa(0.04, accent, { at: [0, 0.09, 0] }));
      break;
    case 'flask':
      // Liquid-filled bulb, glass neck, cork.
      glowParts.push(lathe([[0, -0.15], [0.1, -0.14], [0.125, -0.05], [0.07, 0.05], [0, 0.05]], color, {}, 8));
      parts.push(lathe([[0.065, 0.04], [0.045, 0.06], [0.04, 0.12], [0.05, 0.14], [0, 0.14]], '#d8e0e8', {}, 8));
      parts.push(cyl(0.035, 0.035, 0.05, accent, { at: [0, 0.16, 0] }, 6));
      break;
    case 'jewel':
      glowParts.push(octa(0.12, color, { scale: [1, 1.3, 1] }));
      parts.push(torus(0.12, 0.015, accent, { rot: [Math.PI / 2, 0, 0] }, 4, 10));
      break;
    default:
      parts.push(box(0.2, 0.2, 0.2, color));
  }
  if (trim && it.rarity !== 'normal' && shape !== 'ring' && shape !== 'amulet' && shape !== 'jewel' && shape !== 'flask' && !uniqueGlow) {
    // A tiny rarity gem on every magic/rare piece.
    glowParts.push(octa(0.03, trim, { at: [0, 0, 0.06] }));
  }
  return { body: merge(parts), glow: glowParts.length ? merge(glowParts) : null };
}

const cache = new Map<string, ItemGeometry>();
/** Most-recently-used item looks kept on the GPU; older ones are freed (and rebuilt if they return). */
export const ITEM_GEOMETRY_CACHE = 256;

export function cachedItemGeometry(it: ItemLookInput): ItemGeometry {
  const key = `${it.base}|${it.rarity}|${it.seed % 64}|${it.unique ?? ''}`;
  let g = cache.get(key);
  if (g) {
    // Refresh recency (Map keeps insertion order).
    cache.delete(key);
    cache.set(key, g);
    return g;
  }
  cache.set(key, (g = itemGeometry(it)));
  while (cache.size > ITEM_GEOMETRY_CACHE) {
    const [oldKey, old] = cache.entries().next().value!;
    cache.delete(oldKey);
    // Safe even if a pickup still shows it: three.js re-uploads a disposed geometry on next use.
    old.body.dispose();
    old.glow?.dispose();
  }
  return g;
}

export const itemGeometryCacheSize = () => cache.size;

/** A ready-to-add object (toon body + unlit glow parts). */
export function itemObject(it: ItemLookInput): THREE.Group {
  const g = cachedItemGeometry(it);
  const group = new THREE.Group();
  const body = new THREE.Mesh(g.body, toonMaterial(0xffffff, null, true));
  group.add(body);
  if (g.glow) {
    const glow = new THREE.Mesh(g.glow, glowMaterial(0xffffff));
    (glow.material as THREE.MeshBasicMaterial).vertexColors = true;
    group.add(glow);
  }
  group.name = `item:${it.base}`;
  return group;
}
