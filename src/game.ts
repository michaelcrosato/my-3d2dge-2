/**
 * Owns the sim, the stage and the pixel pipeline, plus the run: which mode we're in (title,
 * town, dungeon, sandbox), the hero, the current stage, transitions through portals, progress and
 * saving. The real-time loop, the agent API, UI panels and input all go through it.
 *
 * UI listens on `game.listeners` for both sim events (hits, loot, level-ups, NPC talks) and game
 * events (mode changes, stage cleared, saved).
 */
import * as THREE from 'three';
import { config, configListeners } from './config';
import { monsterId, registerDesign, type SpeciesDesign } from './content/bestiary';
import { campaignStage } from './content/campaign';
import { buildTrialLevel, dailyTrial, dateKey } from './content/daily';
import { applyPactsToSpec, pactRewardText, stampPacts } from './content/pacts';
import { PRESETS } from './content/characters';
import { DEFAULT_LEVEL, type CharacterDef, type Level } from './content/level';
import { ensureMonster } from './content/monsters';
import { generateDungeon } from './content/procgen/dungeon';
import { stageSpec } from './content/stages';
import { townLevel } from './content/town';
import { AssetLibrary, clipTable } from './render/assets';
import { Overlay, type OverlayOptions } from './render/overlay';
import { PixelPipeline } from './render/pixelPipeline';
import { Stage } from './render/stage';
import type { SaveStore } from './save';
import { newHero, type Hero } from './sim/hero';
import { Bot, type BotOptions } from './sim/bot';
import { hashSeed } from './sim/rng';
import { dropPinnacle } from './sim/loot';
import { Sim, type SimEvent } from './sim/sim';

export type Mode = 'title' | 'town' | 'dungeon' | 'sandbox';

