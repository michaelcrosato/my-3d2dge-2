/**
 * Software-drawn inspection images: a top-down level map (tiles, rooms, props, monsters, start,
 * exit) and the passive tree. Both are pure (no GPU), so agents can judge generated content in
 * bulk, and tests can check them under Node.
 */
import { gridAt, type Level } from '../content/level';
import { SECTOR_COLOR, TREE, type TreeNode } from '../content/tree';
import { theme } from '../content/themes';
import type { Img } from './capture';
import { fillCircle, fillRect, line, newImg, rgba, ring, setPx, strokeRect, text, type RGBA } from './raster';

export const MAP_COLORS = {
  room: { start: '#5ad06a', combat: '#8a8299', boss: '#ff4a4a', treasure: '#ffd24a', mechanic: '#4ac0c8', corridor: '#4a4456' },
  monster: { normal: '#e8e4da', magic: '#8888ff', rare: '#ffff77', unique: '#ff9a3d' },
  start: '#5ad06a',
  exit: '#e05aff',
  prop: '#4ac0c8',
  hazard: '#ff7a3a',
  container: '#c9a13b',
} as const;

const HAZARDS = new Set(['keg', 'spikes', 'vent', 'chute', 'boulder', 'well', 'chrono']);

/**
 * Top-down map, `px` pixels per tile, north (-z) up. Monsters: dots by rarity (bosses large, red
 * ring). Props: hazards orange, containers gold, other mechanics cyan.
 */
export function levelMap(level: Level, px = 4): { img: Img; legend: Record<string, string> } {
  const g = level.grid;
  if (!g) throw new Error('level has no tile grid (only generated dungeons and town have one)');
  const th = theme(level.theme ?? 'crypt');
  const img = newImg(g.cols * px, g.rows * px, rgba('#0d0c11'));
  const floorA = rgba(level.floor.colorA), floorB = rgba(level.floor.colorB), wall = rgba(level.wallTopColor ?? level.wallColor);
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const v = gridAt(g, c, r);
      if (v === ' ') continue;
      fillRect(img, c * px, r * px, px, px, v === '#' ? wall : (c + r) % 2 ? floorA : floorB);
    }
  const toPx = (x: number, z: number) => ({ x: ((x - g.originX) / g.cell) * px, y: ((z - g.originZ) / g.cell) * px });
  for (const room of level.rooms ?? []) {
    if (room.kind === 'corridor') continue;
    const a = toPx(room.x, room.z);
    strokeRect(img, Math.round(a.x), Math.round(a.y), Math.round((room.w / g.cell) * px), Math.round((room.h / g.cell) * px), rgba(MAP_COLORS.room[room.kind], 200));
  }
  for (const l of level.lights ?? []) {
    const p = toPx(l.x, l.z);
    setPx(img, p.x, p.y, rgba(l.color ?? th.torch ?? '#ffb060', 220));
  }
  const containers = new Set([...th.breakables, 'chest']);
  for (const p of level.props ?? []) {
    if (p.kind === 'torch' || p.kind.startsWith('decor:')) continue;
    const q = toPx(p.x, p.z);
    const col = p.kind === 'portal' ? MAP_COLORS.exit : HAZARDS.has(p.kind) ? MAP_COLORS.hazard : containers.has(p.kind) ? MAP_COLORS.container : MAP_COLORS.prop;
    const r = Math.max(1, px * 0.35 * (p.scale ?? 1));
    if (p.kind === 'ice' || p.kind === 'well' || p.kind === 'chrono') ring(img, q.x, q.y, Math.max(2, ((p.scale ?? 1) / g.cell) * px), rgba(col, 160));
    else fillCircle(img, q.x, q.y, r, rgba(col));
  }
  for (const ch of level.characters) {
    const m = ch.monster;
    if (!m) continue;
    const q = toPx(ch.x, ch.z);
    const boss = ch.id.startsWith('boss') || m.rarity === 'unique';
    fillCircle(img, q.x, q.y, boss ? px * 0.9 : Math.max(1, px * 0.4), rgba(MAP_COLORS.monster[m.rarity]));
    if (boss) ring(img, q.x, q.y, px * 1.4, rgba('#ff4a4a'));
  }
  if (level.start) {
    const s = toPx(level.start.x, level.start.z);
    fillRect(img, s.x - px * 0.7, s.y - px * 0.7, px * 1.4, px * 1.4, rgba(MAP_COLORS.start));
  }
  if (level.exit) {
    const e = toPx(level.exit.x, level.exit.z);
    ring(img, e.x, e.y, px, rgba(MAP_COLORS.exit));
  }
  if (level.title) text(img, level.title, 2, 2, rgba('#e8e4da'));
  return {
    img,
    legend: {
      'green square': 'start', 'magenta ring': 'exit (opens when the boss dies)', 'red ring': 'boss',
      'dots white/blue/yellow/orange': 'monsters by rarity', 'orange dot': 'hazard mechanic', 'gold dot': 'breakable / chest', 'cyan': 'other mechanic props',
      'room outlines': 'green start, red boss, gold treasure, cyan mechanic, grey combat', north: 'up (-z)',
    },
  };
}

const NODE_R: Record<TreeNode['kind'], number> = { start: 5, minor: 1.6, notable: 3.2, keystone: 4.6, skill: 3.4, skillmod: 2, socket: 3, mastery: 4 };

/** The passive tree; allocated nodes bright, the rest dimmed; `highlight` gets white rings. */
export function treeImage(allocated: readonly string[] = [], highlight: readonly string[] = [], size = 512): Img {
  const xs = TREE.nodes.map((n) => n.x), ys = TREE.nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const k = (size - 16) / span;
  const pos = (n: TreeNode) => ({ x: 8 + (n.x - minX) * k + ((span - (maxX - minX)) * k) / 2, y: 8 + (n.y - minY) * k + ((span - (maxY - minY)) * k) / 2 });
  const img = newImg(size, size, rgba('#0b0a10'));
  const on = new Set(allocated);
  on.add(TREE.start);
  const dim = (c: RGBA, f: number): RGBA => [c[0] * f, c[1] * f, c[2] * f, 255];
  for (const n of TREE.nodes)
    for (const id of n.links) {
      if (id < n.id) continue;
      const m = TREE.byId.get(id)!;
      const a = pos(n), b = pos(m);
      const lit = on.has(n.id) && on.has(m.id);
      line(img, a.x, a.y, b.x, b.y, lit ? rgba('#e8d8a0') : rgba('#2c2836'));
    }
  for (const n of TREE.nodes) {
    const p = pos(n);
    const col = rgba(SECTOR_COLOR[n.sector]);
    const r = Math.max(1, NODE_R[n.kind] * (size / 512));
    const c = on.has(n.id) ? col : dim(col, 0.32);
    if (n.kind === 'socket') ring(img, p.x, p.y, r, c);
    else if (n.kind === 'skill') {
      for (let d = -r; d <= r; d++) line(img, p.x - (r - Math.abs(d)), p.y + d, p.x + (r - Math.abs(d)), p.y + d, c);
    } else fillCircle(img, p.x, p.y, r, c);
    if (n.kind === 'keystone') ring(img, p.x, p.y, r + 1.5, on.has(n.id) ? rgba('#ffffff') : rgba('#5a5466'));
  }
  for (const id of highlight) {
    const n = TREE.byId.get(id);
    if (n) {
      const p = pos(n);
      ring(img, p.x, p.y, NODE_R[n.kind] * (size / 512) + 3, rgba('#ffffff'));
    }
  }
  return img;
}
