/**
 * Image capture for agents. Everything reads the exact low-res pixels (not the upscaled canvas),
 * so images are small, lossless and match what the pixel pipeline produced. Coordinates in every
 * capture: origin top-left of the visible low-res frame, 1 unit = 1 art pixel.
 */
import * as THREE from 'three';
import { config, setConfig, type ConfigKey } from '../config';
import type { Game } from '../game';
import { CharacterView } from '../render/characterView';
import { DIR8_SCREEN_NAMES, snapToGrid } from '../render/pixelGrid';
import { LAYER, PixelTargets } from '../render/pixelPipeline';

export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Box {
  id: string;
  kind: 'character' | 'crate';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor = the object's (snapped) origin projected to the frame, e.g. a character's feet. */
  ax: number;
  ay: number;
}

export function toCanvas(img: Img, scale = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if (scale === 1) return c;
  const s = document.createElement('canvas');
  s.width = img.width * scale;
  s.height = img.height * scale;
  const g = s.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, s.width, s.height);
  return s;
}

export const toPng = (c: HTMLCanvasElement) => c.toDataURL('image/png');

export function crop(img: Img, x: number, y: number, w: number, h: number): Img {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++)
    for (let col = 0; col < w; col++) {
      const sx = x + col, sy = y + row;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4, di = (row * w + col) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  return { width: w, height: h, data: out };
}

/** Current frame as the exact low-res image (draws first). Plain mode: canvas downsampled to the same size. */
export function captureFrame(game: Game): Img {
  game.render(1);
  const p = game.pipeline;
  const rect = p.visibleRect();
  if (config['render.pixelMode']) return p.read(p.main, rect);
  const c = document.createElement('canvas');
  c.width = rect.w;
  c.height = rect.h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(game.renderer.domElement, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

/** Screen-space boxes of characters and crates, in capture coordinates. */
export function entityBoxes(game: Game): Box[] {
  const { stage, pipeline } = game;
  const rect = pipeline.visibleRect();
  const top = pipeline.height - rect.y - rect.h;
  const toCap = (v: THREE.Vector3) => {
    const s = stage.project(v, pipeline.width, pipeline.height);
    return { x: s.x - rect.x, y: s.y - top };
  };
  const boxOf = (id: string, kind: Box['kind'], anchor: THREE.Vector3, pts: THREE.Vector3[]): Box => {
    const ps = pts.map(toCap);
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
    const a = toCap(anchor);
    return { id, kind, x, y, w: Math.ceil(Math.max(...xs)) - x, h: Math.ceil(Math.max(...ys)) - y, ax: +a.x.toFixed(2), ay: +a.y.toFixed(2) };
  };
  const out: Box[] = [];
  const r = stage.basis.right;
  const right = new THREE.Vector3(r.x, r.y, r.z);
  for (const [id, v] of stage.views) {
    const o = v.root.position;
    const h = 1.95 * Math.max(1, config['render.headScale'] * 0.9);
    out.push(boxOf(id, 'character', o.clone(), [
      o.clone().addScaledVector(right, -0.45), o.clone().addScaledVector(right, 0.45),
      o.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(right, -0.45),
      o.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(right, 0.45),
    ]));
  }
  for (const [id, m] of stage.crateMeshes) {
    const s = (m.geometry as THREE.BoxGeometry).parameters.width / 2;
    const corners: THREE.Vector3[] = [];
    for (const dx of [-s, s]) for (const dy of [-s, s]) for (const dz of [-s, s]) corners.push(m.position.clone().add(new THREE.Vector3(dx, dy, dz)));
    out.push(boxOf(id, 'crate', m.position.clone().setY(m.position.y - s), corners));
  }
  return out;
}

/** Upscaled copy with boxes and labels drawn on top (for vision models). */
export function annotate(img: Img, boxes: Box[], scale: number, labels: Record<string, string>): HTMLCanvasElement {
  const c = toCanvas(img, scale);
  const g = c.getContext('2d')!;
  g.font = `${Math.max(9, 4 * scale)}px monospace`;
  g.textBaseline = 'bottom';
  for (const b of boxes) {
    const color = b.kind === 'character' ? '#ffe14d' : '#7fd4ff';
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.strokeRect(b.x * scale + 0.5, b.y * scale + 0.5, b.w * scale, b.h * scale);
    const text = labels[b.id] ?? b.id;
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(b.x * scale, b.y * scale - 12, tw + 4, 12);
    g.fillStyle = color;
    g.fillText(text, b.x * scale + 2, b.y * scale);
  }
  return c;
}

/** Renders only the given characters (same camera, same snapping) and returns the frame. */
export function renderIsolated(game: Game, ids: string[]): Img {
  game.render(1);
  const { stage, pipeline, renderer } = game;
  const views = ids.map((id) => stage.views.get(id)).filter((v): v is CharacterView => !!v);
  views.forEach((v) => v.setIsolated(true));
  const bg = stage.scene.background;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  stage.scene.background = null;
  renderer.setClearColor(0x000000, 0);
  pipeline.renderLowRes(pipeline.main, stage.scene, stage.camera, [LAYER.ISOLATE]);
  renderer.setClearColor(prevClear, prevAlpha);
  stage.scene.background = bg;
  views.forEach((v) => v.setIsolated(false));
  return pipeline.read(pipeline.main, pipeline.visibleRect());
}

export function countColors(img: Img): { unique: number; top: Array<{ hex: string; count: number }> } {
  const counts = new Map<number, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const k = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([k, count]) => ({ hex: `#${k.toString(16).padStart(6, '0')}`, count }));
  return { unique: counts.size, top };
}

export function diffPixels(a: Img, b: Img): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (
      Math.abs(a.data[i] - b.data[i]) > 2 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 2 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 2 || Math.abs(a.data[i + 3] - b.data[i + 3]) > 2
    ) n++;
  return n;
}

