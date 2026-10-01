/**
 * The overlay layer: a 2D canvas the size of the low-res target, drawn in exact art pixels and
 * composited by the pixel pipeline's upscale pass (so it lines up with the world pixel for pixel,
 * including smooth-scroll offsets). It holds floating damage numbers, health bars, elite names,
 * ground-loot labels (clickable), interaction prompts and the minimap with fog of war.
 */
import { config } from '../config';
import * as THREE from 'three';
import { RARITY_COLOR } from '../content/items';
import { gridAt } from '../content/level';
import { DAMAGE_COLORS, type DamageType } from '../content/stats';
import type { Sim, SimEvent } from '../sim/sim';
import type { Character } from '../sim/types';
import { drawText, textWidth } from './pixelFont';
import type { Stage } from './stage';

interface FloatText {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  t: number;
  max: number;
  scale: number;
  drift: number;
}

export interface LabelRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayOptions {
  /** Key label for the interact action ("E"). */
  interactKey: string;
  minimap: boolean;
  heroId: string;
  /** Pointer position in low-res target pixels (hover highlight), or null. */
  hover: { x: number; y: number } | null;
}

export class Overlay {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private floats: FloatText[] = [];
  labels: LabelRect[] = [];
  /** Where the minimap was drawn (low-res px), so DOM buttons can sit under it. */
  minimapRect: { x: number; y: number; w: number; h: number } | null = null;
  private lastSeq = 0;
  private sim: Sim | null = null;
  private explored: Uint8Array | null = null;
  private tmp = new THREE.Vector3();
  private manaWarnAt = -999;
  enabled = true;

