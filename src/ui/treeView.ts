/**
 * The passive tree as an interactive canvas: drag to pan, wheel or pinch to zoom, tap/click a
 * node to inspect it, allocate the shortest path to it (cost shown before you commit), refund,
 * and search ("fire", "life", "keystone") to light up matching nodes. Nodes are drawn as crisp
 * pixel shapes: small circles for minors, big rings for notables, diamonds for keystones,
 * hexagons for jewel sockets, square badges with the skill icon for skill nodes.
 */
import { describeMod } from '../content/stats';
import { SKILL_NAMES } from '../content/skills';
import { pathTo, SECTOR_COLOR, SECTOR_NAME, TREE, type TreeNode } from '../content/tree';
import { treePoints, type Hero } from '../sim/hero';
import { allocate, refund, refundCost } from '../sim/heroOps';
import { h } from './dom';
import { skillIcon } from './skillIcons';

export class TreeView {
  readonly el: HTMLElement;
  private canvas = h('canvas');
  private info = h('div', { class: 'tinfo' });
  private search = h('input', { type: 'search', placeholder: 'Search nodes (fire, life, keystone…)', 'aria-label': 'Search the passive tree' });
  private points = h('span', { class: 'note' });
  private scale = 0.42;
  private ox = 0;
  private oy = 0;
  private selected: TreeNode | null = null;
  private hover: TreeNode | null = null;
  private matches = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private dragDist = 0;
  private raf = 0;

  constructor(private hero: () => Hero, private changed: () => void, private toast: (t: string) => void) {
    this.search.addEventListener('input', () => {
      const q = this.search.value.trim().toLowerCase();
      this.matches.clear();
      if (q.length >= 2) for (const n of TREE.nodes) {
        const text = `${n.name} ${n.kind} ${n.desc ?? ''} ${n.skill ?? ''} ${n.mods.map((m) => describeMod(m, SKILL_NAMES)).join(' ')}`.toLowerCase();
        if (text.includes(q)) this.matches.add(n.id);
      }
      this.draw();
    });
    this.el = h('div', { class: 'treebox' },
      h('div', { class: 'tbar' }, this.search, this.points,
        h('button', { class: 'ui-btn small', onclick: () => this.zoom(1.25) }, '+'),
        h('button', { class: 'ui-btn small', onclick: () => this.zoom(0.8) }, '−'),
        h('button', { class: 'ui-btn small', onclick: () => this.center() }, 'Center')),
      this.canvas, this.info);
    this.bindPointer();
  }

  mount() {
    this.center();
    const loop = () => {
      if (!this.el.isConnected) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
    this.renderInfo();
  }

  center() {
    const hero = this.hero();
    // Center on the allocated nodes (or the origin for a fresh hero).
    let x = 0, y = 0;
    const ids = hero.tree.length ? hero.tree : [TREE.start];
    for (const id of ids) {
      const n = TREE.byId.get(id)!;
      x += n.x;
      y += n.y;
    }
    this.ox = -x / ids.length;
    this.oy = -y / ids.length;
    this.draw();
  }

  private zoom(k: number, cx?: number, cy?: number) {
    const r = this.canvas.getBoundingClientRect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    const wx = (px - r.width / 2) / this.scale - this.ox, wy = (py - r.height / 2) / this.scale - this.oy;
    this.scale = Math.min(2.5, Math.max(0.12, this.scale * k));
    this.ox = (px - r.width / 2) / this.scale - wx;
    this.oy = (py - r.height / 2) / this.scale - wy;
  }

  private toWorld(px: number, py: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (px - r.left - r.width / 2) / this.scale - this.ox, y: (py - r.top - r.height / 2) / this.scale - this.oy };
  }

