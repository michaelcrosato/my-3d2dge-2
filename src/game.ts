/** Owns the sim, the stage and the pixel pipeline; the real-time loop, the agent API and input all go through it. */
import * as THREE from 'three';
import { config, configListeners } from './config';
import { PRESETS } from './content/characters';
import { DEFAULT_LEVEL, type CharacterDef, type Level } from './content/level';
import { AssetLibrary, clipTable } from './render/assets';
import { PixelPipeline } from './render/pixelPipeline';
import { Stage } from './render/stage';
import { Sim } from './sim/sim';

export class Game {
  sim!: Sim;
  readonly stage: Stage;
  readonly pipeline: PixelPipeline;
  level: Level = structuredClone(DEFAULT_LEVEL);
  seed = 1;
  paused = false;
  renderFrames = 0;
  fps = 0;
  /** Draw calls / triangles / milliseconds of the last rendered frame (all passes). */
  readonly frameStats = { calls: 0, triangles: 0, ms: 0 };
  /** True when something visible changed since the last render (config, resize, level). */
  needsRender = true;
  private acc = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastAlpha = 1;
  private sizeDirty = true;
  private backgroundKey = '';

  constructor(readonly renderer: THREE.WebGLRenderer, readonly lib: AssetLibrary, readonly canvas: HTMLCanvasElement) {
    this.stage = new Stage(lib);
    this.pipeline = new PixelPipeline(renderer);
    // Per-frame stats cover every pass of a frame, so reset them manually in render().
    renderer.info.autoReset = false;
    // Measure the canvas only when its size may have changed, never as a per-frame layout read.
    const markResized = () => {
      this.sizeDirty = true;
      this.needsRender = true;
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(markResized).observe(canvas);
    window.addEventListener('resize', markResized);
    configListeners.add((key) => {
      this.needsRender = true;
      if (key === 'render.targetLines') this.sizeDirty = true;
    });
  }

  /** Loads every model a preset needs. */
  async ensurePresets(presets: string[]) {
    const ids = new Set<string>();
    for (const p of presets) {
      const def = PRESETS[p];
      if (!def) throw new Error(`unknown preset "${p}". Known: ${Object.keys(PRESETS).join(', ')}`);
      ids.add(def.base);
      def.parts.forEach((x) => ids.add(x));
    }
    await Promise.all([...ids].map((id) => this.lib.loadModel(id)));
  }

  async reset(opts: { level?: Level; seed?: number } = {}) {
    if (opts.level) this.level = structuredClone(opts.level);
    if (opts.seed !== undefined) this.seed = opts.seed;
    await this.ensurePresets(this.level.characters.map((c) => c.preset));
    this.sim?.dispose();
    this.sim = await Sim.create(this.level, clipTable(this.lib.manifest), this.seed);
    for (const v of this.stage.views.values()) v.dispose();
    this.stage.views.clear();
    this.stage.buildLevel(this.level);
    this.stage.syncRoster(this.sim);
    this.acc = 0;
    this.sizeDirty = true;
    this.render(1);
  }

  async spawn(def: CharacterDef) {
    await this.ensurePresets([def.preset]);
    const ch = this.sim.spawn(def);
    this.stage.syncRoster(this.sim);
    return ch;
  }

  despawn(id: string) {
    this.sim.despawn(id);
    this.stage.syncRoster(this.sim);
  }

  /** Canvas backing store in DEVICE pixels, so integer upscaling stays exact under OS display scaling. */
  resize() {
    if (!this.sizeDirty) return;
    this.sizeDirty = false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
  }

  /**
   * World point under a client (CSS pixel) position: undoes the integer upscale and sub-pixel
   * offset, unprojects through the orthographic camera and ray casts the Rapier world.
   */
  pick(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dx = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const dy = ((clientY - rect.top) / rect.height) * this.canvas.height;
    let ndcX: number, ndcY: number;
    if (config['render.pixelMode']) {
      const p = this.pipeline, sub = this.stage.subPixel;
      const tx = (dx + (p.width * p.scale - p.deviceW) / 2 + sub.x * p.scale) / p.scale;
      const ty = (p.deviceH - dy + (p.height * p.scale - p.deviceH) / 2 + sub.y * p.scale) / p.scale;
      ndcX = (tx / p.width) * 2 - 1;
      ndcY = (ty / p.height) * 2 - 1;
    } else {
      ndcX = (dx / this.canvas.width) * 2 - 1;
      ndcY = 1 - (dy / this.canvas.height) * 2;
    }
    const cam = this.stage.camera;
    const origin = new THREE.Vector3(ndcX, ndcY, -1).unproject(cam);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    return this.sim.raycast(origin, dir);
  }

  /** Real-time loop tick. */
  advance(realDt: number) {
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (!this.paused) {
      this.acc += Math.min(realDt, 0.1) * config['sim.timeScale'];
      let n = 0;
      while (this.acc >= this.sim.dt && n < 6) {
        this.sim.step();
        this.acc -= this.sim.dt;
        n++;
      }
      if (n === 6) this.acc = 0;
    }
    this.render(this.paused ? 1 : this.acc / this.sim.dt);
  }

  /** Advance exactly n sim frames (deterministic, independent of wall-clock), then draw. */
  step(n = 1) {
    for (let i = 0; i < n; i++) this.sim.step();
    this.acc = 0;
    this.render(1);
  }

  render(alpha = this.lastAlpha) {
    const t0 = performance.now();
    this.lastAlpha = alpha;
    this.renderer.info.reset();
    this.resize();
    this.stage.update(this.sim, alpha, this.pipeline);
    if (this.backgroundKey !== this.level.background) {
      // The upscale pass mixes this into sRGB-encoded pixels, so keep the hex's raw components.
      this.backgroundKey = this.level.background;
      this.pipeline.background.setStyle(this.level.background, THREE.LinearSRGBColorSpace);
    }
    this.pipeline.render(this.stage.scene, this.stage.camera, { subPixel: this.stage.subPixel });
    this.renderFrames++;
    this.needsRender = false;
    const info = this.renderer.info.render;
    this.frameStats.calls = info.calls;
    this.frameStats.triangles = info.triangles;
    this.frameStats.ms = performance.now() - t0;
  }
}
