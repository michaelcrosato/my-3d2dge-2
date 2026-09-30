/**
 * Human input for the demo: keyboard/mouse, gamepads (Gamepad API, polled per frame) and the touch
 * overlay, all resolved through the active profile's bindings. Agents never need this (in ?agent
 * mode it is not created). Input only writes the player's intent while a control is held or was
 * just released, so an agent driving the player through the API is not overridden.
 */
import { config, setConfig, type ConfigKey } from '../config';
import type { Game } from '../game';
import { PALETTE_NAMES } from '../render/palettes';
import { ACTIONS, HOLD_ACTIONS, type Action, type PadInput } from './actions';
import { actionsForCode, samePad, type Profile } from './profile';
import { combine, digitalMove, length, padValue, stickMove, ZERO, type Move, type PadState } from './resolve';
import type { SettingsStore } from './store';

export type Device = 'none' | 'keyboard' | 'mouse' | 'gamepad' | 'touch';
export type MenuNav = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'prevTab' | 'nextTab';

export interface ControllerHooks {
  menuOpen(): boolean;
  toggleMenu(): void;
  menuNav(cmd: MenuNav): void;
  reset(): void;
  toggleHelp(): void;
  toggleStats(): void;
  message(text: string): void;
  sprintLatched(on: boolean): void;
}

type Capture = { kind: 'keys'; done(code: string | null): void } | { kind: 'pad'; done(input: PadInput | null): void };

const TOGGLES: Partial<Record<Action, ConfigKey>> = {
  togglePixel: 'render.pixelMode',
  toggleOutlines: 'render.outlines',
  toggleCreases: 'render.innerLines',
  toggleSnap: 'render.snapMovers',
  toggleSmoothScroll: 'render.smoothScroll',
  toggleStepped: 'anim.stepped',
  toggleDir8: 'anim.dir8',
  toggleSilhouettes: 'render.silhouettes',
  toggleColliders: 'render.colliders',
  toggleShadows: 'render.shadows',
};
const ANIM_FPS: Partial<Record<Action, number>> = { animFps6: 6, animFps8: 8, animFps12: 12, animFps24: 24 };

/** Raw gamepad inputs worth reporting while capturing a binding or navigating the menu. */
const AXIS_CAPTURE = 0.6;
const padKey = (p: PadInput) => (p.kind === 'button' ? `b${p.index}` : `a${p.index}${p.dir > 0 ? '+' : '-'}`);

