/**
 * Navigation over a 0.5 m grid: A* for single routes (moveTo, wanderers) and a Dijkstra flow
 * field from the hero that every monster reads, so a hundred monsters path for the price of one.
 * Obstacles are rasterized from wall boxes, crates and solid props, inflated by the clearance.
 */
import type { Level } from '../content/level';

export interface P2 {
  x: number;
  z: number;
}

export interface Rect {
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

/** Minimal binary heap of (index, priority). */
class Heap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.idx.length;
  }
  push(i: number, p: number) {
    const a = this.idx, b = this.pri;
    a.push(i);
    b.push(p);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (b[parent] <= b[k]) break;
      [a[parent], a[k]] = [a[k], a[parent]];
      [b[parent], b[k]] = [b[k], b[parent]];
      k = parent;
    }
  }
  pop(): number {
    const a = this.idx, b = this.pri;
    const top = a[0];
    const li = a.pop()!, lp = b.pop()!;
    if (a.length) {
      a[0] = li;
      b[0] = lp;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        [b[m], b[k]] = [b[k], b[m]];
        k = m;
      }
    }
    return top;
  }
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class NavGrid {
  readonly cell = 0.5;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  readonly blocked: Uint8Array;

  constructor(level: Level, readonly clearance = 0.4, extra: Rect[] = []) {
    this.originX = -level.width / 2;
    this.originZ = -level.depth / 2;
    this.cols = Math.round(level.width / this.cell);
    this.rows = Math.round(level.depth / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    // Border.
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const { x, z } = this.center(c, r);
        if (x < this.originX + clearance || x > -this.originX - clearance || z < this.originZ + clearance || z > -this.originZ - clearance) this.blocked[r * this.cols + c] = 1;
      }
    // Void tiles of generated levels are not walkable either.
    const g = level.grid;
    if (g) {
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          const { x, z } = this.center(c, r);
          const gc = Math.floor((x - g.originX) / g.cell), gr = Math.floor((z - g.originZ) / g.cell);
          const t = gc < 0 || gr < 0 || gc >= g.cols || gr >= g.rows ? ' ' : g.cells[gr * g.cols + gc];
          if (t === ' ') this.blocked[r * this.cols + c] = 1;
        }
    }
    for (const q of [...staticRects(level), ...extra]) this.blockRect(q, clearance, 1);
  }

  /** Marks (or clears, value 0) every cell whose center lies inside the rect grown by `pad`. */
  blockRect(q: Rect, pad: number, value: 0 | 1) {
    const c0 = Math.max(0, Math.floor((q.minX - pad - this.originX) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((q.maxX + pad - this.originX) / this.cell));
    const r0 = Math.max(0, Math.floor((q.minZ - pad - this.originZ) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((q.maxZ + pad - this.originZ) / this.cell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const { x, z } = this.center(c, r);
        if (x > q.minX - pad && x < q.maxX + pad && z > q.minZ - pad && z < q.maxZ + pad) this.blocked[r * this.cols + c] = value;
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

  index(p: P2): number {
    const [c, r] = this.cellOf(p);
    return r * this.cols + c;
  }

  isFree(p: P2): boolean {
    const [c, r] = this.cellOf(p);
    return !this.blocked[r * this.cols + c];
  }

  /** Nearest free cell center to p (ring search). */
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

  lineFree(a: P2, b: P2): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell * 0.4));
    for (let i = 1; i < n; i++) if (!this.isFree({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n })) return false;
    return true;
  }

  /** Farthest free point along a ray from `a` toward `b` (blink / dash targets). */
  clampLine(a: P2, b: P2): P2 {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / (this.cell * 0.4)));
    let last = a;
    for (let i = 1; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
      if (!this.isFree(p)) break;
      last = p;
    }
    return last;
  }

  /** Waypoints from `from` to `to` (excluding `from`), string-pulled. Empty if unreachable. */
  path(from: P2, to: P2, maxNodes = 20000): P2[] {
    const goal = this.nearestFree(to);
    if (this.lineFree(from, goal)) return [goal];
    const s = this.cellOf(this.nearestFree(from));
    const e = this.cellOf(goal);
    const N = this.cols * this.rows;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const start = s[1] * this.cols + s[0];
    const target = e[1] * this.cols + e[0];
    const h = (i: number) => Math.hypot((i % this.cols) - e[0], ((i / this.cols) | 0) - e[1]);
    const open = new Heap();
    g[start] = 0;
    open.push(start, h(start));
    let expanded = 0;
    while (open.size) {
      const cur = open.pop();
      if (closed[cur]) continue;
      if (cur === target) break;
      closed[cur] = 1;
      if (++expanded > maxNodes) return [];
      const cc = cur % this.cols, cr = (cur / this.cols) | 0;
      for (const [dc, dr, cost] of NEIGHBORS) {
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const ni = nr * this.cols + nc;
        if (this.blocked[ni] || closed[ni]) continue;
        if (dc && dr && (this.blocked[cr * this.cols + nc] || this.blocked[nr * this.cols + cc])) continue;
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          open.push(ni, ng + h(ni));
        }
      }
    }
    if (came[target] < 0 && target !== start) return [];
    const cells: P2[] = [];
    for (let i = target; i >= 0 && i !== start; i = came[i]) cells.unshift(this.center(i % this.cols, (i / this.cols) | 0));
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

