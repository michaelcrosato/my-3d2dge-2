/**
 * Human input: keyboard/mouse, gamepads (Gamepad API, polled per frame) and the touch overlay,
 * all resolved through the active profile's bindings. Agents never need this (in ?agent mode it
 * is not created). Each frame it writes the hero's intent: movement, held attack / skill slots,
 * the aim point (mouse cursor on the ground or right-stick direction) and one-shot presses
 * (dodge, skills, flasks, interact). Clicking a loot label picks it up; clicking a townsperson
 * walks over and talks.
 */
import { config, setConfig, type ConfigKey } from '../config';
import type { Game } from '../game';
import { PALETTE_NAMES } from '../render/palettes';
import type { P2 } from '../sim/nav';
import { ACTIONS, HOLD_ACTIONS, SKILL_ACTIONS, type Action, type PadInput } from './actions';
import { actionsForCode, samePad, type Profile, type TouchControl } from './profile';
import { combine, digitalMove, length, padValue, stickMove, ZERO, type Move, type PadState } from './resolve';
import type { SettingsStore } from './store';

export type Device = 'none' | 'keyboard' | 'mouse' | 'gamepad' | 'touch';
export type MenuNav = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'prevTab' | 'nextTab';
export type PanelName = 'inventory' | 'tree' | 'character';

export interface ControllerHooks {
  menuOpen(): boolean;
  toggleMenu(): void;
  menuNav(cmd: MenuNav): void;
  reset(): void;
  toggleHelp(): void;
  toggleStats(): void;
  message(text: string): void;
  sprintLatched(on: boolean): void;
  togglePanel(p: PanelName): void;
  townPortal(): void;
  /** A game panel (not settings / pause / title) is the open dialog. */
  panelOpen?(): boolean;
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
  private touchHeld = new Set<TouchControl>();
  private sprintLatch = false;
  private padHeld = new Set<Action>();
  private padStick: Move = ZERO;
  private padAim: Move = ZERO;
  private padPrev = new Map<number, Set<string>>();
  private capture: Capture | null = null;
  private wasActive = false;
  private pointer: { x: number; y: number } | null = null;
  private pointerInCanvas = false;
  private eventSeq = 0;
  private sim: unknown = null;
  /** Walking toward an NPC / prop clicked from afar; interacts on arrival. */
  private pendingInteract: { x: number; z: number; frames: number } | null = null;

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

