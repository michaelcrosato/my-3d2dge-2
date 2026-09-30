/**
 * Settings profiles: named, switchable configurations holding control bindings for keyboard/mouse,
 * gamepad and touch (separate 9:16 portrait and 16:9 landscape layouts), preferences and graphics
 * overrides. Pure data + validation (no DOM), so Node tests cover it. Stored by ./store.ts.
 */
import { CONFIG_SPEC, configDefault, validateConfig, type ConfigKey } from '../config';
import { ACTIONS, isAction, MAX_BINDINGS, type Action, type PadInput } from './actions';

export type KeyBindings = Record<Action, string[]>;
export type PadBindings = Record<Action, PadInput[]>;

export const TOUCH_CONTROLS = ['move', 'jump', 'attack', 'sprint'] as const;
export type TouchControl = (typeof TOUCH_CONTROLS)[number];
export type Orientation = 'portrait' | 'landscape';

/** Center of a control as a fraction of the safe screen area, plus a size multiplier. */
export interface TouchPlacement {
  x: number;
  y: number;
  scale: number;
  visible: boolean;
}
export type TouchLayout = Record<TouchControl, TouchPlacement>;

export interface TouchSettings {
  show: 'auto' | 'always' | 'never';
  /** Analog stick or 8-way direction pad. */
  style: 'stick' | 'dpad';
  /** The stick re-centers wherever the thumb lands inside its zone. */
  floating: boolean;
  scale: number;
  opacity: number;
  sprintToggle: boolean;
  haptics: boolean;
  layouts: Record<Orientation, TouchLayout>;
}

export interface PadOptions {
  stick: 'left' | 'right';
  deadzone: number;
  /** Stick tilt scales speed; off = any tilt moves at full speed. */
  analog: boolean;
  vibration: boolean;
}

export interface Prefs {
  sprintToggle: boolean;
  showHelp: boolean;
  showStats: boolean;
  pauseOnBlur: boolean;
}

/** Config keys a profile may override: presentation only, never the deterministic sim tuning. */
export type GraphicsKey = Extract<ConfigKey, `render.${string}` | `anim.${string}`> | 'sim.timeScale';
export type Graphics = Partial<Record<GraphicsKey, boolean | number | string>>;
export const GRAPHICS_KEYS = (Object.keys(CONFIG_SPEC) as ConfigKey[]).filter(
  (k): k is GraphicsKey => k.startsWith('render.') || k.startsWith('anim.') || k === 'sim.timeScale',
);
export const isGraphicsKey = (k: string): k is GraphicsKey => (GRAPHICS_KEYS as string[]).includes(k);

export interface Profile {
  id: string;
  name: string;
  /** Template the profile was created from; "reset" restores it. */
  template: TemplateId;
  keys: KeyBindings;
  pad: PadBindings;
  padOptions: PadOptions;
  touch: TouchSettings;
  prefs: Prefs;
  graphics: Graphics;
}

export interface SettingsFile {
  version: 1;
  active: string;
  profiles: Profile[];
}

// ---------------------------------------------------------------- defaults

