/** Owns the sim, the stage and the pixel pipeline; the real-time loop, the agent API and input all go through it. */
import * as THREE from 'three';
import { config } from './config';
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
  private acc = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastAlpha = 1;

  constructor(readonly renderer: THREE.WebGLRenderer, readonly lib: AssetLibrary, readonly canvas: HTMLCanvasElement) {
    this.stage = new Stage(lib);
    this.pipeline = new PixelPipeline(renderer);
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
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
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
    this.lastAlpha = alpha;
    this.resize();
    this.stage.update(this.sim, alpha, this.pipeline);
    this.pipeline.background.set(this.level.background).convertSRGBToLinear();
    this.pipeline.render(this.stage.scene, this.stage.camera, { subPixel: this.stage.subPixel });
    this.renderFrames++;
  }
}
