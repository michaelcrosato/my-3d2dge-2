/**
 * Procedural 16x16 pixel-art skill icons, drawn from a short recipe per icon key (shapes in the
 * skill's element color on a dark gem background). Shown scaled up with pixelated rendering.
 */
import { SKILLS } from '../content/skills';

type Px = (x: number, y: number, c: string) => void;

const cache = new Map<string, HTMLCanvasElement>();

function line(px: Px, x0: number, y0: number, x1: number, y1: number, c: string) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function circle(px: Px, cx: number, cy: number, r: number, c: string, fill = false) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (fill ? d <= r + 0.3 : Math.abs(d - r) < 0.6) px(cx + x, cy + y, c);
    }
}

const RECIPES: Record<string, (px: Px, c: string) => void> = {
  slash: (px, c) => { line(px, 3, 12, 12, 3, c); line(px, 4, 12, 12, 4, '#ffffff'); px(2, 13, '#c9a13b'); px(3, 13, '#c9a13b'); },
  cleave: (px, c) => { for (let a = -1.1; a <= 1.1; a += 0.08) px(Math.round(8 + Math.cos(a - 1.57) * 6), Math.round(10 + Math.sin(a - 1.57) * 6), c); line(px, 8, 13, 8, 6, '#ffffff'); },
  whirlwind: (px, c) => { for (let a = 0; a < 12; a += 0.15) px(Math.round(8 + Math.cos(a) * a * 0.55), Math.round(8 + Math.sin(a) * a * 0.55), c); },
  dash: (px, c) => { line(px, 2, 8, 12, 8, c); line(px, 9, 5, 13, 8, c); line(px, 9, 11, 13, 8, c); line(px, 2, 6, 6, 6, '#ffffff'); line(px, 2, 10, 6, 10, '#ffffff'); },
  dodge: (px, c) => { for (let a = 3.6; a < 8.2; a += 0.12) px(Math.round(8 + Math.cos(a) * 5), Math.round(8 + Math.sin(a) * 5), c); line(px, 12, 6, 13, 9, '#ffffff'); },
  leap: (px, c) => { for (let x = 2; x <= 13; x++) px(x, Math.round(12 - 9 * Math.sin(((x - 2) / 11) * Math.PI)), c); line(px, 10, 13, 14, 13, '#ffffff'); },
  slam: (px, c) => { line(px, 8, 2, 8, 9, '#ffffff'); line(px, 2, 13, 14, 13, c); line(px, 8, 13, 5, 10, c); line(px, 8, 13, 11, 10, c); line(px, 8, 13, 8, 11, c); },
  fireball: (px, c) => { circle(px, 10, 6, 3, c, true); circle(px, 10, 6, 1, '#fff0c0', true); line(px, 2, 13, 7, 8, c); line(px, 3, 13, 7, 9, '#ff6a2a'); },
  nova: (px, c) => { circle(px, 8, 8, 6, c); circle(px, 8, 8, 3, '#ffffff'); px(8, 8, c); },
  lightning: (px, c) => { line(px, 9, 1, 5, 7, c); line(px, 5, 7, 10, 7, c); line(px, 10, 7, 6, 14, c); line(px, 10, 1, 6, 7, '#ffffff'); },
  knives: (px, c) => { line(px, 3, 13, 8, 3, c); line(px, 7, 13, 10, 3, c); line(px, 11, 13, 13, 4, c); },
  charge: (px, c) => { circle(px, 6, 8, 3, c, true); line(px, 9, 8, 14, 8, '#ffffff'); line(px, 11, 5, 14, 8, '#ffffff'); line(px, 11, 11, 14, 8, '#ffffff'); },
  warcry: (px, c) => { circle(px, 4, 8, 2, c, true); for (const r of [4, 7, 10]) for (let a = -0.6; a <= 0.6; a += 0.1) px(Math.round(4 + Math.cos(a) * r), Math.round(8 + Math.sin(a) * r), r === 4 ? '#ffffff' : c); },
  blink: (px, c) => { circle(px, 4, 11, 2, c); circle(px, 11, 4, 2, c, true); for (let i = 0; i < 4; i++) px(6 + i, 9 - i, '#ffffff'); },
  vortex: (px, c) => { circle(px, 8, 8, 6, '#5a5a6a'); for (const a of [0, 2.1, 4.2]) { const x = Math.round(8 + Math.cos(a) * 6), y = Math.round(8 + Math.sin(a) * 6); line(px, x - 1, y - 1, x + 1, y + 1, c); px(x, y, '#ffffff'); } },
  meteor: (px, c) => { circle(px, 10, 10, 3, c, true); line(px, 2, 2, 8, 8, '#ffd070'); line(px, 3, 2, 8, 7, c); },
  venom: (px, c) => { circle(px, 6, 9, 3, c, true); circle(px, 10, 8, 3, c, true); circle(px, 8, 6, 2, '#c8ff9a', true); },
  wolves: (px, c) => { line(px, 3, 12, 6, 4, c); line(px, 6, 4, 8, 8, c); line(px, 8, 8, 10, 4, c); line(px, 10, 4, 13, 12, c); line(px, 3, 12, 13, 12, c); px(6, 9, '#ffffff'); px(10, 9, '#ffffff'); },
  icespear: (px, c) => { line(px, 2, 14, 13, 3, c); line(px, 3, 14, 13, 4, '#ffffff'); px(13, 2, '#ffffff'); px(14, 3, '#ffffff'); },
  claw: (px, c) => { for (const o of [-3, 0, 3]) line(px, 4 + o, 3, 10 + o, 13, c); },
  bite: (px, c) => { circle(px, 8, 8, 5, c); line(px, 3, 8, 13, 8, '#ffffff'); },
  punch: (px, c) => { circle(px, 8, 8, 4, c, true); line(px, 2, 8, 4, 8, '#ffffff'); },
  burst: (px, c) => { circle(px, 8, 8, 3, c, true); for (let a = 0; a < 6.28; a += 0.78) line(px, Math.round(8 + Math.cos(a) * 4), Math.round(8 + Math.sin(a) * 4), Math.round(8 + Math.cos(a) * 7), Math.round(8 + Math.sin(a) * 7), '#ffffff'); },
  heal: (px, c) => { line(px, 8, 3, 8, 13, c); line(px, 3, 8, 13, 8, c); },
};

/** Canvas icon for a skill (16x16, cached; clone with drawImage or cloneNode when reusing). */
export function skillIcon(id: string): HTMLCanvasElement {
  const hit = cache.get(id);
  if (hit) return hit;
  const s = SKILLS[id];
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.className = 'pix';
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1626';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#2a2438';
  g.fillRect(1, 1, 14, 14);
  const color = s?.color ?? (s?.kind === 'spell' ? '#b8a0ff' : '#e8eef6');
  const px: Px = (x, y, col) => {
    if (x < 1 || y < 1 || x > 14 || y > 14) return;
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  (RECIPES[s?.icon ?? 'slash'] ?? RECIPES.slash)(px, color);
  cache.set(id, c);
  return c;
}

/** A fresh canvas copy (DOM nodes can only live in one place). */
export function skillIconNode(id: string, size = 36): HTMLCanvasElement {
  const src = skillIcon(id);
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.className = 'pix';
  c.getContext('2d')!.drawImage(src, 0, 0);
  c.style.width = c.style.height = `${size}px`;
  return c;
}
