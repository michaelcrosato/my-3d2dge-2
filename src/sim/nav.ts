/** Grid A* over the level's static obstacles, so `moveTo` and wandering NPCs route around walls. */
import type { Level } from '../content/level';

export interface P2 {
  x: number;
  z: number;
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function staticRects(level: Level): Rect[] {
  const rects: Rect[] = [];
  for (const w of level.walls) {
    const t = (w.thickness ?? 0.4) / 2;
    rects.push({
      minX: Math.min(w.from[0], w.to[0]) - t,
      maxX: Math.max(w.from[0], w.to[0]) + t,
      minZ: Math.min(w.from[1], w.to[1]) - t,
      maxZ: Math.max(w.from[1], w.to[1]) + t,
    });
  }
  for (const c of level.crates) {
    if (c.pushable || (c.y ?? 0) > 0.5) continue;
    const h = (c.size ?? 1) / 2;
    rects.push({ minX: c.x - h, maxX: c.x + h, minZ: c.z - h, maxZ: c.z + h });
  }
  return rects;
}

export class NavGrid {
  readonly cell = 0.5;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  readonly blocked: Uint8Array;

  constructor(level: Level, clearance = 0.4) {
    this.originX = -level.width / 2;
    this.originZ = -level.depth / 2;
    this.cols = Math.round(level.width / this.cell);
    this.rows = Math.round(level.depth / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    const rects = staticRects(level);
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const { x, z } = this.center(c, r);
        const near =
          x < this.originX + clearance || x > -this.originX - clearance ||
          z < this.originZ + clearance || z > -this.originZ - clearance ||
          rects.some((q) => x > q.minX - clearance && x < q.maxX + clearance && z > q.minZ - clearance && z < q.maxZ + clearance);
        this.blocked[r * this.cols + c] = near ? 1 : 0;
      }
  }

  center(c: number, r: number): P2 {
    return { x: this.originX + (c + 0.5) * this.cell, z: this.originZ + (r + 0.5) * this.cell };
  }

  cellOf(p: P2): [number, number] {
    return [
      Math.min(this.cols - 1, Math.max(0, Math.floor((p.x - this.originX) / this.cell))),
      Math.min(this.rows - 1, Math.max(0, Math.floor((p.z - this.originZ) / this.cell))),
    ];
  }

  isFree(p: P2): boolean {
    const [c, r] = this.cellOf(p);
    return !this.blocked[r * this.cols + c];
  }

  /** Nearest free cell center to p (breadth-first). */
  nearestFree(p: P2): P2 {
    if (this.isFree(p)) return p;
    const [c0, r0] = this.cellOf(p);
    for (let rad = 1; rad < Math.max(this.cols, this.rows); rad++)
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c >= 0 && r >= 0 && c < this.cols && r < this.rows && !this.blocked[r * this.cols + c]) return this.center(c, r);
        }
    return p;
  }

  private lineFree(a: P2, b: P2): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell * 0.4));
    for (let i = 1; i < n; i++) if (!this.isFree({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n })) return false;
    return true;
  }

  /** Waypoints from `from` to `to` (excluding `from`), string-pulled. Empty if unreachable. */
  path(from: P2, to: P2): P2[] {
    const goal = this.nearestFree(to);
    if (this.lineFree(from, goal)) return [goal];
    const start = this.cellOf(this.nearestFree(from));
    const end = this.cellOf(goal);
    const N = this.cols * this.rows;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const idx = (c: number, r: number) => r * this.cols + c;
    const h = (c: number, r: number) => Math.hypot(c - end[0], r - end[1]);
    const open: number[] = [idx(start[0], start[1])];
    g[open[0]] = 0;
    const f = new Float32Array(N).fill(Infinity);
    f[open[0]] = h(start[0], start[1]);
    const target = idx(end[0], end[1]);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === target) break;
      closed[cur] = 1;
      const cc = cur % this.cols, cr = (cur / this.cols) | 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc, nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const ni = idx(nc, nr);
          if (this.blocked[ni] || closed[ni]) continue;
          if (dc && dr && (this.blocked[idx(cc + dc, cr)] || this.blocked[idx(cc, cr + dr)])) continue;
          const ng = g[cur] + (dc && dr ? Math.SQRT2 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            f[ni] = ng + h(nc, nr);
            came[ni] = cur;
            if (!open.includes(ni)) open.push(ni);
          }
        }
    }
    if (came[target] < 0 && target !== idx(start[0], start[1])) return [];
    const cells: P2[] = [];
    for (let i = target; i >= 0 && i !== idx(start[0], start[1]); i = came[i]) cells.unshift(this.center(i % this.cols, (i / this.cols) | 0));
    if (!cells.length) return [goal];
    cells[cells.length - 1] = goal;
    const out: P2[] = [];
    let anchor = from;
    for (let i = 0; i < cells.length; i++) {
      const next = cells[i + 1];
      if (!next || !this.lineFree(anchor, next)) {
        out.push(cells[i]);
        anchor = cells[i];
      }
    }
    return out;
  }
}