/** Frames (60 per second) as m:ss.t. */
export function fmtFrames(frames: number): string {
  const s = frames / 60;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export class Game {
  sim!: Sim;
  readonly stage: Stage;
  readonly pipeline: PixelPipeline;
  readonly overlay = new Overlay();
  level: Level = structuredClone(DEFAULT_LEVEL);
  seed = 1;
  paused = false;
  mode: Mode = 'sandbox';
  hero: Hero | null = null;
  heroSlot = 0;
  /** Dungeon stage being played (0 in town / sandbox / the Proving Grounds). */
  stageNo = 0;
  /** True in the Proving Grounds (a Workshop test fight): no campaign progress, exit leads home. */
  arena = false;
  /** Date key of the Daily Trial being played (null otherwise). */
  trial: string | null = null;
  /** Pacts chosen at the waypoint; they apply to every depth entered until changed. */
  pacts: string[] = [];
  /** Town visits (vendor restocks each visit). */
  visits = 0;
  saves: SaveStore | null = null;
  /** The hero is a throwaway (title backdrop, ?town / ?stage quick starts): never saved. */
  ephemeralHero = false;
  /** True while a level is loading (stepping is suspended). */
  busy = false;
  readonly listeners = new Set<(e: GameEvent | SimEvent) => void>();
  overlayOptions: OverlayOptions = { interactKey: 'E', minimap: true, heroId: 'player', hover: null };
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
  private lastSeq = 0;
  private lastRealDt = 1 / 60;
  private transition: Promise<void> | null = null;
  private saveTimer = 0;
  /** Autopilot: a bot plays the hero (agent `bot.autopilot`, pause-menu demo). */
  private autopilotOpts: BotOptions | null = null;
  private bot: Bot | null = null;

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
      if (key.startsWith('tune.') && this.sim) this.sim.retune();
    });
  }

  emit(e: GameEvent) {
    for (const fn of this.listeners) fn(e);
  }

  /** Loads every model the level's characters (and their summons) need. */
  async ensurePresets(defs: CharacterDef[]) {
    const presets = new Set<string>(['ranger', 'thrall']);
    for (const d of defs) {
      if (d.monster) {
        const md = ensureMonster(d.monster.def);
        if (md.body.kind === 'humanoid') presets.add(md.body.preset);
        if (md.minion) {
          const mm = ensureMonster(md.minion);
          if (mm.body.kind === 'humanoid') presets.add(mm.body.preset);
        }
      } else if (PRESETS[d.preset]) presets.add(d.preset);
    }
    const ids = new Set<string>();
    for (const p of presets) {
      const def = PRESETS[p];
      if (!def) throw new Error(`unknown preset "${p}". Known: ${Object.keys(PRESETS).join(', ')}`);
      ids.add(def.base);
      def.parts.forEach((x) => ids.add(x));
    }
    await Promise.all([...ids].map((id) => this.lib.loadModel(id)));
  }

  /** Rebuilds the sim and the scene from `level` (agents use this directly). */
  async reset(opts: { level?: Level; seed?: number; hero?: Hero | null } = {}) {
    if (opts.level) this.level = structuredClone(opts.level);
    if (opts.seed !== undefined) this.seed = opts.seed;
    if (opts.hero !== undefined) this.hero = opts.hero;
    await this.ensurePresets(this.level.characters);
    this.sim?.dispose();
    const useHero = this.level.kind === 'town' || this.level.kind === 'dungeon' ? this.hero : null;
    this.sim = await Sim.create(this.level, clipTable(this.lib.manifest), this.seed, { hero: useHero });
    for (const v of this.stage.views.values()) v.dispose();
    this.stage.views.clear();
    this.stage.hero = useHero;
    this.stage.buildLevel(this.level);
    this.stage.syncRoster(this.sim);
    this.lastSeq = this.sim.lastEventSeq;
    this.acc = 0;
    this.sizeDirty = true;
    this.render(1);
  }

  // ---------------------------------------------------------------- run flow

  /** Starts a fresh hero in a save slot and walks into town. */
  async newGame(slot = 0, name = 'Ranger') {
    this.hero = newHero(name);
    this.ephemeralHero = false;
    this.heroSlot = slot;
    this.save();
    await this.enterTown();
  }

  async loadGame(slot: number) {
    const hero = this.saves?.file.slots[slot];
    if (!hero) throw new Error(`save slot ${slot + 1} is empty`);
    this.hero = hero;
    this.heroSlot = slot;
    this.ephemeralHero = false;
    await this.enterTown();
  }

  async enterTown() {
    if (!this.hero) this.hero = newHero();
    this.busy = true;
    try {
      this.mode = 'town';
      this.arena = false;
      this.trial = null;
      this.stageNo = 0;
      this.visits++;
      // Flasks refill in town.
      this.hero.flasks = [999, 999];
      await this.reset({ level: townLevel(), seed: this.seed });
      this.hero.flasks = [30, 30];
      this.sim.refreshHero();
      this.save();
      this.emit({ type: 'mode', mode: 'town', title: this.level.title, subtitle: this.level.subtitle });
    } finally {
      this.busy = false;
    }
  }

  /** Enters depth n (a prebuilt `custom` level replaces the campaign one: agent remixes). */
  async enterStage(n: number, custom?: Level) {
    if (!this.hero) this.hero = newHero();
    this.busy = true;
    try {
      const spec = campaignStage(n);
      const level = custom ?? generateDungeon(applyPactsToSpec(spec.dungeon, this.pacts));
      if (!custom) {
        spec.place?.(level);
        stampPacts(level, this.pacts);
      }
      // A way home near the entrance.
      const s = level.start!;
      level.props = [...(level.props ?? []), { id: 'town_portal', kind: 'portal', x: s.x - 1.6, z: s.z - 1.6, data: { to: 'town' } }];
      this.mode = 'dungeon';
      this.stageNo = n;
      this.arena = false;
      this.trial = null;
      await this.reset({ level, seed: level.seed ?? spec.dungeon.seed });
      const pactTip = level.pacts?.length ? ` Pacts: ${pactRewardText(level.pacts)}.` : '';
      this.emit({ type: 'mode', mode: 'dungeon', stage: n, title: level.title, subtitle: level.subtitle, mechanics: level.mechanics ?? [], pacts: level.pacts ?? [], tip: custom ? undefined : `${spec.tip ?? ''}${pactTip}` });
    } finally {
      this.busy = false;
    }
  }

  /** Today's Daily Trial at the hero's frontier (content/daily.ts). */
  async enterTrial(key = dateKey()) {
    if (!this.hero) this.hero = newHero();
    this.busy = true;
    try {
      const t = dailyTrial(key, this.hero.progress.unlocked);
      const level = buildTrialLevel(t);
      const s = level.start!;
      level.props = [...(level.props ?? []), { id: 'town_portal', kind: 'portal', x: s.x - 1.6, z: s.z - 1.6, data: { to: 'town' } }];
      this.mode = 'dungeon';
      this.stageNo = 0;
      this.arena = false;
      this.trial = t.key;
      await this.reset({ level, seed: level.seed });
      const best = this.hero.progress.trials[t.key];
      this.emit({ type: 'mode', mode: 'dungeon', stage: 0, title: level.title, subtitle: level.subtitle, mechanics: level.mechanics ?? [], pacts: level.pacts ?? [],
        tip: `Same trial for everyone today. ${best ? `Your best: ${fmtFrames(best)}.` : 'First clear of the day pays a hoard.'}` });
    } finally {
      this.busy = false;
    }
  }

  /**
   * The Proving Grounds: a small dungeon at the hero's level holding packs of one Workshop species
   * and its boss variant. Clearing it gives normal rewards but no campaign progress.
   */
  async enterArena(d: SpeciesDesign) {
    if (!this.hero) this.hero = newHero();
    registerDesign(d);
    this.busy = true;
    try {
      const L = this.hero.level;
      const spec = stageSpec(Math.max(1, Math.round((L - 1) / 2) + 1), {
        theme: 'ruins', layout: 'rooms', title: 'Proving Grounds', subtitle: `Test fight: ${d.name}`, boss: { def: monsterId(d, true), palette: d.palette },
      });
      spec.pool = { entries: [{ def: monsterId(d), weight: 1 }], palettes: [d.palette], magic: 0.2, rare: 0.1 };
      Object.assign(spec, { rooms: 5, cols: 44, rows: 44, monsterLevel: L, mechanics: [], seed: hashSeed('arena', d.id, L) });
      const level = generateDungeon(spec);
      const s = level.start!;
      level.props = [...(level.props ?? []), { id: 'town_portal', kind: 'portal', x: s.x - 1.6, z: s.z - 1.6, data: { to: 'town' } }];
      this.mode = 'dungeon';
      this.stageNo = 0;
      this.arena = true;
      await this.reset({ level, seed: spec.seed });
      this.emit({ type: 'mode', mode: 'dungeon', stage: 0, title: level.title, subtitle: level.subtitle, mechanics: [], tip: `${d.name} packs and their matriarch. The exit leads home.` });
    } finally {
      this.busy = false;
    }
  }

  async startSandbox() {
    this.arena = false;
    this.trial = null;
    this.mode = 'sandbox';
    this.stageNo = 0;
    await this.reset({ level: DEFAULT_LEVEL });
    this.emit({ type: 'mode', mode: 'sandbox', title: 'Training Room' });
  }

  save() {
    if (!this.hero || !this.saves || this.ephemeralHero) return;
    this.saves.saveHero(this.heroSlot, this.hero);
    this.emit({ type: 'saved' });
  }

  /** Turns the autopilot on (a bot plays the hero in real time and in `step`) or off. */
  setAutopilot(opts: BotOptions | null) {
    this.autopilotOpts = opts;
    this.bot = null;
    this.emit({ type: 'autopilot', on: !!opts });
  }

  get autopilot(): { on: boolean; goal: string; note: string } {
    return { on: !!this.autopilotOpts, goal: this.bot?.goal ?? 'idle', note: this.bot?.note ?? '' };
  }

  /** One sim frame, with the autopilot deciding the hero's input first. */
  private simStep() {
    if (this.autopilotOpts && this.sim.player && this.sim.hero) {
      if (!this.bot || this.bot.sim !== this.sim) this.bot = new Bot(this.sim, this.autopilotOpts);
      this.bot.think();
    }
    this.sim.step();
  }

  /** Resolves when no level transition is in flight (agents await this after stepping). */
  async idle() {
    while (this.transition) await this.transition;
  }

  private go(fn: () => Promise<void>) {
    if (this.transition) return;
    this.transition = fn().catch((e) => console.error(e)).finally(() => (this.transition = null));
  }

  /** Reacts to sim events: portals, stage clears, deaths. Forwards everything to listeners. */
  private pump() {
    const sim = this.sim;
    if (sim.lastEventSeq === this.lastSeq) return;
    for (const e of sim.eventsSince(this.lastSeq)) {
      for (const fn of this.listeners) fn(e);
      switch (e.type) {
        case 'portal.enter':
          if (e.to === 'town' || (e.to === 'next' && (this.arena || this.trial))) this.go(() => this.enterTown());
          else if (e.to === 'next') this.go(() => this.enterStage(this.stageNo + 1));
          break;
        case 'boss.dead': {
          const hero = this.hero;
          if (!hero || this.mode !== 'dungeon') break;
          if (this.trial) {
            const prev = hero.progress.trials[this.trial];
            const time = sim.stage.time;
            hero.progress.trials[this.trial] = Math.min(prev ?? Infinity, time);
            sim.stage.cleared = true;
            // The first clear of the day pays a pinnacle-grade hoard at the boss.
            const boss = sim.characters.get(String(e.id));
            if (prev === undefined && boss) dropPinnacle(sim, boss.pos.x, boss.pos.z, boss.level);
            this.save();
            this.emit({ type: 'stage.clear', stage: 0, trial: this.trial, first: prev === undefined, best: Math.min(prev ?? Infinity, time), time, kills: sim.stage.kills, gold: sim.stage.gold, xp: Math.round(sim.stage.xp), items: sim.stage.items, mechanicKills: sim.stage.mechanicKills });
            break;
          }
          if (this.arena) {
            sim.stage.cleared = true;
            this.save();
            this.emit({ type: 'stage.clear', stage: 0, arena: true, first: false, time: sim.stage.time, kills: sim.stage.kills, gold: sim.stage.gold, xp: Math.round(sim.stage.xp), items: sim.stage.items, mechanicKills: 0 });
            break;
          }
          const key = String(this.stageNo);
          const first = !(key in hero.progress.cleared);
          hero.progress.cleared[key] = Math.min(hero.progress.cleared[key] ?? Infinity, sim.stage.time);
          hero.progress.unlocked = Math.max(hero.progress.unlocked, this.stageNo + 1);
          hero.progress.endlessBest = Math.max(hero.progress.endlessBest, this.stageNo);
          sim.stage.cleared = true;
          if (first) sim.refreshHero();
          this.save();
          this.emit({ type: 'stage.clear', stage: this.stageNo, first, time: sim.stage.time, kills: sim.stage.kills, gold: sim.stage.gold, xp: Math.round(sim.stage.xp), items: sim.stage.items, mechanicKills: sim.stage.mechanicKills });
          break;
        }
        case 'levelup':
          this.save();
          break;
      }
    }
    this.lastSeq = sim.lastEventSeq;
    if (this.stage.views.size !== sim.characters.size || [...sim.characters.keys()].some((id) => !this.stage.views.has(id))) this.stage.syncRoster(sim);
  }

  // ---------------------------------------------------------------- loop

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

  /** Client (CSS pixel) position -> low-res target pixel. */
  toLowRes(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const p = this.pipeline;
    const dx = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const dy = ((clientY - rect.top) / rect.height) * this.canvas.height;
    return { x: Math.floor((dx + (p.width * p.scale - p.deviceW) / 2) / p.scale), y: Math.floor((dy + (p.height * p.scale - p.deviceH) / 2) / p.scale) };
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
    // Aim at chest height plane first (feels right for skills), fall back to the physics floor.
    const hit = this.sim.raycast(origin, dir);
    return hit;
  }

  /** Real-time loop tick. */
  advance(realDt: number) {
    this.lastRealDt = Math.min(0.1, realDt);
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (!this.paused && !this.busy) {
      this.acc += Math.min(realDt, 0.1) * config['sim.timeScale'];
      let n = 0;
      while (this.acc >= this.sim.dt && n < 6) {
        this.simStep();
        this.acc -= this.sim.dt;
        n++;
      }
      if (n === 6) this.acc = 0;
      if (n) this.pump();
      this.saveTimer += realDt;
      if (this.saveTimer > 30) {
        this.saveTimer = 0;
        this.save();
      }
    }
    this.render(this.paused ? 1 : this.acc / this.sim.dt, this.paused ? 0 : this.lastRealDt);
  }

  /** Advance exactly n sim frames (deterministic, independent of wall-clock), then draw. */
  /** The sim and frame of the last draw. */
  private drawn: { sim: Sim | null; frame: number } = { sim: null, frame: 0 };

  step(n = 1, draw = true) {
    for (let i = 0; i < n; i++) {
      if (this.busy) break;
      this.simStep();
      if (i % 30 === 29) this.pump();
    }
    this.pump();
    this.acc = 0;
    if (draw) this.render(1);
  }

  /**
   * Draws a frame. `dt` ages effects (trails, particles, floating numbers); without one it is the
   * sim time since the last draw, so a draw after a long headless step (an agent tool) shows
   * those effects as they would be now instead of all at once.
   */
  render(alpha = this.lastAlpha, dt?: number) {
    dt ??= this.drawn.sim === this.sim ? Math.max(0, this.sim.frame - this.drawn.frame) / 60 : 0;
    this.drawn = { sim: this.sim, frame: this.sim.frame };
    const t0 = performance.now();
    this.lastAlpha = alpha;
    this.renderer.info.reset();
    this.resize();
    this.stage.update(this.sim, alpha, this.pipeline, dt);
    if (this.backgroundKey !== this.level.background) {
      // The upscale pass mixes this into sRGB-encoded pixels, so keep the hex's raw components.
      this.backgroundKey = this.level.background;
      this.pipeline.background.setStyle(this.level.background, THREE.LinearSRGBColorSpace);
    }
    const sandbox = this.mode === 'sandbox';
    if (!sandbox) this.overlay.update(this.sim, this.stage, this.pipeline.width, this.pipeline.height, dt, this.overlayOptions);
    this.pipeline.render(this.stage.scene, this.stage.camera, { subPixel: this.stage.subPixel, overlay: sandbox ? null : this.overlay.texture });
    this.renderFrames++;
    this.needsRender = false;
    const info = this.renderer.info.render;
    this.frameStats.calls = info.calls;
    this.frameStats.triangles = info.triangles;
    this.frameStats.ms = performance.now() - t0;
  }
}
