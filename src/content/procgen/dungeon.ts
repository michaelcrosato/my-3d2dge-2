/**
 * Procedural dungeon layouts -> Level data. Deterministic for a spec (same seed, same dungeon).
 *
 * Steps: carve rooms (rectangles or noisy cave blobs) on a 1 m tile grid, connect them with a
 * minimum spanning tree plus a few loops, pick start and boss rooms by path distance, derive
 * walls from the floor (iso-aware heights: back walls tall, walls that would hide floor are
 * low), merge wall tiles into boxes, then place torches, decor, breakables, monster packs, the
 * boss and the exit. Mechanics (content/mechanics.ts) get the room list to place their props.
 */
import { Rng } from '../../sim/rng';
import { ensureMonster } from '../monsters';
import { theme } from '../themes';
import type { CharacterDef, Level, LevelGrid, LightDef, PropDef, RoomInfo, WallDef } from '../level';
import { rollPack, type EncounterPool } from './encounters';

export interface DungeonSpec {
  seed: number;
  name: string;
  title: string;
  subtitle?: string;
  theme: string;
  layout: 'rooms' | 'caves' | 'halls';
  cols: number;
  rows: number;
  rooms: number;
  monsterLevel: number;
  /** Packs per 100 m² of room floor. */
  density: number;
  pool: EncounterPool;
  boss: { def: string; palette?: string; name?: string; seed?: number } | null;
  mechanics: string[];
  stage?: number;
}

const VOID = ' ', FLOOR = '.', WALL = '#';
export const TALL_WALL = 2.6;
export const LOW_WALL = 0.55;

interface Rect { x: number; z: number; w: number; h: number }

class Grid {
  cells: string[];
  constructor(readonly cols: number, readonly rows: number) {
    this.cells = new Array(cols * rows).fill(VOID);
  }
  get(c: number, r: number) {
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? VOID : this.cells[r * this.cols + c];
  }
  set(c: number, r: number, v: string) {
    if (c < 1 || r < 1 || c >= this.cols - 1 || r >= this.rows - 1) return;
    this.cells[r * this.cols + c] = v;
  }
  isFloor(c: number, r: number) {
    return this.get(c, r) === FLOOR;
  }
}

function overlaps(a: Rect, b: Rect, margin: number) {
  return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.z - margin < b.z + b.h && a.z + a.h + margin > b.z;
}

const center = (r: Rect) => ({ c: Math.floor(r.x + r.w / 2), r: Math.floor(r.z + r.h / 2) });

function carveRoom(g: Grid, r: Rect, cave: boolean, rng: Rng) {
  for (let z = r.z; z < r.z + r.h; z++)
    for (let x = r.x; x < r.x + r.w; x++) {
      if (cave) {
        // Ellipse with a noisy rim: organic cave chambers.
        const nx = (x + 0.5 - (r.x + r.w / 2)) / (r.w / 2), nz = (z + 0.5 - (r.z + r.h / 2)) / (r.h / 2);
        const d = nx * nx + nz * nz;
        if (d > 1.05 || (d > 0.72 && rng.chance(0.45))) continue;
      }
      g.set(x, z, FLOOR);
    }
}

function carveCorridor(g: Grid, a: { c: number; r: number }, b: { c: number; r: number }, width: number, rng: Rng, wiggle: boolean) {
  const half = Math.floor(width / 2);
  const dig = (c: number, r: number) => {
    for (let dz = -half; dz <= width - 1 - half; dz++) for (let dx = -half; dx <= width - 1 - half; dx++) g.set(c + dx, r + dz, FLOOR);
  };
  let c = a.c, r = a.r;
  const stepTo = (tc: number, tr: number) => {
    while (c !== tc || r !== tr) {
      if (c !== tc) c += Math.sign(tc - c);
      else r += Math.sign(tr - r);
      if (wiggle && rng.chance(0.18)) {
        // Cave tunnels wander a little.
        if (rng.chance(0.5)) c += rng.chance(0.5) ? 1 : -1;
        else r += rng.chance(0.5) ? 1 : -1;
        c = Math.max(2, Math.min(g.cols - 3, c));
        r = Math.max(2, Math.min(g.rows - 3, r));
      }
      dig(c, r);
    }
  };
  dig(c, r);
  if (rng.chance(0.5)) {
    stepTo(b.c, r);
    stepTo(b.c, b.r);
  } else {
    stepTo(c, b.r);
    stepTo(b.c, b.r);
  }
}

