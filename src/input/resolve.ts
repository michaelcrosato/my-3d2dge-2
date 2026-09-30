/** Pure input math and labels shared by the device layer, the touch overlay and the settings UI. */
import type { PadInput } from './actions';

/** Screen-space movement: x = right, y = up, both in [-1, 1], length <= 1. */
export interface Move {
  x: number;
  y: number;
}

export const ZERO: Move = { x: 0, y: 0 };
export const length = (m: Move) => Math.hypot(m.x, m.y);

/** Four held directions -> unit vector (diagonals normalized). */
export function digitalMove(up: boolean, down: boolean, left: boolean, right: boolean): Move {
  const x = +right - +left, y = +up - +down;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/**
 * Radial deadzone with rescaling, so output starts at 0 just outside the deadzone and reaches 1 at
 * full tilt. `ay` is the raw axis value (down positive); the result is up positive.
 * Non-analog mode snaps any tilt outside the deadzone to full length.
 */
export function stickMove(ax: number, ay: number, deadzone: number, analog = true): Move {
  const m = Math.hypot(ax, ay);
  if (!(m > deadzone)) return { x: 0, y: 0 };
  const scaled = analog ? Math.min(1, (m - deadzone) / (1 - deadzone)) : 1;
  return { x: (ax / m) * scaled, y: (-ay / m) * scaled };
}

/** Sum of sources, clamped to length 1 (keyboard + stick never exceeds full speed). */
export function combine(parts: readonly Move[]): Move {
  let x = 0, y = 0;
  for (const p of parts) {
    x += p.x;
    y += p.y;
  }
  const l = Math.hypot(x, y);
  return l > 1 ? { x: x / l, y: y / l } : { x, y };
}

/** Snap to the nearest of 8 directions at full length (direction-pad style). */
export function quantize8(m: Move): Move {
  if (length(m) < 1e-6) return { x: 0, y: 0 };
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(m.y, m.x) / step) * step;
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { x: r(Math.cos(a)), y: r(Math.sin(a)) };
}

export interface PadState {
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  axes: readonly number[];
}

/** 0..1 activation of one binding on a gamepad. Axes count once tilted past `threshold`. */
export function padValue(pad: PadState, input: PadInput, threshold = 0.5): number {
  if (input.kind === 'button') return pad.buttons[input.index]?.pressed ? 1 : 0;
  const v = (pad.axes[input.index] ?? 0) * input.dir;
  return v > threshold ? v : 0;
}

// ---------------------------------------------------------------- labels

const NAMED: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', Backquote: '`',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Meta', MetaRight: 'R Meta', CapsLock: 'Caps',
  Pause: 'Pause', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .', Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5', WheelUp: 'Wheel up', WheelDown: 'Wheel down',
};

/** Human label for a keyboard/mouse code. `layout` (from navigator.keyboard) localizes letter keys. */
export function codeLabel(code: string, layout?: ReadonlyMap<string, string>): string {
  const local = layout?.get(code);
  if (local && local.trim() && !NAMED[code]) return local.length === 1 ? local.toUpperCase() : local;
  if (NAMED[code]) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  return code;
}

const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];
const PAD_AXES = ['Left stick', 'Left stick', 'Right stick', 'Right stick'];

export function padLabel(input: PadInput): string {
  if (input.kind === 'button') return PAD_BUTTONS[input.index] ?? `Button ${input.index}`;
  const base = PAD_AXES[input.index] ?? `Axis ${input.index}`;
  const vertical = input.index % 2 === 1;
  const dir = vertical ? (input.dir > 0 ? '↓' : '↑') : input.dir > 0 ? '→' : '←';
  return `${base} ${dir}`;
}
