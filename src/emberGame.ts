import { Run, type Intent, type Tuning, type RunCheckpoint } from "./sim/run";
import { initPhysics } from "./sim/sim";
import { freshProfile, parseProfile, type Profile } from "./sim/progression";
import { EmberStage } from "./render/emberStage";
import {
  TREE,
  SKILLS,
  MONSTERS,
  MECHANICS,
  KEYSTONES,
  THEMES,
  type SkillId,
  type CameraMode,
} from "./content/emberdeep";
export type Command =
  | { type: "input"; value: Intent }
  | { type: "enter"; depth: number }
  | { type: "town" | "interact" | "refund" }
  | { type: "learn" | "keystone" | "equip" | "salvage" | "service"; id: string }
  | { type: "master"; skill: SkillId }
  | { type: "slot"; index: number; skill: SkillId }
  | { type: "camera"; mode: CameraMode }
  | { type: "tune"; values: Partial<Tuning> }
  | { type: "auto" | "invulnerable"; value: boolean };
export interface Replay {
  version: 1;
  seed: number;
  profile: Profile;
  baseline?: SerializedCheckpoint;
  commands: { tick: number; command: Command }[];
  tick: number;
  hash: string;
}
export type SerializedCheckpoint = Omit<RunCheckpoint, "physics"> & {
  physics: Omit<RunCheckpoint["physics"], "world"> & { world: number[] };
};
export const serializeCheckpoint = (
  cp: RunCheckpoint,
): SerializedCheckpoint => ({
  ...cp,
  physics: { ...cp.physics, world: Array.from(cp.physics.world) },
});
export const deserializeCheckpoint = (
  cp: SerializedCheckpoint,
): RunCheckpoint => {
  if (
    !cp?.physics ||
    !Array.isArray(cp.physics.world) ||
    cp.physics.world.length > 16000000 ||
    cp.physics.world.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  )
    throw new Error("Invalid physics checkpoint.");
  return {
    ...cp,
    physics: { ...cp.physics, world: new Uint8Array(cp.physics.world) },
  };
};
export function execute(run: Run, command: Command) {
  if (!command || typeof command !== "object")
    throw new Error("A command object is required.");
  switch (command.type) {
    case "input":
      run.setIntent(command.value);
      break;
    case "enter":
      run.enter(command.depth);
      break;
    case "town":
      run.enter(0);
      break;
    case "interact":
      run.interact();
      break;
    case "learn":
      run.learn(command.id);
      break;
    case "keystone":
      run.keystone(command.id);
      break;
    case "equip":
      run.equip(command.id);
      break;
    case "salvage":
      run.salvage(command.id);
      break;
    case "service":
      run.service(command.id);
      break;
    case "refund":
      run.refund();
      break;
    case "master":
      run.master(command.skill);
      break;
    case "slot":
      run.slot(command.index, command.skill);
      break;
    case "camera":
      if (!["iso", "side", "top"].includes(command.mode))
        throw new Error("Camera must be iso, side, or top.");
      run.camera = command.mode;
      break;
    case "tune":
      run.tune(command.values);
      break;
    case "auto":
    case "invulnerable":
      if (typeof command.value !== "boolean")
        throw new Error("A boolean value is required.");
      run[command.type] = command.value;
      break;
    default:
      throw new Error("Unknown command.");
  }
}
export function replayRun(tape: Replay) {
  if (
    !tape ||
    tape.version !== 1 ||
    !Number.isSafeInteger(tape.seed) ||
    !Array.isArray(tape.commands) ||
    tape.commands.length > 100000 ||
    !Number.isInteger(tape.tick) ||
    tape.tick < 0 ||
    tape.tick > 1000000
  )
    throw new Error("Invalid replay.");
  const run = new Run(tape.seed, parseProfile(tape.profile));
  try {
    if (tape.baseline) run.restore(deserializeCheckpoint(tape.baseline));
    if (run.tick > tape.tick)
      throw new Error("Replay ends before its baseline.");
    for (const row of tape.commands) {
      if (
        !Number.isInteger(row.tick) ||
        row.tick < run.tick ||
        row.tick > tape.tick
      )
        throw new Error("Invalid command tick.");
      run.step(row.tick - run.tick);
      execute(run, row.command);
    }
    while (run.tick < tape.tick)
      run.step(Math.min(100000, tape.tick - run.tick));
    return {
      matches: run.hash() === tape.hash,
      expected: tape.hash,
      hash: run.hash(),
      state: run.observe(),
    };
  } finally {
    run.dispose();
  }
}
export class EmberGame {
  run!: Run;
  stage: EmberStage;
  ready = false;
  paused = false;
  private accum = 0;
  private commands: Replay["commands"] = [];
  private initialProfile: Profile;
  private baseline?: SerializedCheckpoint;
  private recovering = false;
  private disposed = false;
  private loop: ((time: number) => void) | null = null;
  constructor(
    canvas: HTMLCanvasElement,
    readonly seed: number,
    readonly agentMode: boolean,
    profile = freshProfile(),
  ) {
    this.initialProfile = parseProfile(profile);
    this.stage = new EmberStage(canvas);
  }
  async init() {
    await initPhysics();
    this.run = new Run(this.seed, this.initialProfile);
    await this.stage.init();
    this.installRecovery();
    this.stage.draw(this.run);
    this.ready = true;
  }
  private installRecovery() {
    this.stage.renderer.onDeviceLost = () => {
      if (!this.disposed) void this.recover();
    };
  }
  private async recover() {
    if (this.recovering) return;
    this.recovering = true;
    this.ready = false;
    this.run.emit("render.device_lost");
    try {
      const old = this.stage,
        canvas = old.canvas.cloneNode(false) as HTMLCanvasElement;
      old.canvas.replaceWith(canvas);
      old.dispose();
      this.stage = new EmberStage(canvas, true);
      await this.stage.init();
      this.installRecovery();
      if (this.loop) this.stage.renderer.setAnimationLoop(this.loop);
      this.stage.draw(this.run);
      this.ready = true;
      this.run.emit("render.recovered", { backend: "WebGL2" });
    } catch (error) {
      this.run.emit("render.failed", { error: String(error) });
      const loading =
        document.getElementById("loading") ??
        document.body.appendChild(document.createElement("p"));
      loading.textContent = "Renderer recovery failed.";
    } finally {
      this.recovering = false;
    }
  }
  setLoop(loop: (time: number) => void) {
    this.loop = loop;
    this.stage.renderer.setAnimationLoop(loop);
  }
  act(command: Command) {
    if (!this.ready) return { ok: false, error: "Game is not ready." };
    try {
      execute(this.run, command);
      this.commands.push({
        tick: this.run.tick,
        command: structuredClone(command),
      });
      this.stage.draw(this.run);
      this.saveLocal();
      return { ok: true, tick: this.run.tick, hash: this.run.hash() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        tick: this.run.tick,
      };
    }
  }
  step(frames = 1) {
    if (!this.ready) throw new Error("Game is not ready.");
    const state = this.run.step(frames);
    this.stage.draw(this.run);
    return state;
  }
  update(dt: number) {
    if (!this.ready || this.agentMode || this.paused) return;
    this.accum = Math.min(0.15, this.accum + dt);
    while (this.accum >= 1 / 60) {
      this.run.step(1);
      this.accum -= 1 / 60;
    }
    if (this.run.tick % 240 === 0) this.saveLocal();
  }
  saveLocal() {
    if (this.agentMode) return;
    try {
      localStorage.setItem(
        "emberdeep.profile.v1",
        JSON.stringify(this.run.profile),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  load(profile: unknown) {
    const valid = parseProfile(profile);
    this.run.profile = valid;
    this.run.enter(0);
    this.initialProfile = structuredClone(valid);
    this.commands = [];
    this.baseline = serializeCheckpoint(this.run.checkpoint());
    this.stage.draw(this.run);
    return this.run.observe();
  }
  restore(cp: SerializedCheckpoint) {
    this.run.restore(deserializeCheckpoint(cp));
    this.commands = [];
    this.initialProfile = structuredClone(this.run.profile);
    this.baseline = serializeCheckpoint(this.run.checkpoint());
    this.stage.draw(this.run);
    return this.run.observe();
  }
  exportReplay(): Replay {
    return {
      version: 1,
      seed: this.seed,
      profile: structuredClone(this.initialProfile),
      ...(this.baseline ? { baseline: structuredClone(this.baseline) } : {}),
      commands: structuredClone(this.commands),
      tick: this.run.tick,
      hash: this.run.hash(),
    };
  }
  api() {
    const game = this;
    return {
      get ready() {
        return game.ready;
      },
      schema: () => ({
        version: 1,
        hz: 60,
        coordinates: "meters; X east, Y up, Z south",
        input:
          "Required x,z in -1..1; optional world aim, held attack, one-shot dash/potion/interact/skill",
        commands: [
          "input",
          "enter",
          "town",
          "interact",
          "learn",
          "keystone",
          "master",
          "slot",
          "equip",
          "salvage",
          "service",
          "refund",
          "camera",
          "tune",
          "auto",
          "invulnerable",
        ],
        limits: {
          step: 100000,
          depth: 1000000,
          inventory: 80,
          events: 512,
          actors: 80,
        },
      }),
      content: () =>
        structuredClone({
          tree: TREE,
          skills: SKILLS,
          monsters: MONSTERS,
          mechanics: MECHANICS,
          keystones: KEYSTONES,
          themes: THEMES,
        }),
      observe: () => game.run.observe(),
      act: (c: Command) => game.act(c),
      step: (n = 1) => game.step(n),
      events: (after = 0) =>
        structuredClone(game.run.events.filter((e) => e.seq > after)),
      checkpoint: () => serializeCheckpoint(game.run.checkpoint()),
      restore: (cp: SerializedCheckpoint) => game.restore(cp),
      save: () => structuredClone(game.run.profile),
      load: (p: unknown) => game.load(p),
      exportReplay: () => game.exportReplay(),
      replay: (tape: Replay) => replayRun(tape),
    };
  }
  dispose() {
    this.disposed = true;
    this.saveLocal();
    this.stage.dispose();
    this.run.dispose();
  }
}