function activeInputs(pad: PadState, threshold: number): PadInput[] {
  const out: PadInput[] = [];
  pad.buttons.forEach((b, index) => b.pressed && out.push({ kind: 'button', index }));
  pad.axes.forEach((v, index) => {
    if (v > threshold) out.push({ kind: 'axis', index, dir: 1 });
    else if (v < -threshold) out.push({ kind: 'axis', index, dir: -1 });
  });
  return out;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

export class InputController {
  device: Device = 'none';
  readonly deviceListeners = new Set<(d: Device) => void>();
  /** Keyboard codes and `MouseN` buttons currently down. */
  private held = new Set<string>();
  private touchMove: Move = ZERO;
  private touchSprint = false;
  private sprintLatch = false;
  private padHeld = new Set<Action>();
  private padStick: Move = ZERO;
  private padPrev = new Map<number, Set<string>>();
  private capture: Capture | null = null;
  private wasActive = false;
  private pointer: { x: number; y: number } | null = null;
  private eventSeq = 0;
  private sim: unknown = null;

  constructor(private game: Game, private store: SettingsStore, private hooks: ControllerHooks) {}

  private get profile(): Profile {
    return this.store.active;
  }

  private setDevice(d: Device) {
    if (d === this.device) return;
    this.device = d;
    for (const fn of this.deviceListeners) fn(d);
  }

  private player() {
    return this.game.sim.characters.get(this.game.stage.follow);
  }

  attach() {
    // Capture phase: rebinding and the menu key must see keys before the dialog's own handlers.
    window.addEventListener('keydown', (e) => this.onKey(e, true), true);
    window.addEventListener('keyup', (e) => this.onKey(e, false), true);
    window.addEventListener('blur', () => this.onBlur());
    document.addEventListener('visibilitychange', () => document.hidden && this.onBlur());
    // Capture-phase listener so a binding can be captured even while the pointer is over the dialog.
    window.addEventListener('pointerdown', (e) => {
      if (this.capture?.kind === 'keys' && e.pointerType !== 'touch') {
        e.preventDefault();
        e.stopPropagation();
        this.finishCapture(`Mouse${e.button}`);
      }
    }, true);
    window.addEventListener('wheel', (e) => {
      if (this.capture?.kind !== 'keys') return;
      e.preventDefault();
      e.stopPropagation();
      this.finishCapture(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
    }, { capture: true, passive: false });
    const canvas = this.game.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.setDevice('touch');
        return;
      }
      this.pointer = { x: e.clientX, y: e.clientY };
      this.setDevice('mouse');
      this.codeDown(`Mouse${e.button}`);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') this.held.delete(`Mouse${e.button}`);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (this.hooks.menuOpen()) return;
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      if (actionsForCode(this.profile.keys, code).length) e.preventDefault();
      this.pointer = { x: e.clientX, y: e.clientY };
      this.pressCode(code);
    }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => this.hooks.message(`Controller connected: ${e.gamepad.id.replace(/\s*\(.*\)\s*$/, '') || 'gamepad'}`));
    window.addEventListener('gamepaddisconnected', () => {
      this.hooks.message('Controller disconnected');
      if (this.device === 'gamepad' && !this.game.paused && !this.hooks.menuOpen()) this.game.paused = true;
      this.padHeld.clear();
      this.padStick = ZERO;
    });
  }

  // ---------------------------------------------------------------- capture (rebinding)

  captureNext(kind: 'keys', done: (code: string | null) => void): void;
  captureNext(kind: 'pad', done: (input: PadInput | null) => void): void;
  captureNext(kind: 'keys' | 'pad', done: (v: never) => void) {
    this.cancelCapture();
    this.capture = { kind, done } as Capture;
    // Inputs already held when capture starts (the click or button that opened it) are ignored.
    this.padPrev.forEach((_, i) => this.padPrev.set(i, new Set(this.rawPad(i).map(padKey))));
  }

  get capturing() {
    return this.capture !== null;
  }

  cancelCapture() {
    const c = this.capture;
    this.capture = null;
    c?.done(null as never);
  }

  private finishCapture(v: string | PadInput) {
    const c = this.capture;
    this.capture = null;
    if (c?.kind === 'keys' && typeof v === 'string') c.done(v);
    else if (c?.kind === 'pad' && typeof v !== 'string') c.done(v);
  }

  // ---------------------------------------------------------------- keyboard / mouse

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!down) {
      this.held.delete(e.code);
      return;
    }
    if (this.capture?.kind === 'keys') {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') this.cancelCapture();
      else if (e.code) this.finishCapture(e.code);
      return;
    }
    if (this.capture?.kind === 'pad' && e.code === 'Escape') {
      e.preventDefault();
      this.cancelCapture();
      return;
    }
    if (this.hooks.menuOpen()) {
      // The dialog handles its own keys; only the menu binding (Esc by default) closes it.
      if (!e.repeat && this.profile.keys.menu.includes(e.code) && !isTyping(e.target)) {
        e.preventDefault();
        this.hooks.toggleMenu();
      }
      return;
    }
    if (isTyping(e.target)) return;
    const bound = actionsForCode(this.profile.keys, e.code);
    if (bound.length || e.code === 'Tab' || e.altKey) e.preventDefault();
    this.setDevice('keyboard');
    this.held.add(e.code);
    if (!e.repeat) for (const a of bound) this.press(a);
  }

  private codeDown(code: string) {
    if (this.hooks.menuOpen()) return;
    this.held.add(code);
    this.pressCode(code);
  }

  private pressCode(code: string) {
    for (const a of actionsForCode(this.profile.keys, code)) this.press(a);
  }

  private onBlur() {
    this.held.clear();
    this.touchMove = ZERO;
    this.touchSprint = false;
    if (this.profile.prefs.pauseOnBlur && !this.game.paused && !this.hooks.menuOpen()) this.game.paused = true;
  }

  private keyHeld(a: Action) {
    for (const code of this.profile.keys[a]) if (this.held.has(code)) return true;
    return false;
  }

  // ---------------------------------------------------------------- touch (called by the overlay)

  touchMoveTo(m: Move) {
    this.setDevice('touch');
    this.touchMove = m;
  }

  touchPress(action: 'jump' | 'attack' | 'sprint') {
    this.setDevice('touch');
    if (action === 'sprint') this.toggleSprintLatch();
    else this.press(action);
  }

  touchHold(on: boolean) {
    this.setDevice('touch');
    this.touchSprint = on;
  }

  // ---------------------------------------------------------------- gamepads

  private pads(): Gamepad[] {
    try {
      return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);
    } catch {
      return [];
    }
  }

  private rawPad(index: number): PadInput[] {
    const pad = this.pads().find((p) => p.index === index);
    return pad ? activeInputs(pad, AXIS_CAPTURE) : [];
  }

  /** Connected gamepads (for the settings screen). */
  connectedPads(): Gamepad[] {
    return this.pads();
  }

  private pollPads() {
    const { pad: bindings, padOptions: opt } = this.profile;
    this.padHeld.clear();
    let stick: Move = ZERO;
    for (const pad of this.pads()) {
      const raw = activeInputs(pad, AXIS_CAPTURE);
      const now = new Set(raw.map(padKey));
      const prev = this.padPrev.get(pad.index) ?? new Set<string>();
      this.padPrev.set(pad.index, now);
      const fresh = raw.filter((p) => !prev.has(padKey(p)));
      if (fresh.length) this.setDevice('gamepad');
      if (this.capture?.kind === 'pad') {
        if (fresh.length) this.finishCapture(fresh[0]);
        continue;
      }
      if (this.capture) continue;
      if (this.hooks.menuOpen()) {
        for (const p of fresh) this.menuNav(p, opt.stick);
        continue;
      }
      const ax = opt.stick === 'left' ? 0 : 2;
      const s = stickMove(pad.axes[ax] ?? 0, pad.axes[ax + 1] ?? 0, opt.deadzone, opt.analog);
      if (length(s) > length(stick)) stick = s;
      for (const a of ACTIONS) {
        const list = bindings[a];
        if (!list.length) continue;
        if (HOLD_ACTIONS.has(a) && list.some((p) => padValue(pad, p) > 0)) this.padHeld.add(a);
        if (list.some((p) => fresh.some((q) => samePad(p, q)))) this.press(a);
      }
    }
    this.padStick = stick;
  }

  private menuNav(p: PadInput, stick: 'left' | 'right') {
    const ax = stick === 'left' ? 0 : 2;
    const cmd: MenuNav | null =
      p.kind === 'button'
        ? ({ 0: 'confirm', 1: 'back', 9: 'back', 4: 'prevTab', 5: 'nextTab', 12: 'up', 13: 'down', 14: 'left', 15: 'right' } as Record<number, MenuNav>)[p.index] ?? null
        : p.index === ax + 1 ? (p.dir < 0 ? 'up' : 'down') : p.index === ax ? (p.dir < 0 ? 'left' : 'right') : null;
    if (cmd === 'back' && p.kind === 'button' && p.index === 9) this.hooks.toggleMenu();
    else if (cmd) this.hooks.menuNav(cmd);
  }

  /** Rumble / vibrate on hits involving the player. */
  private feedback() {
    const sim = this.game.sim;
    if (sim !== this.sim) {
      this.sim = sim;
      this.eventSeq = sim.lastEventSeq;
      return;
    }
    if (sim.lastEventSeq === this.eventSeq) return;
    const follow = this.game.stage.follow;
    for (const e of sim.eventsSince(this.eventSeq)) {
      if (e.type !== 'hit' || (e.attacker !== follow && e.target !== follow)) continue;
      const hurt = e.target === follow;
      const heavy = !!e.heavy;
      if (this.device === 'gamepad' && this.profile.padOptions.vibration) {
        for (const pad of this.pads()) {
          const act = (pad as Gamepad & { vibrationActuator?: { playEffect?(t: string, p: object): Promise<unknown> } }).vibrationActuator;
          act?.playEffect?.('dual-rumble', { duration: heavy ? 160 : 90, strongMagnitude: hurt ? 0.9 : 0.35, weakMagnitude: heavy ? 0.8 : 0.5 })?.catch(() => {});
        }
      } else if (this.device === 'touch' && this.profile.touch.haptics) {
        try {
          navigator.vibrate?.(hurt ? 45 : heavy ? 30 : 15);
        } catch {
          // Vibration can be blocked by policy; it is optional feedback.
        }
      }
    }
    this.eventSeq = sim.lastEventSeq;
  }

  // ---------------------------------------------------------------- actions

  private toggleSprintLatch() {
    this.sprintLatch = !this.sprintLatch;
    this.hooks.sprintLatched(this.sprintLatch);
  }

  /** One press of an action from any device. */
  press(a: Action) {
    const ch = this.player();
    const toggle = TOGGLES[a];
    if (toggle) {
      setConfig(toggle, !config[toggle]);
      return;
    }
    if (ANIM_FPS[a]) {
      setConfig('anim.fps', ANIM_FPS[a]);
      return;
    }
    switch (a) {
      case 'jump':
        if (ch) ch.input.jump = true;
        break;
      case 'attack':
        if (ch) ch.input.attack = true;
        break;
      case 'sprint':
        if (this.profile.prefs.sprintToggle) this.toggleSprintLatch();
        break;
      case 'menu':
        this.hooks.toggleMenu();
        break;
      case 'pause':
        this.game.paused = !this.game.paused;
        this.held.clear();
        break;
      case 'step':
        this.game.step(1);
        break;
      case 'reset':
        this.held.clear();
        this.hooks.reset();
        break;
      case 'help':
        this.hooks.toggleHelp();
        break;
      case 'stats':
        this.hooks.toggleStats();
        break;
      case 'cyclePalette': {
        const i = PALETTE_NAMES.indexOf(config['render.palette'] as (typeof PALETTE_NAMES)[number]);
        setConfig('render.palette', PALETTE_NAMES[(i + 1) % PALETTE_NAMES.length]);
        break;
      }
      case 'moveTo':
        this.moveToPointer();
        break;
      default:
        break;
    }
  }

  /** Route the player to the floor point under the mouse (Rapier ray cast through the pixel camera). */
  private moveToPointer() {
    const ch = this.player();
    if (!ch || !this.pointer) return;
    const hit = this.game.pick(this.pointer.x, this.pointer.y);
    if (!hit) return;
    try {
      this.game.sim.moveTo(ch.id, hit.x, hit.z, this.isHeld('sprint') ? 'sprint' : 'run');
    } catch {
      this.hooks.message('No path to that spot');
    }
  }

  private isHeld(a: Action) {
    return this.keyHeld(a) || this.padHeld.has(a) || (a === 'sprint' && this.touchSprint);
  }

  /** Call once per rendered frame. */
  update() {
    this.pollPads();
    this.feedback();
    const ch = this.player();
    if (!ch || this.hooks.menuOpen() || this.capture) {
      if (ch && this.wasActive) this.release(ch);
      return;
    }
    const keys = digitalMove(this.isHeld('moveUp'), this.isHeld('moveDown'), this.isHeld('moveLeft'), this.isHeld('moveRight'));
    const move = combine([keys, this.padStick, this.touchMove]);
    const active = length(move) > 0.01;
    if (!active && this.sprintLatch) {
      this.sprintLatch = false;
      this.hooks.sprintLatched(false);
    }
    if (!active && !this.wasActive) return;
    if (!active) {
      this.release(ch);
      return;
    }
    this.wasActive = true;
    const b = this.game.stage.basis;
    ch.input.moveX = b.groundRight.x * move.x + b.groundUp.x * move.y;
    ch.input.moveZ = b.groundRight.z * move.x + b.groundUp.z * move.y;
    ch.input.gait = this.isHeld('sprint') || this.sprintLatch ? 'sprint' : this.isHeld('walk') ? 'walk' : 'run';
    ch.inputFrames = -1;
    ch.order = null;
  }

  private release(ch: NonNullable<ReturnType<InputController['player']>>) {
    this.wasActive = false;
    ch.input.moveX = 0;
    ch.input.moveZ = 0;
    ch.inputFrames = -1;
  }
}