const btn = (index: number): PadInput => ({ kind: 'button', index });
/** W3C standard gamepad buttons. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 } as const;

const emptyKeys = (): KeyBindings => Object.fromEntries(ACTIONS.map((a) => [a, []])) as unknown as KeyBindings;
const emptyPad = (): PadBindings => Object.fromEntries(ACTIONS.map((a) => [a, []])) as unknown as PadBindings;

export function defaultKeys(): KeyBindings {
  return {
    ...emptyKeys(),
    moveUp: ['KeyW', 'ArrowUp'],
    moveDown: ['KeyS', 'ArrowDown'],
    moveLeft: ['KeyA', 'ArrowLeft'],
    moveRight: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    walk: ['AltLeft'],
    moveTo: ['Mouse2'],
    jump: ['Space'],
    attack: ['KeyJ', 'KeyK', 'Enter', 'Mouse0'],
    menu: ['Escape'],
    pause: ['Backquote', 'Pause'],
    step: ['KeyN'],
    reset: ['KeyR'],
    help: ['KeyH'],
    stats: ['F3'],
    togglePixel: ['KeyP'],
    toggleOutlines: ['KeyO'],
    toggleCreases: ['KeyI'],
    cyclePalette: ['KeyL'],
    toggleSnap: ['KeyF'],
    toggleSmoothScroll: ['KeyC'],
    toggleStepped: ['KeyT'],
    toggleDir8: ['KeyY'],
    toggleSilhouettes: ['KeyV'],
    toggleColliders: ['KeyG'],
    toggleShadows: ['KeyB'],
    animFps6: ['Digit1'],
    animFps8: ['Digit2'],
    animFps12: ['Digit3'],
    animFps24: ['Digit4'],
  };
}

/** Mouse in the left hand: movement on arrows / IJKL, actions around the right side of the keyboard. */
function leftHandedKeys(): KeyBindings {
  return {
    ...defaultKeys(),
    moveUp: ['ArrowUp', 'KeyI'],
    moveDown: ['ArrowDown', 'KeyK'],
    moveLeft: ['ArrowLeft', 'KeyJ'],
    moveRight: ['ArrowRight', 'KeyL'],
    sprint: ['ShiftRight'],
    walk: ['ControlRight'],
    jump: ['Space', 'Numpad0'],
    attack: ['Enter', 'NumpadEnter', 'Semicolon', 'Mouse0'],
    toggleCreases: ['KeyU'],
    cyclePalette: ['KeyM'],
  };
}

export function defaultPad(): PadBindings {
  return {
    ...emptyPad(),
    moveUp: [btn(PAD.UP)],
    moveDown: [btn(PAD.DOWN)],
    moveLeft: [btn(PAD.LEFT)],
    moveRight: [btn(PAD.RIGHT)],
    sprint: [btn(PAD.RT), btn(PAD.RB)],
    walk: [btn(PAD.LT)],
    jump: [btn(PAD.A)],
    attack: [btn(PAD.X), btn(PAD.Y)],
    menu: [btn(PAD.START)],
    pause: [btn(PAD.BACK)],
    togglePixel: [btn(PAD.R3)],
  };
}

export const defaultPadOptions = (): PadOptions => ({ stick: 'left', deadzone: 0.2, analog: true, vibration: true });
export const defaultPrefs = (): Prefs => ({ sprintToggle: false, showHelp: true, showStats: false, pauseOnBlur: true });

export function defaultTouchLayouts(): Record<Orientation, TouchLayout> {
  const p = (x: number, y: number, scale = 1): TouchPlacement => ({ x, y, scale, visible: true });
  return {
    // 9:16: thumbs near the bottom corners, clear of the top toolbar.
    portrait: { move: p(0.24, 0.84), attack: p(0.82, 0.82), jump: p(0.62, 0.9), sprint: p(0.86, 0.68, 0.85) },
    // 16:9: controls hug the lower left/right edges and leave the middle of the scene free.
    landscape: { move: p(0.13, 0.72), attack: p(0.9, 0.72), jump: p(0.79, 0.85), sprint: p(0.92, 0.48, 0.85) },
  };
}

export const defaultTouch = (): TouchSettings => ({
  show: 'auto', style: 'stick', floating: true, scale: 1, opacity: 0.85, sprintToggle: false, haptics: true, layouts: defaultTouchLayouts(),
});

// ---------------------------------------------------------------- templates

export const TEMPLATES = {
  standard: { label: 'Standard', desc: 'WASD / arrows, Space jump, J or click attack. Pixel art look.' },
  lefty: { label: 'Left-handed', desc: 'Arrows / IJKL to move, Enter or Numpad actions; mouse in the left hand.' },
  performance: { label: 'Performance', desc: 'Standard controls; fewer pixels, no shadow maps, creases or silhouettes.' },
  smooth3d: { label: 'Smooth 3D', desc: 'Standard controls; plain full-resolution 3D instead of pixel art.' },
} as const;
export type TemplateId = keyof typeof TEMPLATES;
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

let idCounter = 0;
export function newProfileId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `p${Date.now().toString(36)}${(idCounter++).toString(36)}`;
}