/** Breadth-first tile distances from a start tile over floor. */
function floodDistance(g: Grid, start: { c: number; r: number }): Int32Array {
  const dist = new Int32Array(g.cols * g.rows).fill(-1);
  const q: number[] = [start.r * g.cols + start.c];
  dist[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    const c = cur % g.cols, r = (cur / g.cols) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (!g.isFloor(nc, nr)) continue;
      const ni = nr * g.cols + nc;
      if (dist[ni] >= 0) continue;
      dist[ni] = dist[cur] + 1;
      q.push(ni);
    }
  }
  return dist;
}

/** Floor tiles not reachable from `start` become void, so the level is one connected piece. */
function pruneUnreachable(g: Grid, start: { c: number; r: number }) {
  const dist = floodDistance(g, start);
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && dist[i] < 0) g.cells[i] = VOID;
}

function addWalls(g: Grid) {
  const out = g.cells.slice();
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      if (g.get(c, r) !== VOID) continue;
      let near = false;
      for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1; dc++) if (g.isFloor(c + dc, r + dr)) near = true;
      if (near) out[r * g.cols + c] = WALL;
    }
  g.cells = out;
}

/**
 * A wall tile hides floor that lies behind it from the camera (toward -X/-Z). If any floor tile
 * sits on its -X/-Z side the wall is cut low; otherwise it is a tall back wall.
 */
export function wallHeight(grid: LevelGrid, c: number, r: number): number {
  const at = (cc: number, rr: number) => (cc < 0 || rr < 0 || cc >= grid.cols || rr >= grid.rows ? ' ' : grid.cells[rr * grid.cols + cc]);
  const hides = at(c - 1, r) === '.' || at(c, r - 1) === '.' || at(c - 1, r - 1) === '.';
  return hides ? LOW_WALL : TALL_WALL;
}

/** Greedy merge of same-height wall tiles into boxes (few colliders, one merged mesh). */
export function wallBoxes(grid: LevelGrid, colorFor?: (c: number, r: number) => string | undefined): WallDef[] {
  const used = new Uint8Array(grid.cols * grid.rows);
  const heights = new Float32Array(grid.cols * grid.rows);
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) if (grid.cells[r * grid.cols + c] === '#') heights[r * grid.cols + c] = wallHeight(grid, c, r);
  const walls: WallDef[] = [];
  const isWall = (c: number, r: number, h: number) => c < grid.cols && r < grid.rows && !used[r * grid.cols + c] && grid.cells[r * grid.cols + c] === '#' && heights[r * grid.cols + c] === h;
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      const h = heights[r * grid.cols + c];
      if (!isWall(c, r, h)) continue;
      let w = 1;
      while (isWall(c + w, r, h)) w++;
      let d = 1;
      grow: while (r + d < grid.rows) {
        for (let k = 0; k < w; k++) if (!isWall(c + k, r + d, h)) break grow;
        d++;
      }
      for (let dr = 0; dr < d; dr++) for (let k = 0; k < w; k++) used[(r + dr) * grid.cols + c + k] = 1;
      const x0 = grid.originX + c * grid.cell, z0 = grid.originZ + r * grid.cell;
      const x1 = x0 + w * grid.cell, z1 = z0 + d * grid.cell;
      // WallDef is a centerline + thickness; pick the long axis.
      const along = x1 - x0 >= z1 - z0;
      const t = along ? z1 - z0 : x1 - x0;
      const wall: WallDef = along
        ? { id: `w${walls.length}`, from: [x0 + t / 2, (z0 + z1) / 2], to: [x1 - t / 2, (z0 + z1) / 2], height: h, thickness: t }
        : { id: `w${walls.length}`, from: [(x0 + x1) / 2, z0 + t / 2], to: [(x0 + x1) / 2, z1 - t / 2], height: h, thickness: t };
      const color = colorFor?.(c, r);
      if (color) wall.color = color;
      walls.push(wall);
    }
  return walls;
}

