/**
 * Settings dialog: profiles (multiple saved configurations), graphics, and rebindable keyboard/mouse,
 * gamepad and touch controls, including editors for the 9:16 portrait and 16:9 landscape touch
 * layouts. Changes apply immediately and are saved to the active profile. Works with mouse, touch,
 * keyboard (Tab / Esc) and gamepad (D-pad / A / B / LB / RB via InputController.menuNav).
 */
import { CONFIG_SPEC, config, setConfig } from '../config';
import type { Game } from '../game';
import { ACTION_GROUPS, ACTION_INFO, ACTIONS, GROUP_LABELS, type Action } from '../input/actions';
import type { InputController, MenuNav } from '../input/controller';
import { bindKey, bindPad, GRAPHICS_KEYS, TEMPLATE_IDS, TEMPLATES, unbindKey, unbindPad, type GraphicsKey, type Orientation, type TouchControl } from '../input/profile';
import { codeLabel, padLabel } from '../input/resolve';
import type { SettingsStore } from '../input/store';
import { h } from './dom';
import { CONTROL_LABELS, PREVIEW_SIZE, TouchControls } from './touch';
import { toast } from './toast';

type Tab = 'profiles' | 'graphics' | 'keyboard' | 'gamepad' | 'touch';
const TABS: Array<[Tab, string]> = [['profiles', 'Profiles'], ['graphics', 'Graphics & audio'], ['keyboard', 'Keyboard & mouse'], ['gamepad', 'Gamepad'], ['touch', 'Touch']];