  /** Pointer position in low-res target pixels (overlay hover). */
  pointerLowRes(): { x: number; y: number } | null {
    if (!this.pointer || !this.pointerInCanvas || this.device === 'touch') return null;
    return this.game.toLowRes(this.pointer.x, this.pointer.y);
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
      this.pointer = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'touch') {
        this.setDevice('touch');
        // Tapping a loot label or a townsperson works on touch screens too.
        this.clickWorld(e.clientX, e.clientY, true);
        return;
      }
      this.setDevice('mouse');
      if (e.button === 0 && this.clickWorld(e.clientX, e.clientY, false)) return;
      this.codeDown(`Mouse${e.button}`);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') this.held.delete(`Mouse${e.button}`);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') {
        this.pointer = { x: e.clientX, y: e.clientY };
        this.pointerInCanvas = true;
      }
    });
    canvas.addEventListener('pointerleave', () => (this.pointerInCanvas = false));
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
      if (this.device === 'gamepad' && !this.game.paused && !this.hooks.menuOpen()) this.hooks.toggleMenu();
      this.padHeld.clear();
      this.padStick = ZERO;
    });
  }

  /**
   * Clicks on the world that aren't attacks: loot labels, and townsfolk / interactive props
   * under the cursor. Returns true when the click was consumed.
   */
  private clickWorld(clientX: number, clientY: number, touch: boolean): boolean {
    const game = this.game;
    if (this.hooks.menuOpen()) return false;
    const low = game.toLowRes(clientX, clientY);
    if (low) {
      const id = game.overlay.labelAt(low.x, low.y);
      if (id !== null) {
        game.sim.pickUp(id);
        return true;
      }
    }
    const hit = game.pick(clientX, clientY);
    const hero = this.player();
    if (!hit || !hero) return false;
    let target: { x: number; z: number } | null = null;
    for (const o of game.sim.characters.values()) {
      if (!o.npc || o.state === 'dead') continue;
      if (Math.hypot(o.pos.x - hit.x, o.pos.z - hit.z) < 1.1) target = { x: o.pos.x, z: o.pos.z };
    }
    if (!target) for (const p of game.sim.props.values()) {
      if (p.dead || p.state === 'used') continue;
      if (!['waypoint', 'stash', 'anvil', 'shrine_respec', 'portal', 'chest'].includes(p.kind)) continue;
      if (Math.hypot(p.x - hit.x, p.z - hit.z) < 1.3) target = { x: p.x, z: p.z };
    }
    if (!target) return false;
    const d = Math.hypot(target.x - hero.pos.x, target.z - hero.pos.z);
    if (d < 2.4) hero.input.interact = true;
    else {
      try {
        game.sim.moveTo(hero.id, target.x, target.z);
        this.pendingInteract = { x: target.x, z: target.z, frames: 600 };
      } catch {
        return false;
      }
    }
    void touch;
    return true;
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
      // The dialog handles its own keys; the menu binding (Esc by default) closes it and the
      // panel keys switch between game panels.
      if (e.repeat || isTyping(e.target)) return;
      if (this.profile.keys.menu.includes(e.code)) {
        e.preventDefault();
        this.hooks.toggleMenu();
        return;
      }
      for (const a of ['inventory', 'tree', 'character'] as const)
        if (this.profile.keys[a].includes(e.code) && this.hooks.panelOpen?.()) {
          e.preventDefault();
          this.hooks.togglePanel(a);
          return;
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
    this.touchHeld.clear();
    if (this.profile.prefs.pauseOnBlur && !this.game.paused && !this.hooks.menuOpen() && this.game.mode !== 'title') this.hooks.toggleMenu();
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

  touchPress(c: TouchControl) {
    this.setDevice('touch');
    if (c === 'sprint') this.toggleSprintLatch();
    else if (c !== 'move') this.press(c as Action);
  }

  touchHold(c: TouchControl, on: boolean) {
    this.setDevice('touch');
    if (c === 'sprint') this.touchSprint = on;
    else if (on) this.touchHeld.add(c);
    else this.touchHeld.delete(c);
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
    let aim: Move = ZERO;
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
      // The other stick aims (twin-stick style).
      const bx = opt.stick === 'left' ? 2 : 0;
      const a = stickMove(pad.axes[bx] ?? 0, pad.axes[bx + 1] ?? 0, 0.35, false);
      if (length(a) > length(aim)) aim = a;
      for (const act of ACTIONS) {
        const list = bindings[act];
        if (!list.length) continue;
        if (HOLD_ACTIONS.has(act) && list.some((p) => padValue(pad, p) > 0)) this.padHeld.add(act);
        if (list.some((p) => fresh.some((q) => samePad(p, q)))) this.press(act);
      }
      // D-pad also moves when it isn't bound to anything else.
      const dpad = digitalMove(!!pad.buttons[12]?.pressed && !bindings.flask2.length, !!pad.buttons[13]?.pressed && !bindings.flask1.length, false, false);
      if (length(dpad) > length(stick)) stick = dpad;
    }
    this.padStick = stick;
    this.padAim = aim;
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
      if (!hurt && !heavy) continue;
      if (this.device === 'gamepad' && this.profile.padOptions.vibration) {
        for (const pad of this.pads()) {
          const act = (pad as Gamepad & { vibrationActuator?: { playEffect?(t: string, p: object): Promise<unknown> } }).vibrationActuator;
          act?.playEffect?.('dual-rumble', { duration: heavy ? 160 : 90, strongMagnitude: hurt ? 0.9 : 0.35, weakMagnitude: heavy ? 0.8 : 0.5 })?.catch(() => {});
        }
      } else if (this.device === 'touch' && this.profile.touch.haptics) {
        try {
          navigator.vibrate?.(hurt ? 45 : 25);
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
    const skill = SKILL_ACTIONS.indexOf(a as (typeof SKILL_ACTIONS)[number]);
    if (skill >= 0) {
      if (ch) {
        ch.input.skill = skill;
        ch.input.aim = this.aimPoint();
      }
      return;
    }
    switch (a) {
      case 'jump':
        if (ch) ch.input.jump = true;
        break;
      case 'attack':
        if (ch) {
          ch.input.attack = true;
          ch.input.aim = this.aimPoint();
        }
        break;
      case 'dodge':
        if (ch) {
          ch.input.dodge = true;
          ch.input.aim = this.aimPoint();
        }
        break;
      case 'flask1':
      case 'flask2':
        if (ch) ch.input.flask = a === 'flask1' ? 0 : 1;
        break;
      case 'interact':
        if (ch) ch.input.interact = true;
        break;
      case 'inventory':
      case 'tree':
      case 'character':
        this.hooks.togglePanel(a);
        break;
      case 'townPortal':
        this.hooks.townPortal();
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

  /** Where attacks and skills aim: the ground under the mouse, or the right stick's direction. */
  private aimPoint(): P2 | null {
    const ch = this.player();
    if (!ch) return null;
    if (this.device === 'gamepad' && length(this.padAim) > 0.3) {
      const b = this.game.stage.basis;
      const x = b.groundRight.x * this.padAim.x + b.groundUp.x * this.padAim.y;
      const z = b.groundRight.z * this.padAim.x + b.groundUp.z * this.padAim.y;
      const l = Math.hypot(x, z) || 1;
      return { x: ch.pos.x + (x / l) * 6, z: ch.pos.z + (z / l) * 6 };
    }
    if (this.device !== 'mouse' && this.device !== 'keyboard') return null;
    if (!this.pointer || !this.pointerInCanvas) return null;
    const hit = this.game.pick(this.pointer.x, this.pointer.y);
    return hit ? { x: hit.x, z: hit.z } : null;
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
    return this.keyHeld(a) || this.padHeld.has(a) || (a === 'sprint' && this.touchSprint) || this.touchHeld.has(a as TouchControl);
  }

  /** Call once per rendered frame. */
  update() {
    this.pollPads();
    this.feedback();
    const ch = this.player();
    if (!ch || this.hooks.menuOpen() || this.capture) {
      if (ch && this.wasActive) this.release(ch);
      if (ch) {
        ch.input.attackHeld = false;
        ch.input.skillHeld = 0;
      }
      return;
    }
    // Held attack / skills, and the aim that goes with them.
    const attackHeld = this.isHeld('attack');
    let skillHeld = 0;
    SKILL_ACTIONS.forEach((a, i) => this.isHeld(a) && (skillHeld |= 1 << i));
    ch.input.attackHeld = attackHeld;
    ch.input.skillHeld = skillHeld;
    if (attackHeld || skillHeld) ch.input.aim = this.aimPoint();
    if (this.pendingInteract) {
      const p = this.pendingInteract;
      if (--p.frames <= 0 || !ch.order) {
        if (Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) < 2.6) ch.input.interact = true;
        this.pendingInteract = null;
      } else if (Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) < 2) {
        ch.order = null;
        ch.input.interact = true;
        this.pendingInteract = null;
      }
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
    this.pendingInteract = null;
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