/**
 * Distance field toward a target (Dijkstra, capped at maxDist meters). Monsters step toward the
 * neighbouring cell with the smallest distance; recomputed only when the target changes cell.
 */
export class FlowField {
  dist: Float32Array;
  targetIndex = -1;
  constructor(readonly nav: NavGrid, readonly maxDist = 45) {
    this.dist = new Float32Array(nav.cols * nav.rows).fill(Infinity);
  }

  update(target: P2, force = false): boolean {
    const nav = this.nav;
    const t = nav.nearestFree(target);
    const ti = nav.index(t);
    if (ti === this.targetIndex && !force) return false;
    this.targetIndex = ti;
    const d = this.dist.fill(Infinity);
    const heap = new Heap();
    d[ti] = 0;
    heap.push(ti, 0);
    const cap = this.maxDist / nav.cell;
    while (heap.size) {
      const cur = heap.pop();
      const cd = d[cur];
      if (cd > cap) continue;
      const cc = cur % nav.cols, cr = (cur / nav.cols) | 0;
      for (const [dc, dr, cost] of NEIGHBORS) {
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
        const ni = nr * nav.cols + nc;
        if (nav.blocked[ni]) continue;
        if (dc && dr && (nav.blocked[cr * nav.cols + nc] || nav.blocked[nr * nav.cols + cc])) continue;
        const nd = cd + cost;
        if (nd < d[ni]) {
          d[ni] = nd;
          heap.push(ni, nd);
        }
      }
    }
    return true;
  }

  /** Meters along the field from p to the target (Infinity if unreachable / out of range). */
  distanceAt(p: P2): number {
    return this.dist[this.nav.index(p)] * this.nav.cell;
  }

  /** Unit direction downhill from p (toward the target), or null if unreachable. */
  direction(p: P2): P2 | null {
    const nav = this.nav;
    const [c, r] = nav.cellOf(p);
    const here = this.dist[r * nav.cols + c];
    let best = here, bc = -1, br = -1;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
      if (dc && dr && (nav.blocked[r * nav.cols + nc] || nav.blocked[nr * nav.cols + c])) continue;
      const v = this.dist[nr * nav.cols + nc];
      if (v < best) {
        best = v;
        bc = nc;
        br = nr;
      }
    }
    if (bc < 0) return null;
    const tgt = nav.center(bc, br);
    const dx = tgt.x - p.x, dz = tgt.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }
}