export function opaquePixels(a: Img): number {
  let n = 0;
  for (let i = 3; i < a.data.length; i += 4) if (a.data[i] > 0) n++;
  return n;
}

/** Lays out images left-to-right, wrapping after `columns`. */
export function grid(imgs: Img[], columns: number, gap = 1, bg = [20, 18, 26, 255]): Img {
  const w = Math.max(...imgs.map((i) => i.width)), h = Math.max(...imgs.map((i) => i.height));
  const cols = Math.min(columns, imgs.length), rows = Math.ceil(imgs.length / cols);
  const W = cols * w + (cols - 1) * gap, H = rows * h + (rows - 1) * gap;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set(bg, i * 4);
  imgs.forEach((img, k) => {
    const ox = (k % cols) * (w + gap), oy = Math.floor(k / cols) * (h + gap);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const si = (y * img.width + x) * 4;
        if (img.data[si + 3] === 0) continue;
        data.set(img.data.subarray(si, si + 4), ((oy + y) * W + ox + x) * 4);
      }
  });
  return { width: W, height: H, data };
}

/** Render with temporary config overrides, restoring afterwards. */
export function withConfig<T>(overrides: Partial<Record<ConfigKey, unknown>>, fn: () => T): T {
  const prev: Array<[ConfigKey, unknown]> = [];
  for (const [k, v] of Object.entries(overrides) as Array<[ConfigKey, unknown]>) {
    prev.push([k, config[k]]);
    setConfig(k, v);
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of prev.reverse()) setConfig(k, v);
  }
}

/**
 * Sprite sheet of a preset: rows = clip x direction, columns = frames at `fps`.
 * Rendered in an empty studio with the same camera angle, pixel density and post-processing.
 */
export function renderSpriteSheet(
  game: Game,
  o: { preset: string; clips: string[]; directions: number; fps: number; cell: number; maxFrames: number },
) {
  const lib = game.lib;
  const ppm = config['render.pixelsPerMeter'];
  const studio = new THREE.Scene();
  studio.add(new THREE.HemisphereLight(0xc4ccff, 0x3d3446, 1.35));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  const az = (game.level.sun.azimuthDeg * Math.PI) / 180, el = (game.level.sun.elevationDeg * Math.PI) / 180;
  sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(30);
  studio.add(sun);
  const view = new CharacterView('__studio', o.preset, lib);
  studio.add(view.root);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const f = snapToGrid({ x: 0, y: 0.95, z: 0 }, game.stage.basis, ppm);
  const b = game.stage.basis;
  cam.position.set(f.x - b.forward.x * 40, f.y - b.forward.y * 40, f.z - b.forward.z * 40);
  cam.lookAt(f.x, f.y, f.z);
  const half = o.cell / 2 / ppm;
  Object.assign(cam, { left: -half, right: half, top: half, bottom: -half });
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const targets = new PixelTargets(o.cell, o.cell);
  const r = game.renderer;
  const prevClear = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  r.setClearColor(0x000000, 0);
  const dirStep = 8 / o.directions;
  const cells: Img[] = [];
  const rows: Array<{ row: number; clip: string; dir: number; dirName: string; frames: number }> = [];
  let cols = 1;
  try {
    for (const clip of o.clips) {
      const info = lib.manifest.clips.find((c) => c.name === clip);
      if (!info) throw new Error(`unknown clip "${clip}"`);
      cols = Math.max(cols, Math.min(o.maxFrames, Math.max(1, Math.round(info.duration * o.fps))));
    }
    for (const clip of o.clips) {
      const info = lib.manifest.clips.find((c) => c.name === clip)!;
      const n = Math.min(o.maxFrames, Math.max(1, Math.round(info.duration * o.fps)));
      for (let d = 0; d < o.directions; d++) {
        const dir = Math.round(d * dirStep) % 8;
        view.root.rotation.y = (dir * Math.PI) / 4;
        rows.push({ row: rows.length, clip, dir, dirName: DIR8_SCREEN_NAMES[dir], frames: n });
        for (let k = 0; k < cols; k++) {
          if (k >= n) {
            cells.push({ width: o.cell, height: o.cell, data: new Uint8ClampedArray(o.cell * o.cell * 4) });
            continue;
          }
          view.pose({ clip, time: Math.min(k / o.fps, info.duration), prevClip: null, prevTime: 0, blend: 1 });
          studio.updateMatrixWorld(true);
          game.pipeline.renderLowRes(targets, studio, cam, [LAYER.MAIN]);
          cells.push(game.pipeline.read(targets));
        }
      }
    }
  } finally {
    r.setClearColor(prevClear, prevAlpha);
    targets.dispose();
    view.dispose();
  }
  const sheet = grid(cells, cols, 0, [0, 0, 0, 0]);
  return { sheet, rows, cols, cell: o.cell, fps: o.fps };
}
