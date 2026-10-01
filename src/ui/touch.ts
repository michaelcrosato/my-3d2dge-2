/**
 * On-screen controls: movement (analog stick or 8-way pad) and Jump / Attack / Sprint buttons,
 * placed from the active profile's layout for the current orientation (9:16 portrait or 16:9
 * landscape). The same component renders the live overlay and the scaled layout editors in
 * Settings; in edit mode controls are dragged (or nudged with arrow keys) and resized.
 */
import type { Orientation, TouchControl, TouchLayout, TouchSettings } from '../input/profile';
import { defaultTouchLayouts, TOUCH_CONTROLS } from '../input/profile';
import { length, quantize8, ZERO, type Move } from '../input/resolve';
import { clamp, h } from './dom';

export interface TouchHandlers {
  move(m: Move): void;
  press(action: TouchControl): void;
  hold(action: TouchControl, on: boolean): void;
}

export const CONTROL_LABELS: Record<TouchControl, string> = {
  move: 'Movement', jump: 'Jump', attack: 'Attack', sprint: 'Sprint', dodge: 'Dodge', skill1: 'Skill 1', skill2: 'Skill 2',
  skill3: 'Skill 3', skill4: 'Skill 4', skill5: 'Skill 5', flask1: 'Life', flask2: 'Mana', interact: 'Use',
};