export function generateDungeon(spec: DungeonSpec): Level {
  const rng = new Rng(spec.seed);
  const th = theme(spec.theme);
  const g = new Grid(spec.cols, spec.rows);
  const cave = spec.layout === 'caves';
  const rects: Rect[] = [];
  // Rooms: the last placed big room becomes the boss arena candidate.
  for (let tries = 0; tries < 900 && rects.length < spec.rooms; tries++) {
    const big = rects.length === 0 || rng.chance(0.2);
    const w = big ? rng.int(13, 17) : rng.int(7, spec.layout === 'halls' ? 18 : 13);
    const h = big ? rng.int(12, 16) : rng.int(7, spec.layout === 'halls' ? 9 : 12);
    const r: Rect = { x: rng.int(3, spec.cols - w - 3), z: rng.int(3, spec.rows - h - 3), w, h };
    if (rects.some((o) => overlaps(o, r, 3))) continue;
    rects.push(r);
  }
  for (const r of rects) carveRoom(g, r, cave, rng);
  // Minimum spanning tree over room centers (Prim), plus ~25% extra edges for loops.
  const inTree = new Set([0]);
  const edges: Array<[number, number]> = [];
  while (inTree.size < rects.length) {
    let best: [number, number] | null = null, bestD = Infinity;
    for (const i of inTree)
      for (let j = 0; j < rects.length; j++) {
        if (inTree.has(j)) continue;
        const a = center(rects[i]), b = center(rects[j]);
        const d = Math.hypot(a.c - b.c, a.r - b.r);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    if (!best) break;
    inTree.add(best[1]);
    edges.push(best);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      if (edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
      const a = center(rects[i]), b = center(rects[j]);
      if (Math.hypot(a.c - b.c, a.r - b.r) < 22 && rng.chance(0.25)) edges.push([i, j]);
    }
  for (const [a, b] of edges) carveCorridor(g, center(rects[a]), center(rects[b]), spec.layout === 'halls' ? 4 : 3, rng, cave);

  // Start: the room nearest the bottom of the screen (+X+Z); boss: farthest by walking distance.
  let startIdx = 0;
  rects.forEach((r, i) => {
    const c = center(r), s = center(rects[startIdx]);
    if (c.c + c.r > s.c + s.r) startIdx = i;
  });
  const start = center(rects[startIdx]);
  pruneUnreachable(g, start);
  const dist = floodDistance(g, start);
  let bossIdx = startIdx, bossD = -1;
  rects.forEach((r, i) => {
    const c = center(r);
    const d = dist[c.r * g.cols + c.c];
    if (d > bossD) {
      bossD = d;
      bossIdx = i;
    }
  });

  // Pillars in big combat rooms (tall; the wall cutaway keeps the hero visible behind them).
  rects.forEach((r, i) => {
    if (i === startIdx || r.w < 11 || r.h < 11 || cave) return;
    const inset = 3;
    const spots = [[r.x + inset, r.z + inset], [r.x + r.w - 1 - inset, r.z + inset], [r.x + inset, r.z + r.h - 1 - inset], [r.x + r.w - 1 - inset, r.z + r.h - 1 - inset]];
    if (i === bossIdx && rng.chance(0.5)) return;
    for (const [c, rr] of spots) if (g.isFloor(c, rr) && rng.chance(0.75)) g.set(c, rr, WALL);
  });
  addWalls(g);

  const cell = 1;
  const originX = -(spec.cols * cell) / 2, originZ = -(spec.rows * cell) / 2;
  const grid: LevelGrid = { cols: g.cols, rows: g.rows, cell, originX, originZ, cells: g.cells.join('') };
  const pos = (c: number, r: number) => ({ x: originX + (c + 0.5) * cell, z: originZ + (r + 0.5) * cell });
  const trim = th.wall.trim;
  const walls = wallBoxes(grid, (c, r) => ((c * 7 + r * 13) % 11 === 0 ? trim : undefined));

  const rooms: RoomInfo[] = rects.map((r, i) => ({
    id: i, x: originX + r.x * cell, z: originZ + r.z * cell, w: r.w * cell, h: r.h * cell,
    kind: i === startIdx ? 'start' : i === bossIdx ? 'boss' : 'combat',
  }));
  // Rooms not on the start->boss path more often hold treasure.
  rooms.forEach((rm) => {
    if (rm.kind === 'combat' && rng.chance(0.18)) rm.kind = 'treasure';
  });

  const props: PropDef[] = [];
  const lights: LightDef[] = [];
  const occupied = new Set<number>();
  const free = (c: number, r: number) => g.isFloor(c, r) && !occupied.has(r * g.cols + c);
  const take = (c: number, r: number) => occupied.add(r * g.cols + c);

  // Torches on tall back walls facing floor, spaced out.
  let torchGap = 0;
  for (let r = 1; r < g.rows - 1; r++)
    for (let c = 1; c < g.cols - 1; c++) {
      if (g.get(c, r) !== WALL || wallHeight(grid, c, r) !== TALL_WALL) continue;
      // Face direction: toward the floor neighbour on +X or +Z.
      const facePX = g.isFloor(c + 1, r), facePZ = g.isFloor(c, r + 1);
      if (!facePX && !facePZ) continue;
      if (++torchGap % 9 !== 0 && !rng.chance(0.02)) continue;
      const p = pos(c, r);
      const x = p.x + (facePX ? 0.55 : 0), z = p.z + (facePZ ? 0.55 : 0);
      props.push({ id: `torch${props.length}`, kind: 'torch', x, z, y: 1.7, yawDeg: facePX ? 90 : 0 });
      lights.push({ x: x + (facePX ? 0.3 : 0), y: 1.9, z: z + (facePZ ? 0.3 : 0), color: th.torch, intensity: 2.2, range: 7, flicker: 0.25 });
    }

  // Decor scattered on floor (render-only), denser near walls.
  for (let r = 1; r < g.rows - 1; r++)
    for (let c = 1; c < g.cols - 1; c++) {
      if (!g.isFloor(c, r)) continue;
      let wallsNear = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.get(c + dc, r + dr) === WALL) wallsNear++;
      if (!rng.chance(wallsNear ? 0.09 : 0.012)) continue;
      const p = pos(c, r);
      props.push({ id: `decor${props.length}`, kind: `decor:${rng.pick(th.decor)}`, x: p.x + rng.range(-0.3, 0.3), z: p.z + rng.range(-0.3, 0.3), yawDeg: rng.int(0, 7) * 45, scale: rng.range(0.8, 1.2) });
    }

  // Breakable clusters in room corners.
  for (const rm of rooms) {
    if (!th.breakables.length || rm.kind === 'start') continue;
    const clusters = rm.kind === 'treasure' ? 3 : rng.int(0, 2);
    for (let k = 0; k < clusters; k++) {
      const cx = Math.floor((rm.x - originX) / cell) + (rng.chance(0.5) ? 1 : Math.floor(rm.w / cell) - 2);
      const cz = Math.floor((rm.z - originZ) / cell) + (rng.chance(0.5) ? 1 : Math.floor(rm.h / cell) - 2);
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const c = cx + rng.int(-1, 1), r = cz + rng.int(-1, 1);
        if (!free(c, r)) continue;
        take(c, r);
        const p = pos(c, r);
        props.push({ id: `brk${props.length}`, kind: rng.pick(th.breakables), x: p.x + rng.range(-0.15, 0.15), z: p.z + rng.range(-0.15, 0.15), yawDeg: rng.int(0, 3) * 90 });
      }
    }
    if (rm.kind === 'treasure') {
      const c = Math.floor((rm.x - originX + rm.w / 2) / cell), r = Math.floor((rm.z - originZ + rm.h / 2) / cell);
      if (free(c, r)) {
        take(c, r);
        const p = pos(c, r);
        props.push({ id: `chest${props.length}`, kind: 'chest', x: p.x, z: p.z, yawDeg: 45 });
      }
    }
  }

  // Monsters.
  const characters: CharacterDef[] = [];
  const startPos = pos(start.c, start.r);
  characters.push({ id: 'player', preset: 'ranger', x: startPos.x, z: startPos.z, yawDeg: 225, brain: 'input', team: 'hero' });
  for (const c of [start.c, start.c + 1, start.c - 1]) for (const r of [start.r, start.r + 1, start.r - 1]) take(c, r);
  let packN = 0;
  const randomFloorIn = (rm: RoomInfo, margin: number): { c: number; r: number } | null => {
    for (let t = 0; t < 30; t++) {
      const c = Math.floor((rm.x - originX) / cell) + rng.int(margin, Math.max(margin, Math.floor(rm.w / cell) - 1 - margin));
      const r = Math.floor((rm.z - originZ) / cell) + rng.int(margin, Math.max(margin, Math.floor(rm.h / cell) - 1 - margin));
      if (free(c, r)) return { c, r };
    }
    return null;
  };
  const placePack = (rm: RoomInfo) => {
    const at = randomFloorIn(rm, 2);
    if (!at) return;
    const pack = rollPack(rng, spec.pool, spec.monsterLevel, `p${packN++}`);
    pack.forEach((m, i) => {
      let c = at.c, r = at.r;
      for (let t = 0; t < 12 && (i > 0 || !free(c, r)); t++) {
        c = at.c + rng.int(-2, 2);
        r = at.r + rng.int(-2, 2);
        if (free(c, r)) break;
      }
      if (!free(c, r)) return;
      take(c, r);
      const p = pos(c, r);
      const def = ensureMonster(m.def);
      characters.push({
        id: `m${characters.length}`, preset: def.body.kind === 'humanoid' ? def.body.preset : 'creature',
        x: p.x + rng.range(-0.2, 0.2), z: p.z + rng.range(-0.2, 0.2), yawDeg: rng.int(0, 7) * 45, brain: 'monster', team: 'enemy', monster: m,
      });
    });
  };
  for (const rm of rooms) {
    if (rm.kind === 'start' || rm.kind === 'boss') continue;
    const area = rm.w * rm.h;
    const packs = Math.max(1, Math.round((area / 100) * spec.density * rng.range(0.75, 1.3)));
    for (let k = 0; k < packs; k++) placePack(rm);
  }
  // Boss arena: a pack of guards plus the boss.
  const bossRoom = rooms[bossIdx];
  const bossC = Math.floor((bossRoom.x - originX + bossRoom.w / 2) / cell), bossR = Math.floor((bossRoom.z - originZ + bossRoom.h / 2) / cell);
  if (spec.boss) {
    const def = ensureMonster(spec.boss.def);
    const p = pos(bossC, bossR);
    take(bossC, bossR);
    characters.push({
      id: 'boss', preset: def.body.kind === 'humanoid' ? def.body.preset : 'creature', x: p.x, z: p.z, yawDeg: 45, brain: 'monster', team: 'enemy',
      monster: { def: spec.boss.def, level: spec.monsterLevel + 1, rarity: 'unique', palette: spec.boss.palette ?? def.palette, name: spec.boss.name, seed: spec.boss.seed, pack: 'boss' },
    });
  }
  const exitPos = pos(bossC, Math.min(g.rows - 3, bossR + 3));

  const level: Level = {
    name: spec.name,
    title: spec.title,
    subtitle: spec.subtitle,
    kind: 'dungeon',
    theme: th.id,
    seed: spec.seed,
    stage: spec.stage,
    width: spec.cols * cell,
    depth: spec.rows * cell,
    floor: { colorA: th.floor.base, colorB: th.floor.alt, tile: 1 },
    wallColor: th.wall.side,
    wallTopColor: th.wall.top,
    background: th.background,
    sun: { azimuthDeg: th.sun.azimuthDeg, elevationDeg: th.sun.elevationDeg },
    walls,
    crates: [],
    characters,
    grid,
    props,
    lights,
    rooms,
    start: { x: startPos.x, z: startPos.z, yawDeg: 225 },
    exit: exitPos,
    mechanics: spec.mechanics,
    monsterLevel: spec.monsterLevel,
  };
  return level;
}

/** Floor tile centers inside a room (mechanic placement helper). */
export function roomTiles(level: Level, room: RoomInfo, margin = 1): Array<{ x: number; z: number; c: number; r: number }> {
  const g = level.grid;
  if (!g) return [];
  const out: Array<{ x: number; z: number; c: number; r: number }> = [];
  const c0 = Math.floor((room.x - g.originX) / g.cell), r0 = Math.floor((room.z - g.originZ) / g.cell);
  for (let r = r0 + margin; r < r0 + Math.floor(room.h / g.cell) - margin; r++)
    for (let c = c0 + margin; c < c0 + Math.floor(room.w / g.cell) - margin; c++)
      if (g.cells[r * g.cols + c] === '.') out.push({ x: g.originX + (c + 0.5) * g.cell, z: g.originZ + (r + 0.5) * g.cell, c, r });
  return out;
}