export function profileFromTemplate(template: TemplateId, name: string = TEMPLATES[template].label, id = newProfileId()): Profile {
  const graphics: Graphics =
    template === 'performance'
      ? { 'render.shadows': false, 'render.innerLines': false, 'render.silhouettes': false, 'render.targetLines': 216 }
      : template === 'smooth3d' ? { 'render.pixelMode': false } : {};
  return {
    id, name, template,
    keys: template === 'lefty' ? leftHandedKeys() : defaultKeys(),
    pad: defaultPad(),
    padOptions: defaultPadOptions(),
    touch: defaultTouch(),
    prefs: defaultPrefs(),
    graphics,
  };
}

export function defaultSettings(): SettingsFile {
  const profiles = TEMPLATE_IDS.map((t) => profileFromTemplate(t, TEMPLATES[t].label, `builtin-${t}`));
  return { version: 1, active: profiles[0].id, profiles };
}

// ---------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
export const isInputCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(c);

export function isPadInput(v: unknown): v is PadInput {
  if (!isObj(v) || typeof v.index !== 'number' || !Number.isInteger(v.index) || v.index < 0) return false;
  if (v.kind === 'button') return v.index < 32;
  return v.kind === 'axis' && v.index < 8 && (v.dir === 1 || v.dir === -1);
}
export const samePad = (a: PadInput, b: PadInput) =>
  a.kind === b.kind && a.index === b.index && (a.kind === 'button' || a.dir === (b as typeof a).dir);

function normalizeKeys(raw: unknown, fallback: KeyBindings): KeyBindings {
  if (!isObj(raw)) return fallback;
  const out = emptyKeys();
  for (const a of ACTIONS) {
    const list = Array.isArray(raw[a]) ? (raw[a] as unknown[]) : fallback[a];
    out[a] = [...new Set(list.filter(isInputCode))].slice(0, MAX_BINDINGS);
  }
  return out;
}

function normalizePad(raw: unknown, fallback: PadBindings): PadBindings {
  if (!isObj(raw)) return fallback;
  const out = emptyPad();
  for (const a of ACTIONS) {
    const list = Array.isArray(raw[a]) ? (raw[a] as unknown[]) : fallback[a];
    const clean: PadInput[] = [];
    for (const p of list) {
      if (!isPadInput(p) || clean.some((q) => samePad(p, q))) continue;
      clean.push(p.kind === 'button' ? { kind: 'button', index: p.index } : { kind: 'axis', index: p.index, dir: p.dir });
    }
    out[a] = clean.slice(0, MAX_BINDINGS);
  }
  return out;
}

function normalizeLayout(raw: unknown, fallback: TouchLayout): TouchLayout {
  const out = {} as TouchLayout;
  for (const c of TOUCH_CONTROLS) {
    const r = isObj(raw) && isObj(raw[c]) ? raw[c] : {};
    const f = fallback[c];
    out[c] = { x: num(r.x, 0, 1, f.x), y: num(r.y, 0, 1, f.y), scale: num(r.scale, 0.5, 2, f.scale), visible: bool(r.visible, f.visible) };
  }
  return out;
}

function normalizeGraphics(raw: unknown): Graphics {
  const out: Graphics = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isGraphicsKey(k)) continue;
    try {
      validateConfig(k, v);
      if (v !== configDefault(k)) out[k] = v as boolean | number | string;
    } catch {
      // Drop values that no longer validate (renamed options, changed ranges).
    }
  }
  return out;
}