/** Controls that repeat while held (attack combos, channelled skills). */
const HOLDABLE = new Set<TouchControl>(['attack', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5']);

/** Virtual screen sizes for the layout editors: a small phone in each orientation. */
export const PREVIEW_SIZE: Record<Orientation, { w: number; h: number }> = { portrait: { w: 360, h: 640 }, landscape: { w: 640, h: 360 } };

export const currentOrientation = (): Orientation => (window.innerHeight > window.innerWidth ? 'portrait' : 'landscape');

const STICK_DEADZONE = 0.15;
const PAD_DEADZONE = 0.3;

export class TouchControls {
  readonly root: HTMLElement;
  editing = false;
  selected: TouchControl | null = null;
  onSelect?: (c: TouchControl | null) => void;
  onLayoutChange?: () => void;
  /** Live label for a control (skill names, flask charges); falls back to CONTROL_LABELS. */
  labelFor?: (c: TouchControl) => string;
  private els = new Map<TouchControl, HTMLElement>();
  private knob: HTMLElement | null = null;
  private arrows: HTMLElement[] = [];
  private latched = false;

  constructor(
    host: HTMLElement,
    private settings: () => TouchSettings,
    private handlers: TouchHandlers | null,
    private preview?: Orientation,
  ) {
    this.root = h('div', { class: `tc-root${preview ? ' preview' : ''}` });
    host.append(this.root);
    // Re-render only when the size really changes (rebuilding drops a thumb that is mid-drag).
    let last = '';
    if (!preview) window.addEventListener('resize', () => {
      const key = `${window.innerWidth}x${window.innerHeight}`;
      if (key !== last) {
        last = key;
        this.render();
      }
    });
  }

  orientation(): Orientation {
    return this.preview ?? currentOrientation();
  }

  layout(): TouchLayout {
    return this.settings().layouts[this.orientation()];
  }

  private size() {
    if (this.preview) return PREVIEW_SIZE[this.preview];
    const r = this.root.getBoundingClientRect();
    return { w: r.width || window.innerWidth, h: r.height || window.innerHeight };
  }

  private diameter(c: TouchControl, w: number, hgt: number) {
    const unit = clamp(Math.min(w, hgt) * 0.17, 52, 80);
    return (c === 'move' ? unit * 2.1 : unit) * this.settings().scale * this.layout()[c].scale;
  }

  render() {
    const s = this.settings();
    const layout = this.layout();
    const { w, h: hgt } = this.size();
    this.root.replaceChildren();
    this.els.clear();
    this.root.classList.toggle('editing', this.editing);
    this.root.style.opacity = String(this.editing ? 1 : s.opacity);
    for (const c of TOUCH_CONTROLS) {
      const place = layout[c];
      if (!place.visible && !this.editing) continue;
      const d = this.diameter(c, w, hgt);
      const el = c === 'move' ? this.moveControl(s) : h('div', { class: `tc tc-${c}`, dataset: { action: c } }, this.labelFor?.(c) ?? CONTROL_LABELS[c]);
      el.dataset.control = c;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', c === 'move' ? (s.style === 'dpad' ? 'Direction pad' : 'Movement stick') : CONTROL_LABELS[c]);
      Object.assign(el.style, {
        width: `${d}px`, height: `${d}px`,
        left: `${clamp(place.x * w - d / 2, 0, Math.max(0, w - d))}px`,
        top: `${clamp(place.y * hgt - d / 2, 0, Math.max(0, hgt - d))}px`,
        fontSize: `${Math.max(10, d * (c === 'move' ? 0.1 : c.startsWith('skill') || c.startsWith('flask') ? 0.17 : 0.22))}px`,
      });
      el.classList.toggle('selected', this.editing && this.selected === c);
      el.classList.toggle('hidden-control', !place.visible);
      if (c === 'sprint') el.classList.toggle('latched', this.latched);
      if (this.editing) this.makeEditable(el, c);
      else if (c === 'move') this.bindMove(el);
      else this.bindButton(el, c);
      this.root.append(el);
      this.els.set(c, el);
    }
  }

  private moveControl(s: TouchSettings): HTMLElement {
    const el = h('div', { class: `tc tc-move${s.style === 'dpad' ? ' dpad' : ''}` });
    this.knob = h('div', { class: 'knob' });
    this.arrows = [
      h('span', { class: 'arrow', style: { top: '6%' } }, '▲'),
      h('span', { class: 'arrow', style: { right: '8%' } }, '▶'),
      h('span', { class: 'arrow', style: { bottom: '6%' } }, '▼'),
      h('span', { class: 'arrow', style: { left: '8%' } }, '◀'),
    ];
    el.append(...this.arrows, this.knob);
    return el;
  }

  setSprintLatched(on: boolean) {
    if (on === this.latched) return;
    this.latched = on;
    this.els.get('sprint')?.classList.toggle('latched', on);
  }

  private bindMove(el: HTMLElement) {
    let pointer: number | null = null;
    let cx = 0, cy = 0, radius = 1;
    const release = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('down');
      if (this.knob) this.knob.style.transform = '';
      this.arrows.forEach((a) => a.classList.remove('on'));
      this.handlers?.move(ZERO);
    };
    el.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pointer = e.pointerId;
      const r = el.getBoundingClientRect();
      radius = r.width * 0.4;
      // Floating stick: the thumb's landing point becomes the center (kept inside the ring).
      const mx = r.left + r.width / 2, my = r.top + r.height / 2;
      const floating = this.settings().floating && this.settings().style === 'stick';
      cx = floating ? clamp(e.clientX, mx - radius * 0.5, mx + radius * 0.5) : mx;
      cy = floating ? clamp(e.clientY, my - radius * 0.5, my + radius * 0.5) : my;
      el.classList.add('down');
      onMove(e);
    });
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      let m: Move = { x: (e.clientX - cx) / radius, y: -(e.clientY - cy) / radius };
      const l = length(m);
      if (l > 1) m = { x: m.x / l, y: m.y / l };
      const dpad = this.settings().style === 'dpad';
      const dz = dpad ? PAD_DEADZONE : STICK_DEADZONE;
      if (l < dz) m = ZERO;
      else if (dpad) m = quantize8(m);
      else {
        const k = (Math.min(1, l) - dz) / (1 - dz) / Math.min(1, l);
        m = { x: m.x * k, y: m.y * k };
      }
      const r = el.getBoundingClientRect();
      const kx = clamp(e.clientX - (r.left + r.width / 2), -radius, radius);
      const ky = clamp(e.clientY - (r.top + r.height / 2), -radius, radius);
      if (this.knob) this.knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      const on = [m.y > 0.38, m.x > 0.38, m.y < -0.38, m.x < -0.38];
      this.arrows.forEach((a, i) => a.classList.toggle('on', on[i]));
      this.handlers?.move(m);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  /** Refreshes button labels (skills slotted, flask charges) without rebuilding the overlay. */
  refreshLabels() {
    for (const [c, el] of this.els) {
      if (c === 'move') continue;
      const text = this.labelFor?.(c) ?? CONTROL_LABELS[c];
      if (el.textContent !== text) el.textContent = text;
    }
  }

  private bindButton(el: HTMLElement, c: Exclude<TouchControl, 'move'>) {
    let pointer: number | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pointer = e.pointerId;
      el.classList.add('down');
      if (c === 'sprint' && !this.settings().sprintToggle) this.handlers?.hold('sprint', true);
      else {
        this.handlers?.press(c);
        if (HOLDABLE.has(c)) this.handlers?.hold(c, true);
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('down');
      if (c === 'sprint' && !this.settings().sprintToggle) this.handlers?.hold('sprint', false);
      else if (HOLDABLE.has(c)) this.handlers?.hold(c, false);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  // ---------------------------------------------------------------- editing

  setEditing(on: boolean) {
    this.editing = on;
    if (!on) this.selected = null;
    this.render();
  }

  select(c: TouchControl | null) {
    this.selected = c;
    for (const [id, el] of this.els) el.classList.toggle('selected', id === c);
    this.onSelect?.(c);
  }

  private changed() {
    this.render();
    if (this.selected) (this.els.get(this.selected) as HTMLElement | undefined)?.focus({ preventScroll: true });
    this.onLayoutChange?.();
  }

  /** Move the selected control by a fraction of the screen. */
  nudge(dx: number, dy: number) {
    if (!this.selected) return;
    const p = this.layout()[this.selected];
    p.x = clamp(p.x + dx, 0, 1);
    p.y = clamp(p.y + dy, 0, 1);
    this.changed();
  }

  resizeSelected(delta: number) {
    if (!this.selected) return;
    const p = this.layout()[this.selected];
    p.scale = clamp(Math.round((p.scale + delta) * 100) / 100, 0.5, 2);
    this.changed();
  }

  toggleSelected() {
    if (!this.selected) return;
    const p = this.layout()[this.selected];
    p.visible = !p.visible;
    this.changed();
  }

  resetLayout() {
    const o = this.orientation();
    this.settings().layouts[o] = defaultTouchLayouts()[o];
    this.changed();
  }

  private makeEditable(el: HTMLElement, c: TouchControl) {
    el.tabIndex = 0;
    el.setAttribute('aria-label', `${CONTROL_LABELS[c]}: drag or use arrow keys to move, + and - to resize`);
    let drag: { id: number; x: number; y: number; px: number; py: number; k: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.select(c);
      const p = this.layout()[c];
      const { w, h: hgt } = this.size();
      const k = this.root.getBoundingClientRect().width / w || 1;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: p.x * w, py: p.y * hgt, k };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { w, h: hgt } = this.size();
      const d = this.diameter(c, w, hgt);
      const p = this.layout()[c];
      const cx = clamp(drag.px + (e.clientX - drag.x) / drag.k, d / 2, w - d / 2);
      const cy = clamp(drag.py + (e.clientY - drag.y) / drag.k, d / 2, hgt - d / 2);
      p.x = cx / w;
      p.y = cy / hgt;
      el.style.left = `${cx - d / 2}px`;
      el.style.top = `${cy - d / 2}px`;
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      this.onLayoutChange?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('focus', () => this.select(c));
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) this.nudge(...moves[e.key]);
      else if (e.key === '+' || e.key === '=') this.resizeSelected(0.1);
      else if (e.key === '-') this.resizeSelected(-0.1);
      else if (e.key === 'h' || e.key === 'H') this.toggleSelected();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }
}