const GRAPHICS_LABELS: Record<GraphicsKey, string> = {
  'render.pixelMode': 'Pixel art mode', 'render.targetLines': 'Resolution (lines)', 'render.pixelsPerMeter': 'Pixels per meter',
  'render.outlines': 'Outlines', 'render.outlineStrength': 'Outline strength', 'render.innerLines': 'Crease lines',
  'render.innerLineStrength': 'Crease strength', 'render.palette': 'Palette', 'render.toonBands': 'Light bands',
  'render.snapMovers': 'Snap movers to pixels', 'render.snapCamera': 'Snap camera to pixels', 'render.smoothScroll': 'Smooth scroll',
  'render.blobShadows': 'Blob shadows', 'render.shadows': 'Shadow maps', 'render.silhouettes': 'Silhouettes behind walls',
  'render.colliders': 'Collider overlay', 'render.headScale': 'Head scale', 'render.handScale': 'Hand scale',
  'anim.stepped': 'Stepped animation', 'anim.fps': 'Animation fps', 'anim.dir8': '8-way facing', 'anim.blend': 'Blend time (s)',
  'sim.timeScale': 'Game speed',
  'ui.lootFilter': 'Loot filter', 'ui.telegraphs': 'Telegraphs', 'ui.screenShake': 'Screen shake', 'ui.damageNumbers': 'Damage numbers', 'ui.hints': 'Hints', 'audio.master': 'Master volume', 'audio.sfx': 'Sound effects', 'audio.ambience': 'Ambience', 'audio.music': 'Music', 'audio.mute': 'Mute',
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SettingsHooks {
  /** Touch settings or layouts changed: re-render the live overlay. */
  touchChanged(): void;
  /** Close the dialog and edit the live touch layout for the current orientation. */
  editTouchLayout(): void;
  /** Help / stats preferences changed. */
  prefsChanged(): void;
}

export class SettingsMenu {
  readonly el: HTMLElement;
  private sheet: HTMLElement;
  private panel: HTMLElement;
  private tabBar: HTMLElement;
  private profileSelect: HTMLSelectElement;
  private tab: Tab = 'profiles';
  private wasPaused = false;
  private returnFocus: HTMLElement | null = null;
  private padLoop = 0;

  constructor(private game: Game, private store: SettingsStore, private input: InputController, private hooks: SettingsHooks) {
    this.profileSelect = h('select', { id: 'settings-profile', onchange: () => this.selectProfile(this.profileSelect.value) });
    this.tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' });
    this.panel = h('div', { class: 'panel', role: 'tabpanel', tabindex: '-1' });
    this.sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
      h('header', {},
        h('h2', { id: 'settings-title' }, 'Settings'),
        h('label', {}, 'Profile', this.profileSelect),
        h('button', { class: 'ui-btn', 'aria-label': 'Close settings', onclick: () => this.hide() }, '✕'),
      ),
      this.tabBar,
      this.panel,
      h('footer', {}, `${store.persistent ? 'Changes save automatically to this browser.' : 'Browser storage is unavailable: changes last until this page closes.'} Esc or gamepad B closes.`),
    );
    this.el = h('div', { id: 'settings', hidden: true }, this.sheet);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.hide();
    });
    this.sheet.addEventListener('keydown', (e) => this.onKey(e));
    document.body.append(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  show(tab?: Tab) {
    if (tab) this.tab = tab;
    if (!this.open) {
      this.wasPaused = this.game.paused;
      this.game.paused = true;
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.el.hidden = false;
    this.render();
    (this.tabBar.querySelector<HTMLElement>('[aria-selected="true"]') ?? this.panel).focus({ preventScroll: true });
  }

  hide() {
    if (!this.open) return;
    this.input.cancelCapture();
    cancelAnimationFrame(this.padLoop);
    this.el.hidden = true;
    this.game.paused = this.wasPaused;
    this.returnFocus?.focus({ preventScroll: true });
  }

  private selectProfile(id: string) {
    this.store.select(id);
    this.hooks.touchChanged();
    this.hooks.prefsChanged();
    this.render();
  }

  // ---------------------------------------------------------------- keyboard + gamepad navigation

  private focusables(): HTMLElement[] {
    return [...this.sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement);
  }

  private onKey(e: KeyboardEvent) {
    if (this.input.capturing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    } else if (e.key === 'Tab') {
      const list = this.focusables();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
      e.preventDefault();
      list[next].focus();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.target as HTMLElement).getAttribute('role') === 'tab') {
      e.preventDefault();
      this.switchTab(e.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  private switchTab(dir: number) {
    const i = TABS.findIndex(([t]) => t === this.tab);
    this.tab = TABS[(i + dir + TABS.length) % TABS.length][0];
    this.render();
    this.tabBar.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }

  /** Gamepad menu navigation. */
  nav(cmd: MenuNav) {
    if (!this.open) return;
    const active = document.activeElement as HTMLElement | null;
    const list = this.focusables();
    const i = active ? list.indexOf(active) : -1;
    const move = (d: number) => {
      const next = list[i < 0 ? 0 : (i + d + list.length) % list.length];
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
    };
    const isTab = active?.getAttribute('role') === 'tab';
    switch (cmd) {
      case 'up': move(-1); break;
      case 'down': move(1); break;
      case 'left':
      case 'right': {
        const d = cmd === 'left' ? -1 : 1;
        if (isTab) this.switchTab(d);
        else if (active instanceof HTMLInputElement && active.type === 'range') {
          active.value = String(Number(active.value) + d * Number(active.step || 1));
          active.dispatchEvent(new Event('input', { bubbles: true }));
          active.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (active instanceof HTMLSelectElement) this.cycleSelect(active, d);
        else move(d);
        break;
      }
      case 'confirm':
        if (active instanceof HTMLSelectElement) this.cycleSelect(active, 1);
        else active?.click();
        break;
      case 'back':
        this.hide();
        break;
      case 'prevTab': this.switchTab(-1); break;
      case 'nextTab': this.switchTab(1); break;
    }
  }

  private cycleSelect(s: HTMLSelectElement, d: number) {
    s.selectedIndex = (s.selectedIndex + d + s.options.length) % s.options.length;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------------------------------------------------------------- rendering

  private render() {
    // Leaving a tab or profile abandons a pending capture; its callback re-renders.
    if (this.input.capturing) return this.input.cancelCapture();
    cancelAnimationFrame(this.padLoop);
    this.profileSelect.replaceChildren(...this.store.profiles.map((p) => h('option', { value: p.id, selected: p.id === this.store.active.id }, p.name)));
    this.tabBar.replaceChildren(...TABS.map(([id, label]) => h('button', {
      role: 'tab', id: `tab-${id}`, 'aria-selected': String(id === this.tab), 'aria-controls': 'settings-panel',
      tabindex: id === this.tab ? '0' : '-1', onclick: () => { this.tab = id; this.render(); },
    }, label)));
    this.panel.id = 'settings-panel';
    this.panel.setAttribute('aria-labelledby', `tab-${this.tab}`);
    const scroll = this.panel.scrollTop;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focus;
    const body = { profiles: () => this.profilesTab(), graphics: () => this.graphicsTab(), keyboard: () => this.keyboardTab(), gamepad: () => this.gamepadTab(), touch: () => this.touchTab() }[this.tab]();
    this.panel.replaceChildren(...body);
    this.panel.scrollTop = scroll;
    if (focusKey) this.panel.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  private row(label: string, help: string | null, ...control: Array<Node | string>) {
    return h('div', { class: 'row' }, h('div', { class: 'label' }, label, help ? h('small', {}, help) : null), h('div', { class: 'control' }, ...control));
  }

  private check(label: string, help: string | null, value: boolean, set: (v: boolean) => void, focus: string) {
    const id = `chk-${focus}`;
    return h('div', { class: 'row' },
      h('label', { class: 'label', for: id }, label, help ? h('small', {}, help) : null),
      h('div', { class: 'control' }, h('input', { type: 'checkbox', id, checked: value, dataset: { focus }, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) })),
    );
  }

  private slider(label: string, help: string | null, value: number, min: number, max: number, step: number, set: (v: number) => void, focus: string, fmt = (v: number) => String(v)) {
    const out = h('span', { class: 'value' }, fmt(value));
    const input = h('input', {
      type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label, dataset: { focus },
      oninput: () => {
        const v = Number(input.value);
        out.textContent = fmt(v);
        set(v);
      },
    });
    return this.row(label, help, input, out);
  }

  private select<T extends string>(label: string, help: string | null, value: T, options: ReadonlyArray<readonly [T, string]>, set: (v: T) => void, focus: string) {
    return this.row(label, help, h('select', {
      'aria-label': label, dataset: { focus }, onchange: (e: Event) => set((e.target as HTMLSelectElement).value as T),
    }, ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
  }

  // ---------------------------------------------------------------- profiles

  private profilesTab(): Node[] {
    const s = this.store;
    const active = s.active;
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => this.importFile(fileInput) });
    const templateNote = h('p', { class: 'note' }, TEMPLATES.standard.desc);
    const template = h('select', {
      'aria-label': 'Template for the new profile', dataset: { focus: 'new-template' },
      onchange: () => (templateNote.textContent = TEMPLATES[template.value as keyof typeof TEMPLATES].desc),
    }, ...TEMPLATE_IDS.map((t) => h('option', { value: t }, TEMPLATES[t].label)));
    return [
      h('h3', {}, 'Profiles'),
      h('p', { class: 'note' }, 'Each profile keeps its own bindings, touch layouts, preferences and graphics. Switch any time; the game uses the active one.'),
      ...s.profiles.map((p) => {
        const isActive = p.id === active.id;
        return h('div', { class: `profile${isActive ? ' active' : ''}` },
          h('div', { class: 'name' }, p.name, h('small', {}, `${TEMPLATES[p.template].label} template${isActive ? ' • active' : ''}`)),
          isActive ? null : h('button', { class: 'ui-btn small primary', dataset: { focus: `use-${p.id}` }, onclick: () => this.selectProfile(p.id) }, 'Use'),
          h('button', { class: 'ui-btn small', dataset: { focus: `ren-${p.id}` }, onclick: () => this.rename(p.id, p.name) }, 'Rename'),
          h('button', { class: 'ui-btn small', dataset: { focus: `dup-${p.id}` }, onclick: () => { s.duplicate(p.id); this.afterProfileChange(); toast('Profile duplicated'); } }, 'Duplicate'),
          h('button', { class: 'ui-btn small', dataset: { focus: `exp-${p.id}` }, onclick: () => this.exportProfile(p.id, p.name) }, 'Export'),
          h('button', {
            class: 'ui-btn small danger', disabled: s.profiles.length <= 1, dataset: { focus: `del-${p.id}` },
            onclick: () => { if (confirm(`Delete profile "${p.name}"?`)) { s.remove(p.id); this.afterProfileChange(); } },
          }, 'Delete'),
        );
      }),
      h('div', { class: 'actions' },
        template,
        h('button', { class: 'ui-btn', dataset: { focus: 'new' }, onclick: () => { s.create(template.value as (typeof TEMPLATE_IDS)[number]); this.afterProfileChange(); toast('Profile created'); } }, 'New profile'),
        h('button', { class: 'ui-btn', dataset: { focus: 'import' }, onclick: () => fileInput.click() }, 'Import…'),
        fileInput,
      ),
      templateNote,
      h('h3', {}, `Preferences for "${active.name}"`),
      this.check('Show help overlay', 'Control hints in the top-left corner.', active.prefs.showHelp, (v) => this.pref('showHelp', v), 'showHelp'),
      this.check('Show performance stats', 'fps, frame time, draw calls and triangles.', active.prefs.showStats, (v) => this.pref('showStats', v), 'showStats'),
      this.check('Pause when the game loses focus', 'Switching tabs or apps pauses the game.', active.prefs.pauseOnBlur, (v) => this.pref('pauseOnBlur', v), 'pauseOnBlur'),
      this.check('Sprint toggles', 'Press sprint once instead of holding it (keyboard and gamepad).', active.prefs.sprintToggle, (v) => this.pref('sprintToggle', v), 'sprintToggle'),
      h('div', { class: 'actions' },
        h('button', {
          class: 'ui-btn danger', dataset: { focus: 'reset-all' },
          onclick: () => { if (confirm(`Reset every setting of "${active.name}" to the ${TEMPLATES[active.template].label} template?`)) { s.resetActive('all'); this.afterProfileChange(); } },
        }, 'Reset profile to template'),
      ),
    ];
  }

  private pref(key: 'showHelp' | 'showStats' | 'pauseOnBlur' | 'sprintToggle', v: boolean) {
    this.store.update((p) => (p.prefs[key] = v));
    this.hooks.prefsChanged();
  }

  private afterProfileChange() {
    this.hooks.touchChanged();
    this.hooks.prefsChanged();
    this.render();
  }

  private rename(id: string, current: string) {
    const name = prompt('Profile name', current);
    if (name?.trim()) {
      this.store.rename(id, name);
      this.render();
    }
  }

  private exportProfile(id: string, name: string) {
    const blob = new Blob([this.store.exportJson(id)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `3dpixel2d-${name.replace(/[^\w-]+/g, '_').toLowerCase()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async importFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const imported = this.store.importJson(await file.text());
      toast(`Imported ${imported.map((p) => `"${p.name}"`).join(', ')}`);
      this.afterProfileChange();
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------- graphics

  private graphicsTab(): Node[] {
    const groups: Array<[string, GraphicsKey[]]> = [
      ['Rendering', GRAPHICS_KEYS.filter((k) => k.startsWith('render.'))],
      ['Animation', GRAPHICS_KEYS.filter((k) => k.startsWith('anim.'))],
      ['Audio', GRAPHICS_KEYS.filter((k) => k.startsWith('audio.'))],
      ['Gameplay', ['sim.timeScale', 'ui.hints', 'ui.lootFilter', 'ui.telegraphs', 'ui.damageNumbers', 'ui.screenShake']],
    ];
    const out: Node[] = [h('p', { class: 'note' }, 'Applies live and is saved to the active profile. Keyboard shortcuts (P, O, I…) change the same settings.')];
    for (const [title, keys] of groups) {
      out.push(h('h3', {}, title));
      for (const key of keys) out.push(this.configControl(key));
    }
    out.push(h('div', { class: 'actions' }, h('button', {
      class: 'ui-btn', dataset: { focus: 'reset-graphics' },
      onclick: () => { this.store.resetActive('graphics'); this.render(); toast('Graphics reset'); },
    }, 'Reset graphics to template')));
    return out;
  }

  private configControl(key: GraphicsKey): Node {
    const spec = CONFIG_SPEC[key] as { value: unknown; desc: string; min?: number; max?: number; options?: readonly string[] };
    const label = GRAPHICS_LABELS[key];
    const value = config[key];
    if (typeof spec.value === 'boolean') return this.check(label, spec.desc, value as boolean, (v) => setConfig(key, v), key);
    if (typeof spec.value === 'number') {
      const min = spec.min ?? 0, max = spec.max ?? 1;
      const integer = Number.isInteger(spec.value) && Number.isInteger(min) && Number.isInteger(max);
      const step = integer ? 1 : max - min > 20 ? 0.1 : 0.01;
      return this.slider(label, spec.desc, value as number, min, max, step, (v) => setConfig(key, v), key, (v) => (integer ? String(v) : v.toFixed(2)));
    }
    return this.select(label, spec.desc, value as string, (spec.options ?? []).map((o) => [o, o] as const), (v) => setConfig(key, v), key);
  }

  // ---------------------------------------------------------------- keyboard & mouse

  private keyboardTab(): Node[] {
    const p = this.store.active;
    const out: Node[] = [
      h('p', { class: 'note' }, 'Add a binding with +, then press a key or mouse button (Esc cancels). A key drives one action: binding it elsewhere moves it. Up to 4 bindings per action.'),
      this.check('Sprint toggles', 'Press sprint once instead of holding it.', p.prefs.sprintToggle, (v) => this.pref('sprintToggle', v), 'kb-sprintToggle'),
    ];
    for (const g of ACTION_GROUPS) {
      out.push(h('h3', {}, GROUP_LABELS[g]));
      for (const a of ACTIONS.filter((x) => ACTION_INFO[x].group === g)) {
        const chips = p.keys[a].map((code) => h('span', { class: 'chip' }, codeLabel(code),
          h('button', { 'aria-label': `Remove ${codeLabel(code)} from ${ACTION_INFO[a].label}`, dataset: { focus: `kx-${a}-${code}` }, onclick: () => {
            this.store.update((q) => unbindKey(q.keys, a, code));
            this.render();
          } }, '×')));
        out.push(this.row(ACTION_INFO[a].label, null, ...chips, this.addButton(a, 'keys')));
      }
    }
    out.push(h('div', { class: 'actions' }, h('button', {
      class: 'ui-btn', dataset: { focus: 'reset-keys' }, onclick: () => { this.store.resetActive('keys'); this.render(); toast('Keyboard & mouse bindings reset'); },
    }, 'Reset keyboard & mouse bindings')));
    return out;
  }

  private addButton(a: Action, kind: 'keys' | 'pad') {
    const btn = h('button', {
      class: 'ui-btn small', 'aria-label': `Add ${kind === 'keys' ? 'key or mouse button' : 'gamepad button'} for ${ACTION_INFO[a].label}`,
      dataset: { focus: `add-${kind}-${a}` },
      onclick: () => {
        // A second press cancels (the only way to back out on a touch screen without Esc).
        if (this.input.capturing) return this.input.cancelCapture();
        btn.textContent = kind === 'keys' ? 'Press a key or click…' : 'Press a button or move a stick…';
        btn.classList.add('capturing');
        const finish = (stolen: Action[], what: string) => {
          if (stolen.length) toast(`${what} moved from ${stolen.map((s) => ACTION_INFO[s].label).join(', ')} to ${ACTION_INFO[a].label}`);
          this.render();
        };
        if (kind === 'keys') {
          this.input.captureNext('keys', (code) => {
            if (!code) return this.render();
            let stolen: Action[] = [];
            this.store.update((q) => (stolen = bindKey(q.keys, a, code)));
            finish(stolen, codeLabel(code));
          });
        } else {
          this.input.captureNext('pad', (input) => {
            if (!input) return this.render();
            let stolen: Action[] = [];
            this.store.update((q) => (stolen = bindPad(q.pad, a, input)));
            finish(stolen, padLabel(input));
          });
        }
      },
    }, '+');
    return btn;
  }

  // ---------------------------------------------------------------- gamepad

  private gamepadTab(): Node[] {
    const p = this.store.active;
    const o = p.padOptions;
    const status = h('div', { class: 'note', role: 'status' });
    const leftStick = h('div', { class: 'stick', 'aria-hidden': 'true' }, h('i'));
    const rightStick = h('div', { class: 'stick', 'aria-hidden': 'true' }, h('i'));
    const pressed = h('div', { class: 'pressed' });
    const tick = () => {
      const pads = this.input.connectedPads();
      status.textContent = pads.length
        ? pads.map((g) => `${g.id.replace(/\s*\(.*\)\s*$/, '') || 'Gamepad'}${g.mapping === 'standard' ? '' : ' (non-standard mapping: labels may differ)'}`).join(' • ')
        : 'No controller detected. Connect one and press any button.';
      const g = pads[0];
      const place = (el: HTMLElement, x = 0, y = 0) => ((el.firstElementChild as HTMLElement).style.transform = `translate(${x * 25}px, ${y * 25}px)`);
      place(leftStick, g?.axes[0], g?.axes[1]);
      place(rightStick, g?.axes[2], g?.axes[3]);
      pressed.textContent = g ? g.buttons.map((b, i) => (b.pressed ? padLabel({ kind: 'button', index: i }) : '')).filter(Boolean).join('  ') || '—' : '';
      if (this.open && this.tab === 'gamepad') this.padLoop = requestAnimationFrame(tick);
    };
    this.padLoop = requestAnimationFrame(tick);
    const out: Node[] = [
      h('h3', {}, 'Controller'),
      status,
      h('div', { class: 'pad-test' }, leftStick, rightStick, pressed),
      this.select('Movement stick', null, o.stick, [['left', 'Left stick'], ['right', 'Right stick']] as const, (v) => this.store.update((q) => (q.padOptions.stick = v)), 'pad-stick'),
      this.slider('Stick deadzone', 'Ignore small stick drift.', o.deadzone, 0.05, 0.6, 0.01, (v) => this.store.update((q) => (q.padOptions.deadzone = v)), 'pad-deadzone', (v) => `${Math.round(v * 100)}%`),
      this.check('Analog speed', 'Tilt the stick part-way to walk slower.', o.analog, (v) => this.store.update((q) => (q.padOptions.analog = v)), 'pad-analog'),
      this.check('Vibration', 'Rumble on hits you land or take (supported controllers).', o.vibration, (v) => this.store.update((q) => (q.padOptions.vibration = v)), 'pad-vibration'),
      this.check('Sprint toggles', 'Press sprint once instead of holding it.', p.prefs.sprintToggle, (v) => this.pref('sprintToggle', v), 'pad-sprintToggle'),
      h('p', { class: 'note' }, 'Add a binding with +, then press a controller button or push a stick (Esc cancels). In menus: D-pad moves, A selects, B closes, LB / RB switch tabs.'),
    ];
    for (const g of ACTION_GROUPS) {
      out.push(h('h3', {}, GROUP_LABELS[g]));
      for (const a of ACTIONS.filter((x) => ACTION_INFO[x].group === g && x !== 'moveTo')) {
        const chips = p.pad[a].map((input) => h('span', { class: 'chip' }, padLabel(input),
          h('button', { 'aria-label': `Remove ${padLabel(input)} from ${ACTION_INFO[a].label}`, dataset: { focus: `px-${a}-${input.kind}${input.index}` }, onclick: () => {
            this.store.update((q) => unbindPad(q.pad, a, input));
            this.render();
          } }, '×')));
        out.push(this.row(ACTION_INFO[a].label, null, ...chips, this.addButton(a, 'pad')));
      }
    }
    out.push(h('div', { class: 'actions' }, h('button', {
      class: 'ui-btn', dataset: { focus: 'reset-pad' }, onclick: () => { this.store.resetActive('pad'); this.render(); toast('Gamepad settings reset'); },
    }, 'Reset gamepad settings')));
    return out;
  }

  // ---------------------------------------------------------------- touch

  private touchTab(): Node[] {
    const t = this.store.active.touch;
    const set = (fn: () => void) => {
      this.store.update(fn);
      this.hooks.touchChanged();
      this.render();
    };
    return [
      h('h3', {}, 'On-screen controls'),
      this.select('Show controls', 'Auto: on touch screens and small windows, hidden after keyboard or gamepad use.', t.show,
        [['auto', 'Auto'], ['always', 'Always'], ['never', 'Never']] as const, (v) => set(() => (t.show = v)), 'touch-show'),
      this.select('Movement', null, t.style, [['stick', 'Analog stick'], ['dpad', '8-way pad']] as const, (v) => set(() => (t.style = v)), 'touch-style'),
      this.check('Floating stick', 'The stick centers wherever your thumb lands.', t.floating, (v) => set(() => (t.floating = v)), 'touch-floating'),
      this.slider('Control size', null, t.scale, 0.6, 1.6, 0.05, (v) => { this.store.update(() => (t.scale = v)); this.hooks.touchChanged(); this.refreshPreviews(); }, 'touch-scale', (v) => `${Math.round(v * 100)}%`),
      this.slider('Opacity', null, t.opacity, 0.2, 1, 0.05, (v) => { this.store.update(() => (t.opacity = v)); this.hooks.touchChanged(); }, 'touch-opacity', (v) => `${Math.round(v * 100)}%`),
      this.check('Sprint button toggles', 'Tap once to sprint until you stop moving.', t.sprintToggle, (v) => set(() => (t.sprintToggle = v)), 'touch-sprint'),
      this.check('Vibrate on hits', 'Uses the device vibration motor where available.', t.haptics, (v) => set(() => (t.haptics = v)), 'touch-haptics'),
      h('h3', {}, 'Layouts'),
      h('p', { class: 'note' }, 'Portrait (9:16) and landscape (16:9) layouts are separate. Drag a control to move it, or select it and use the arrow keys; + / − resize.'),
      h('div', { class: 'layouts' }, this.layoutCard('portrait'), this.layoutCard('landscape')),
      h('div', { class: 'actions' }, h('button', { class: 'ui-btn primary', dataset: { focus: 'edit-live' }, onclick: () => this.hooks.editTouchLayout() }, 'Edit on screen')),
    ];
  }

  private previews: TouchControls[] = [];

  private refreshPreviews() {
    for (const p of this.previews) if (p.root.isConnected) p.render();
  }

  private layoutCard(o: Orientation): HTMLElement {
    const size = PREVIEW_SIZE[o];
    // Half size, shrunk further when the panel is narrower than the 16:9 preview (320 px phones).
    const avail = this.panel.clientWidth - 34;
    const scale = avail > 0 ? Math.min(0.5, avail / size.w) : 0.5;
    const frame = h('div', { class: 'frame', style: { width: `${size.w}px`, height: `${size.h}px`, transform: `scale(${scale})` } });
    const wrap = h('div', { class: 'frame-wrap', style: { width: `${size.w * scale}px`, height: `${size.h * scale}px` } }, frame);
    const tools = h('div', { class: 'edit-tools' });
    const controls = new TouchControls(frame, () => this.store.active.touch, null, o);
    this.previews = this.previews.filter((p) => p.root.isConnected);
    this.previews.push(controls);
    const renderTools = (c: TouchControl | null) => {
      const place = c ? this.store.active.touch.layouts[o][c] : null;
      tools.replaceChildren(
        h('span', { class: 'value' }, c ? CONTROL_LABELS[c] : 'Select a control'),
        h('button', { class: 'ui-btn small', disabled: !c, 'aria-label': 'Smaller', onclick: () => controls.resizeSelected(-0.1) }, '−'),
        h('button', { class: 'ui-btn small', disabled: !c, 'aria-label': 'Larger', onclick: () => controls.resizeSelected(0.1) }, '+'),
        h('button', { class: 'ui-btn small', disabled: !c, onclick: () => controls.toggleSelected() }, place && !place.visible ? 'Show' : 'Hide'),
        h('button', { class: 'ui-btn small', onclick: () => controls.resetLayout() }, 'Reset'),
      );
    };
    controls.onSelect = renderTools;
    controls.onLayoutChange = () => {
      this.store.update(() => {});
      this.hooks.touchChanged();
      renderTools(controls.selected);
    };
    controls.setEditing(true);
    renderTools(null);
    return h('div', { class: 'layout-card' }, h('strong', {}, o === 'portrait' ? '9:16 portrait' : '16:9 landscape'), wrap, tools);
  }
}