  private nodeAt(px: number, py: number): TreeNode | null {
    const w = this.toWorld(px, py);
    let best: TreeNode | null = null, bd = Infinity;
    for (const n of TREE.nodes) {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      const r = radius(n) + 8 / this.scale;
      if (d < r && d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  private bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragDist = 0;
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') {
          const n = this.nodeAt(e.clientX, e.clientY);
          if (n !== this.hover) {
            this.hover = n;
            this.renderInfo();
          }
        }
        return;
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...this.pointers.values()];
        const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (before > 0) this.zoom(after / before, (a2.x + b2.x) / 2 - c.getBoundingClientRect().left, (a2.y + b2.y) / 2 - c.getBoundingClientRect().top);
        return;
      }
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      this.ox += dx / this.scale;
      this.oy += dy / this.scale;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const up = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      const multi = this.pointers.size > 1;
      this.pointers.delete(e.pointerId);
      if (multi || this.dragDist > 8) return;
      const n = this.nodeAt(e.clientX, e.clientY);
      if (n && this.selected === n && e.pointerType !== 'mouse') this.allocate(n);
      this.selected = n;
      this.renderInfo();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('dblclick', (e) => {
      const n = this.nodeAt(e.clientX, e.clientY);
      if (n) this.allocate(n);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoom(e.deltaY < 0 ? 1.15 : 0.87, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  private allocate(n: TreeNode) {
    const err = allocate(this.hero(), n.id);
    if (err) this.toast(err);
    else this.changed();
    this.renderInfo();
  }

  private renderInfo() {
    const hero = this.hero();
    const pts = treePoints(hero);
    this.points.textContent = `${pts} point${pts === 1 ? '' : 's'} · ${hero.tree.length} allocated`;
    const n = this.selected ?? this.hover;
    if (!n) {
      this.info.replaceChildren();
      return;
    }
    const allocated = hero.tree.includes(n.id);
    const count = hero.tree.filter((x) => x === n.id).length;
    const path = pathTo(new Set(hero.tree), n.id);
    const lines = n.mods.map((m) => h('div', { class: 'affix' }, describeMod(m, SKILL_NAMES)));
    this.info.replaceChildren(h('div', { class: 'tip' },
      h('div', { class: 'name', style: { color: SECTOR_COLOR[n.sector] } }, n.kind === 'skill' ? `Skill: ${SKILL_NAMES[n.skill!] ?? n.skill}` : n.name),
      h('div', { class: 'base' }, `${n.kind === 'skillmod' ? 'Skill enhancement' : n.kind[0].toUpperCase() + n.kind.slice(1)} · ${SECTOR_NAME[n.sector]}${n.repeatable ? ` · rank ${count}` : ''}`),
      n.desc ? h('div', { class: 'implicit' }, n.desc) : null,
      ...lines,
      n.skill ? h('div', { class: 'unique' }, 'Unlocks the active skill. Assign it in the Character panel (C).') : null,
      h('div', { class: 'actions' },
        (!allocated || n.repeatable) && path.length ? h('button', { class: 'ui-btn small primary', onclick: () => this.allocate(n) }, `Allocate (${path.length} pt${path.length === 1 ? '' : 's'})`) : null,
        allocated && n.kind !== 'start' ? h('button', { class: 'ui-btn small', onclick: () => {
          const err = refund(hero, n.id);
          if (err) this.toast(err);
          else this.changed();
          this.renderInfo();
        } }, `Refund (${refundCost(hero)}g)`) : null,
        h('button', { class: 'ui-btn small', onclick: () => { this.selected = null; this.renderInfo(); } }, 'Close')),
    ));
  }

  private draw() {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0a0910';
    g.fillRect(0, 0, W, H);
    const s = this.scale * dpr;
    g.setTransform(s, 0, 0, s, W / 2 + this.ox * s, H / 2 + this.oy * s);
    g.imageSmoothingEnabled = false;
    const hero = this.hero();
    const alloc = new Set(hero.tree);
    alloc.add(TREE.start);
    const reachable = new Set<string>();
    for (const id of alloc) for (const l of TREE.byId.get(id)?.links ?? []) if (!alloc.has(l)) reachable.add(l);
    const path = this.selected ? new Set(pathTo(new Set(hero.tree), this.selected.id)) : new Set<string>();
    // Links.
    g.lineWidth = 3 / Math.max(0.6, this.scale);
    for (const n of TREE.nodes)
      for (const l of n.links) {
        if (l < n.id) continue;
        const m = TREE.byId.get(l)!;
        const on = alloc.has(n.id) && alloc.has(l);
        const planned = (path.has(n.id) || alloc.has(n.id)) && (path.has(l) || alloc.has(l)) && (path.has(n.id) || path.has(l));
        g.strokeStyle = on ? '#e8c060' : planned ? '#7ab8ff' : '#3a3448';
        g.beginPath();
        g.moveTo(n.x, n.y);
        g.lineTo(m.x, m.y);
        g.stroke();
      }
    // Nodes.
    const t = performance.now() / 300;
    const labels: Array<{ text: string; x: number; y: number; pri: number; color: string }> = [];
    for (const n of TREE.nodes) {
      const rad = radius(n);
      const on = alloc.has(n.id);
      const color = SECTOR_COLOR[n.sector];
      const match = this.matches.has(n.id);
      g.fillStyle = on ? color : reachable.has(n.id) ? '#2a2638' : '#16141e';
      g.strokeStyle = on ? '#ffe9a0' : path.has(n.id) ? '#7ab8ff' : reachable.has(n.id) ? color : '#4a4560';
      g.lineWidth = (on ? 4 : 2.5) / Math.max(0.6, this.scale);
      g.beginPath();
      if (n.kind === 'keystone') {
        g.moveTo(n.x, n.y - rad);
        g.lineTo(n.x + rad, n.y);
        g.lineTo(n.x, n.y + rad);
        g.lineTo(n.x - rad, n.y);
        g.closePath();
      } else if (n.kind === 'socket' || n.kind === 'mastery') {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          if (i) g.lineTo(n.x + Math.cos(a) * rad, n.y + Math.sin(a) * rad);
          else g.moveTo(n.x + Math.cos(a) * rad, n.y + Math.sin(a) * rad);
        }
        g.closePath();
      } else if (n.kind === 'skill') g.rect(n.x - rad, n.y - rad, rad * 2, rad * 2);
      else g.arc(n.x, n.y, rad, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (n.kind === 'skill' && n.skill) g.drawImage(skillIcon(n.skill), n.x - rad * 0.8, n.y - rad * 0.8, rad * 1.6, rad * 1.6);
      if (n.kind === 'socket' && hero.jewels[n.id]) {
        g.fillStyle = '#3a6aff';
        g.beginPath();
        g.arc(n.x, n.y, rad * 0.5, 0, Math.PI * 2);
        g.fill();
      }
      if (match) {
        g.strokeStyle = `rgba(255,240,120,${0.5 + 0.5 * Math.sin(t)})`;
        g.lineWidth = 4 / Math.max(0.5, this.scale);
        g.beginPath();
        g.arc(n.x, n.y, rad + 8, 0, Math.PI * 2);
        g.stroke();
      }
      if (n === this.selected || n === this.hover) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2 / Math.max(0.5, this.scale);
        g.beginPath();
        g.arc(n.x, n.y, rad + 5, 0, Math.PI * 2);
        g.stroke();
      }
      if ((n.kind === 'notable' || n.kind === 'keystone' || n.kind === 'skill') && this.scale > 0.35) {
        const pri = n === this.selected || n === this.hover ? 5 : on ? 4 : n.kind === 'keystone' ? 3 : n.kind === 'skill' ? 2 : 1;
        labels.push({ text: n.kind === 'skill' ? SKILL_NAMES[n.skill!] ?? n.name : n.name, x: n.x, y: n.y + rad + 14 / Math.max(0.5, this.scale), pri, color: on ? '#ffe9b8' : '#a99fb8' });
      }
    }
    // Labels last, most important first; one that would overlap a placed label is left out.
    const size = 12 / Math.max(0.5, this.scale);
    g.font = `${Math.round(size)}px system-ui`;
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.lineWidth = 3 / Math.max(0.5, this.scale);
    g.strokeStyle = '#0b0a10';
    const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    for (const l of labels.sort((a, b) => b.pri - a.pri)) {
      const w = g.measureText(l.text).width;
      const r = { x0: l.x - w / 2 - 2, x1: l.x + w / 2 + 2, y0: l.y - size, y1: l.y + size * 0.3 };
      if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
      placed.push(r);
      g.strokeText(l.text, l.x, l.y);
      g.fillStyle = l.color;
      g.fillText(l.text, l.x, l.y);
    }
  }
}

function radius(n: TreeNode): number {
  switch (n.kind) {
    case 'start': return 26;
    case 'keystone': return 30;
    case 'notable': return 20;
    case 'skill': return 18;
    case 'mastery': return 22;
    case 'socket': return 16;
    case 'skillmod': return 12;
    default: return 10;
  }
}