/** Repairs anything loaded from storage or an imported file: unknown fields dropped, gaps filled from the template. */
export function normalizeProfile(raw: unknown): Profile {
  const r = isObj(raw) ? raw : {};
  const template = oneOf(r.template, TEMPLATE_IDS, 'standard');
  const base = profileFromTemplate(template);
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : base.name;
  const id = typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : base.id;
  const po = isObj(r.padOptions) ? r.padOptions : {};
  const pr = isObj(r.prefs) ? r.prefs : {};
  const t = isObj(r.touch) ? r.touch : {};
  const layouts = isObj(t.layouts) ? t.layouts : {};
  return {
    id, name, template,
    keys: normalizeKeys(r.keys, base.keys),
    pad: normalizePad(r.pad, base.pad),
    padOptions: {
      stick: oneOf(po.stick, ['left', 'right'] as const, base.padOptions.stick),
      deadzone: num(po.deadzone, 0.05, 0.6, base.padOptions.deadzone),
      analog: bool(po.analog, base.padOptions.analog),
      vibration: bool(po.vibration, base.padOptions.vibration),
    },
    touch: {
      show: oneOf(t.show, ['auto', 'always', 'never'] as const, base.touch.show),
      style: oneOf(t.style, ['stick', 'dpad'] as const, base.touch.style),
      floating: bool(t.floating, base.touch.floating),
      scale: num(t.scale, 0.6, 1.6, base.touch.scale),
      opacity: num(t.opacity, 0.2, 1, base.touch.opacity),
      sprintToggle: bool(t.sprintToggle, base.touch.sprintToggle),
      haptics: bool(t.haptics, base.touch.haptics),
      layouts: {
        portrait: normalizeLayout(layouts.portrait, base.touch.layouts.portrait),
        landscape: normalizeLayout(layouts.landscape, base.touch.layouts.landscape),
      },
    },
    prefs: {
      sprintToggle: bool(pr.sprintToggle, base.prefs.sprintToggle),
      showHelp: bool(pr.showHelp, base.prefs.showHelp),
      showStats: bool(pr.showStats, base.prefs.showStats),
      pauseOnBlur: bool(pr.pauseOnBlur, base.prefs.pauseOnBlur),
    },
    graphics: isObj(r.graphics) ? normalizeGraphics(r.graphics) : base.graphics,
  };
}

export function normalizeSettings(raw: unknown): SettingsFile {
  const r = isObj(raw) ? raw : {};
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const p of Array.isArray(r.profiles) ? r.profiles : []) {
    const n = normalizeProfile(p);
    if (seen.has(n.id)) n.id = newProfileId();
    seen.add(n.id);
    profiles.push(n);
  }
  if (!profiles.length) return defaultSettings();
  const active = typeof r.active === 'string' && seen.has(r.active) ? r.active : profiles[0].id;
  return { version: 1, active, profiles };
}

// ---------------------------------------------------------------- rebinding

/**
 * Binds `code` to `action`. A code drives one action only, so it is removed from any other action
 * first (returned, so the UI can say what was unbound). At the limit, the oldest binding is dropped.
 */
export function bindKey(keys: KeyBindings, action: Action, code: string): Action[] {
  if (!isInputCode(code)) throw new Error(`invalid input code "${code}"`);
  const stolen: Action[] = [];
  for (const a of ACTIONS) {
    if (a === action || !keys[a].includes(code)) continue;
    keys[a] = keys[a].filter((c) => c !== code);
    stolen.push(a);
  }
  if (!keys[action].includes(code)) keys[action] = [...keys[action], code].slice(-MAX_BINDINGS);
  return stolen;
}

export function unbindKey(keys: KeyBindings, action: Action, code: string) {
  keys[action] = keys[action].filter((c) => c !== code);
}

export function bindPad(pad: PadBindings, action: Action, input: PadInput): Action[] {
  if (!isPadInput(input)) throw new Error('invalid gamepad input');
  const stolen: Action[] = [];
  for (const a of ACTIONS) {
    if (a === action || !pad[a].some((p) => samePad(p, input))) continue;
    pad[a] = pad[a].filter((p) => !samePad(p, input));
    stolen.push(a);
  }
  if (!pad[action].some((p) => samePad(p, input))) pad[action] = [...pad[action], input].slice(-MAX_BINDINGS);
  return stolen;
}

export function unbindPad(pad: PadBindings, action: Action, input: PadInput) {
  pad[action] = pad[action].filter((p) => !samePad(p, input));
}

/** Actions bound to a keyboard/mouse code. */
export function actionsForCode(keys: KeyBindings, code: string): Action[] {
  return ACTIONS.filter((a) => keys[a].includes(code));
}

export { isAction };