  constructor() {
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  private float(x: number, y: number, z: number, text: string, color: string, scale = 1, max = 0.9) {
    if (this.floats.length > 120) this.floats.shift();
    this.floats.push({ x, y, z, text, color, t: 0, max, scale, drift: (Math.random() - 0.5) * 8 });
  }

  private onEvent(sim: Sim, e: SimEvent, heroId: string) {
    const ch = (id: unknown) => (typeof id === 'string' ? sim.characters.get(id) : undefined);
    switch (e.type) {
      case 'hit': {
        const t = ch(e.target);
        const dmg = e.damage as number;
        if (!t || dmg < 0.5 || !config['ui.damageNumbers']) break;
        const y = t.pos.y + 1.9 * Math.min(2, t.scale);
        const toHero = e.target === heroId;
        const color = toHero ? '#ff5a5a' : DAMAGE_COLORS[(e.dmgType as DamageType) ?? 'physical'];
        this.float(t.pos.x, y, t.pos.z, `${fmt(dmg)}${e.crit ? '!' : ''}`, e.crit ? '#ffe14d' : color, e.crit ? 2 : 1, e.crit ? 1.1 : 0.8);
        break;
      }
      case 'dot': {
        const t = ch(e.target);
        const dmg = e.damage as number;
        if (t && dmg >= 1) this.float(t.pos.x, t.pos.y + 1.6 * t.scale, t.pos.z, fmt(dmg), DAMAGE_COLORS[(e.dmgType as DamageType) ?? 'physical'], 1, 0.6);
        break;
      }
      case 'evade': case 'block': case 'immune': {
        const t = ch(e.target);
        if (t) this.float(t.pos.x, t.pos.y + 1.9 * t.scale, t.pos.z, String(e.type).toUpperCase(), '#c8c8d8', 1, 0.7);
        break;
      }
      case 'pickup':
        if (e.kind === 'gold') this.float(e.x as number, 1.2, e.z as number, `+${e.amount}`, '#ffd84a', 1, 0.8);
        break;
      case 'levelup': {
        const h = sim.characters.get(heroId);
        if (h) this.float(h.pos.x, 2.6, h.pos.z, `LEVEL ${e.level}!`, '#ffe14d', 2, 2);
        break;
      }
      case 'mechanic.kill':
        this.float(e.x as number, 1.8, e.z as number, '+50% XP', '#ffe14d', 1, 0.9);
        break;
      case 'shrine':
        this.float(e.x as number, 2.2, e.z as number, String(e.buff).toUpperCase(), '#ffffff', 2, 1.4);
        break;
      case 'imp.escape':
        this.float(e.x as number, 1.6, e.z as number, 'ESCAPED!', '#ffd84a', 1, 1.2);
        break;
      case 'skill.blocked': {
        const h = sim.characters.get(heroId);
        if (h && e.reason === 'mana' && sim.frame - this.manaWarnAt > 40) {
          this.manaWarnAt = sim.frame;
          this.float(h.pos.x, 2.3, h.pos.z, 'NO MANA', '#7a9aff', 1, 0.7);
        }
        break;
      }
      case 'xp': {
        const amount = e.amount as number;
        const h = sim.characters.get(heroId);
        if (h && amount >= 1 && Math.random() < 0.35) this.float(h.pos.x, 2.2, h.pos.z, `+${amount} XP`, '#b8a0ff', 1, 0.7);
        break;
      }
    }
  }

  private project(stage: Stage, w: number, h: number, x: number, y: number, z: number) {
    this.tmp.set(x, y, z);
    return stage.project(this.tmp, w, h);
  }

  update(sim: Sim, stage: Stage, w: number, h: number, dt: number, o: OverlayOptions) {
    if (sim !== this.sim) {
      this.sim = sim;
      this.lastSeq = sim.lastEventSeq;
      this.floats = [];
      const g = sim.level.grid;
      this.explored = g ? new Uint8Array(g.cols * g.rows) : null;
      // Town needs no exploring.
      if (this.explored && sim.level.kind === 'town') this.explored.fill(1);
    }
    for (const e of sim.eventsSince(this.lastSeq)) this.onEvent(sim, e, o.heroId);
    this.lastSeq = sim.lastEventSeq;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.texture.dispose();
      // A resized canvas needs a fresh GPU texture.
      (this as { texture: THREE.CanvasTexture }).texture = new THREE.CanvasTexture(this.canvas);
      this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
      this.texture.generateMipmaps = false;
      this.texture.colorSpace = THREE.NoColorSpace;
    }
    const g = this.g;
    g.clearRect(0, 0, w, h);
    this.labels = [];
    if (!this.enabled) {
      this.texture.needsUpdate = true;
      return;
    }
    const hero = sim.characters.get(o.heroId);
    // Health bars and elite names.
    for (const ch of sim.characters.values()) {
      if (ch.state === 'dead' || ch.id === o.heroId || ch.team === 'neutral') continue;
      const boss = !!ch.monster?.boss;
      const elite = ch.monster && ch.monster.rarity !== 'normal';
      const hurt = ch.life < ch.maxLife - 0.01;
      if (!hurt && !elite && ch.team !== 'hero') continue;
      if (boss) continue;
      const p = this.project(stage, w, h, ch.pos.x, ch.pos.y + 2.05 * Math.min(2.2, ch.scale) + ch.lift, ch.pos.z);
      const bw = ch.monster?.rarity === 'rare' ? 22 : elite ? 18 : ch.team === 'hero' ? 10 : 12;
      const x = Math.round(p.x - bw / 2), y = Math.round(p.y);
      g.fillStyle = '#0b0a10';
      g.fillRect(x - 1, y - 1, bw + 2, 4);
      g.fillStyle = '#3a1418';
      g.fillRect(x, y, bw, 2);
      g.fillStyle = ch.team === 'hero' ? '#5ad06a' : ch.statuses.some((s) => s.id === 'shielded') ? '#fff2b0' : '#e0283a';
      g.fillRect(x, y, Math.max(1, Math.round((bw * ch.life) / ch.maxLife)), 2);
      if (elite && hero && Math.hypot(hero.pos.x - ch.pos.x, hero.pos.z - ch.pos.z) < 14) {
        const color = ch.monster!.rarity === 'rare' ? '#ffe14d' : '#9aa8ff';
        const name = ch.name.length > 22 ? `${ch.name.slice(0, 21)}.` : ch.name;
        drawText(g, name, p.x - textWidth(name) / 2, y - 8, color);
      }
    }
    // Ground loot labels (clickable), stacked so they don't overlap.
    const placed: LabelRect[] = [];
    const minRank = { all: 0, magic: 1, rare: 2 }[config['ui.lootFilter'] as 'all'] ?? 0;
    const rank = { normal: 0, magic: 1, rare: 2, unique: 3 } as const;
    const items = sim.pickups.filter((p) => p.kind === 'item' && p.item && rank[p.item.rarity] >= minRank);
    for (const p of items) {
      const s = this.project(stage, w, h, p.x, 0.5, p.z);
      const name = p.item!.name.length > 24 ? `${p.item!.name.slice(0, 23)}.` : p.item!.name;
      const tw = textWidth(name);
      let rect: LabelRect = { id: p.id, x: Math.round(s.x - tw / 2 - 2), y: Math.round(s.y - 12), w: tw + 4, h: 8 };
      for (let k = 0; k < 8 && placed.some((q) => overlaps(q, rect)); k++) rect = { ...rect, y: rect.y - 9 };
      placed.push(rect);
      const hover = o.hover && o.hover.x >= rect.x && o.hover.x < rect.x + rect.w && o.hover.y >= rect.y && o.hover.y < rect.y + rect.h;
      g.fillStyle = hover ? '#2a2640ee' : '#0b0a10d0';
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
      if (p.item!.rarity !== 'normal') {
        g.fillStyle = RARITY_COLOR[p.item!.rarity];
        g.fillRect(rect.x, rect.y + rect.h - 1, rect.w, 1);
      }
      drawText(g, name, rect.x + 2, rect.y + 1, RARITY_COLOR[p.item!.rarity], 1, null);
    }
    this.labels = placed;
    // Interaction prompt.
    if (hero && hero.state !== 'dead') {
      const t = sim.interactTarget(hero);
      if (t) {
        let wx = 0, wz = 0, text = '';
        if (t.kind === 'pickup') {
          wx = t.pickup.x;
          wz = t.pickup.z;
          text = '';
        } else if (t.kind === 'prop') {
          wx = t.prop.x;
          wz = t.prop.z;
          text = t.prop.kind === 'portal' ? (t.prop.data.to === 'town' ? 'TOWN PORTAL' : t.prop.data.to === 'next' ? 'ENTER PORTAL' : 'PORTAL') : t.prop.kind === 'chest' ? 'OPEN' : t.prop.kind.replace(/_/g, ' ');
        } else {
          wx = t.npc.pos.x;
          wz = t.npc.pos.z;
          text = `TALK ${t.npc.name}`;
        }
        if (text) {
          const p = this.project(stage, w, h, wx, 2.5, wz);
          const label = `[${o.interactKey}] ${text}`;
          const tw = textWidth(label);
          g.fillStyle = '#0b0a10d0';
          g.fillRect(Math.round(p.x - tw / 2 - 2), Math.round(p.y - 1), tw + 4, 7);
          drawText(g, label, p.x - tw / 2, p.y, '#fff4db', 1, null);
        }
      }
    }
    // Floating numbers.
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      if (f.t >= f.max) {
        this.floats.splice(i, 1);
        continue;
      }
      const p = this.project(stage, w, h, f.x, f.y, f.z);
      const u = f.t / f.max;
      const rise = 14 * (1 - (1 - u) * (1 - u));
      const tw = textWidth(f.text, f.scale);
      g.globalAlpha = u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1;
      drawText(g, f.text, p.x - tw / 2 + f.drift * u, p.y - rise, f.color, f.scale);
      g.globalAlpha = 1;
    }
    this.minimapRect = null;
    if (o.minimap && hero) this.minimap(sim, hero, w, h);
    this.texture.needsUpdate = true;
  }

  private minimap(sim: Sim, hero: Character, w: number, h: number) {
    const grid = sim.level.grid;
    const ex = this.explored;
    if (!grid || !ex) return;
    const g = this.g;
    const size = Math.max(40, Math.min(64, Math.floor(Math.min(w, h) * 0.24)));
    const ox = w - size - 4, oy = 4;
    this.minimapRect = { x: ox, y: oy, w: size, h: size };
    const hc = Math.floor((hero.pos.x - grid.originX) / grid.cell), hr = Math.floor((hero.pos.z - grid.originZ) / grid.cell);
    // Reveal around the hero.
    const R = 9;
    for (let r = hr - R; r <= hr + R; r++)
      for (let c = hc - R; c <= hc + R; c++) {
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
        if ((c - hc) ** 2 + (r - hr) ** 2 <= R * R) ex[r * grid.cols + c] = 1;
      }
    // The map is drawn rotated 45° like the iso view: screen right = +X -Z, screen up = -X -Z.
    g.fillStyle = '#0b0a10b0';
    g.fillRect(ox - 1, oy - 1, size + 2, size + 2);
    const cx = ox + size / 2, cy = oy + size / 2;
    const toMap = (c: number, r: number) => {
      const dc = c - hc, dr = r - hr;
      return { x: Math.round(cx + (dc - dr) * 0.75), y: Math.round(cy + (dc + dr) * 0.75 * 0.5) };
    };
    const reach = Math.ceil(size / 1.1);
    for (let r = hr - reach; r <= hr + reach; r++)
      for (let c = hc - reach; c <= hc + reach; c++) {
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows || !ex[r * grid.cols + c]) continue;
        const t = gridAt(grid, c, r);
        if (t === ' ') continue;
        const p = toMap(c, r);
        if (p.x < ox || p.y < oy || p.x >= ox + size || p.y >= oy + size) continue;
        g.fillStyle = t === '#' ? '#c8bcd8' : '#4e475e';
        g.fillRect(p.x, p.y, t === '#' ? 1 : 2, 1);
      }
    const dot = (x: number, z: number, color: string, s = 1) => {
      const c = Math.floor((x - grid.originX) / grid.cell), r = Math.floor((z - grid.originZ) / grid.cell);
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows || !ex[r * grid.cols + c]) return;
      const p = toMap(c, r);
      if (p.x < ox || p.y < oy || p.x >= ox + size - s || p.y >= oy + size - s) return;
      g.fillStyle = color;
      g.fillRect(p.x, p.y, s, s);
    };
    for (const ch of sim.characters.values()) {
      if (ch.state === 'dead' || ch.id === hero.id) continue;
      if (ch.team === 'enemy') dot(ch.pos.x, ch.pos.z, ch.monster?.boss ? '#ff8a3d' : ch.monster && ch.monster.rarity !== 'normal' ? '#ffe14d' : '#e0283a', ch.monster?.boss ? 3 : 1);
      else if (ch.npc) dot(ch.pos.x, ch.pos.z, '#7affd8', 2);
    }
    for (const p of sim.props.values()) {
      if (p.dead) continue;
      if (p.kind === 'portal' || p.kind === 'waypoint') dot(p.x, p.z, '#7ab8ff', 2);
      else if (p.kind === 'chest' && p.state !== 'used') dot(p.x, p.z, '#ffd27a', 2);
      else if (p.kind.startsWith('shrine')) dot(p.x, p.z, '#c77dff', 2);
    }
    for (const p of sim.pickups) if (p.kind === 'item' && p.item && p.item.rarity !== 'normal') dot(p.x, p.z, RARITY_COLOR[p.item.rarity]);
    if ((sim.frame >> 4) % 2 === 0) {
      g.fillStyle = '#ffffff';
      g.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);
    }
  }

  /** Ground-loot label under a low-res point. */
  labelAt(x: number, y: number): number | null {
    for (const l of this.labels) if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) return l.id;
    return null;
  }
}

function overlaps(a: LabelRect, b: LabelRect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1000) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
