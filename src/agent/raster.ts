/**
 * Tiny software rasterizer for agent images that need no GPU: level maps, the passive tree,
 * labelled contact sheets. Works on plain RGBA buffers (`Img`), so the same code runs in the
 * browser and under Node tests. Text uses the game's 3x5 pixel font.
 */
import { GLYPH_H, GLYPH_W, glyphBits } from '../render/pixelFont';
import type { Img } from './capture';

export type RGBA = [number, number, number, number];

export function rgba(hex: string, a = 255): RGBA {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export function newImg(width: number, height: number, bg: RGBA = [0, 0, 0, 0]): Img {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(bg, i * 4);
  return { width, height, data };
}

export function setPx(img: Img, x: number, y: number, c: RGBA) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  if (c[3] >= 255) {
    img.data[i] = c[0];
    img.data[i + 1] = c[1];
    img.data[i + 2] = c[2];
    img.data[i + 3] = 255;
    return;
  }
  // Alpha blend over what is there.
  const a = c[3] / 255;
  img.data[i] = img.data[i] * (1 - a) + c[0] * a;
  img.data[i + 1] = img.data[i + 1] * (1 - a) + c[1] * a;
  img.data[i + 2] = img.data[i + 2] * (1 - a) + c[2] * a;
  img.data[i + 3] = Math.max(img.data[i + 3], c[3]);
}

export function fillRect(img: Img, x: number, y: number, w: number, h: number, c: RGBA) {
  for (let yy = Math.floor(y); yy < Math.floor(y + h); yy++) for (let xx = Math.floor(x); xx < Math.floor(x + w); xx++) setPx(img, xx, yy, c);
}

export function strokeRect(img: Img, x: number, y: number, w: number, h: number, c: RGBA) {
  for (let i = 0; i < w; i++) {
    setPx(img, x + i, y, c);
    setPx(img, x + i, y + h - 1, c);
  }
  for (let i = 0; i < h; i++) {
    setPx(img, x, y + i, c);
    setPx(img, x + w - 1, y + i, c);
  }
}

export function fillCircle(img: Img, cx: number, cy: number, r: number, c: RGBA) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) setPx(img, x, y, c);
}

export function ring(img: Img, cx: number, cy: number, r: number, c: RGBA) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r + 0.5 && d >= r - 0.6) setPx(img, x, y, c);
    }
}

/** Bresenham line. */
export function line(img: Img, x0: number, y0: number, x1: number, y1: number, c: RGBA) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 100000; guard++) {
    setPx(img, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function textWidthPx(text: string, scale = 1) {
  return text.length ? (text.length * (GLYPH_W + 1) - 1) * scale : 0;
}

export function text(img: Img, s: string, x: number, y: number, c: RGBA, scale = 1, outline: RGBA | null = [11, 10, 16, 255]) {
  const draw = (ox: number, oy: number, col: RGBA) => {
    let cx = x + ox;
    for (const ch of s) {
      const bits = glyphBits(ch);
      for (let r = 0; r < GLYPH_H; r++)
        for (let k = 0; k < GLYPH_W; k++) if (bits[r * GLYPH_W + k] === '1') fillRect(img, cx + k * scale, y + oy + r * scale, scale, scale, col);
      cx += (GLYPH_W + 1) * scale;
    }
  };
  if (outline) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) draw(ox, oy, outline);
  draw(0, 0, c);
}

/** Copies `src` onto `dst` at (x, y), skipping transparent pixels. */
export function blit(dst: Img, src: Img, x: number, y: number) {
  for (let yy = 0; yy < src.height; yy++)
    for (let xx = 0; xx < src.width; xx++) {
      const i = (yy * src.width + xx) * 4;
      if (src.data[i + 3] === 0) continue;
      setPx(dst, x + xx, y + yy, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
    }
}

/** Nearest-neighbour upscale. */
export function upscale(img: Img, k: number): Img {
  if (k === 1) return img;
  const out = newImg(img.width * k, img.height * k);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const si = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4, di = (y * out.width + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  return out;
}

/** Labelled contact sheet: one cell per image with a caption strip underneath. */
export function contactSheet(cells: Array<{ img: Img; label?: string; color?: string }>, columns: number, bg: RGBA = [20, 18, 26, 255]): Img {
  const w = Math.max(...cells.map((c) => c.img.width)), h = Math.max(...cells.map((c) => c.img.height));
  const capH = cells.some((c) => c.label) ? 9 : 0;
  const cols = Math.min(columns, cells.length), rows = Math.ceil(cells.length / cols);
  const W = cols * (w + 2) + 2, H = rows * (h + capH + 2) + 2;
  const out = newImg(W, H, bg);
  cells.forEach((c, k) => {
    const ox = 2 + (k % cols) * (w + 2), oy = 2 + Math.floor(k / cols) * (h + capH + 2);
    fillRect(out, ox, oy, w, h, [32, 29, 42, 255]);
    blit(out, c.img, ox + Math.floor((w - c.img.width) / 2), oy + Math.floor((h - c.img.height) / 2));
    if (c.label) {
      const maxChars = Math.floor((w + 1) / 4);
      const t = c.label.length > maxChars ? c.label.slice(0, maxChars - 1) + '.' : c.label;
      text(out, t, ox + Math.max(0, Math.floor((w - textWidthPx(t)) / 2)), oy + h + 2, rgba(c.color ?? '#e8e4da'), 1, null);
    }
  });
  return out;
}
