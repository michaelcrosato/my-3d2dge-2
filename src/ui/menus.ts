/**
 * Title screen (save slots, training room, settings) and the pause menu (resume, panels,
 * settings, return to town, save & quit) with the debug difficulty sliders: player and enemy
 * damage, life and speed, plus experience, loot and density multipliers for fast playtesting.
 */
import { CONFIG_SPEC, DIFFICULTY_PRESETS, applyDifficulty, config, setConfig, type ConfigKey } from '../config';
import type { Game } from '../game';
import type { SaveStore } from '../save';
import { TUNE_KEYS } from '../save';
import { h } from './dom';
import type { PanelId } from './panels';

const TUNE_LABELS: Partial<Record<ConfigKey, string>> = {
  'tune.playerDamage': 'Hero damage', 'tune.playerLife': 'Hero life', 'tune.playerSpeed': 'Hero speed',
  'tune.enemyDamage': 'Enemy damage', 'tune.enemyLife': 'Enemy life', 'tune.enemySpeed': 'Enemy speed',
  'tune.xp': 'Experience', 'tune.loot': 'Loot quantity', 'tune.density': 'Monster density',
};


export interface MenuHooks {
  openSettings(): void;
  openPanel(p: PanelId): void;
  toast(text: string): void;
}

export class PauseMenu {
  readonly el: HTMLElement;
  private box = h('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pause menu' });
  private wasPaused = false;

  constructor(private game: Game, private saves: SaveStore, private hooks: MenuHooks) {
    this.el = h('div', { id: 'gmenu', hidden: true }, this.box);
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && this.hide());
    this.box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });
    document.body.append(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  show() {
    if (!this.open) {
      this.wasPaused = this.game.paused;
      this.game.paused = true;
    }
    this.el.hidden = false;
    this.render();
    this.box.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  hide() {
    if (!this.open) return;
    this.el.hidden = true;
    this.game.paused = false;
    void this.wasPaused;
    this.saves.recordTune();
  }

  private render() {
    const g = this.game;
    const btn = (label: string, fn: () => void, cls = '') => h('button', { class: `ui-btn ${cls}`, onclick: fn }, label);
    const sliders = TUNE_KEYS.map((k) => {
      const spec = CONFIG_SPEC[k] as { min?: number; max?: number };
      const out = h('span', {}, `${(config[k] as number).toFixed(2)}×`);
      const input = h('input', {
        type: 'range', min: String(spec.min ?? 0), max: String(Math.min(spec.max ?? 5, 5)), step: '0.05', value: String(config[k]), 'aria-label': TUNE_LABELS[k] ?? k,
        oninput: () => {
          setConfig(k, Number(input.value));
          out.textContent = `${Number(input.value).toFixed(2)}×`;
        },
      });
      return h('label', {}, TUNE_LABELS[k] ?? k, input, out);
    });
    this.box.replaceChildren(
      h('h2', {}, 'Paused'),
      h('div', { class: 'stack' },
        btn('Resume', () => this.hide(), 'primary'),
        g.hero && g.mode !== 'sandbox' ? btn('Inventory (I)', () => { this.hide(); this.hooks.openPanel('inventory'); }) : null,
        g.hero && g.mode !== 'sandbox' ? btn('Passive tree (P)', () => { this.hide(); this.hooks.openPanel('tree'); }) : null,
        g.hero && g.mode !== 'sandbox' ? btn('Character & skills (C)', () => { this.hide(); this.hooks.openPanel('character'); }) : null,
        btn('Settings & controls', () => { this.hide(); this.hooks.openSettings(); }),
        g.mode === 'dungeon' ? btn(g.autopilot.on ? 'Autopilot: on (stop)' : 'Autopilot (watch the bot play)', () => {
          g.setAutopilot(g.autopilot.on ? null : { strategy: 'clear' });
          this.hooks.toast(g.autopilot.on ? 'Autopilot on: the bot plays. Pause to take over.' : 'Autopilot off');
          this.hide();
        }) : null,
        g.mode === 'dungeon' ? btn('Return to town', () => { this.hide(); void g.enterTown(); }) : null,
        g.mode === 'sandbox' ? btn('Back to title', () => { this.hide(); window.dispatchEvent(new CustomEvent('game:title')); }) : null,
        g.hero ? btn('Save & quit to title', () => { g.save(); this.hide(); window.dispatchEvent(new CustomEvent('game:title')); }) : null,
      ),
      h('div', { class: 'tune' },
        h('h2', { style: { fontSize: '14px', textAlign: 'left' } }, 'Difficulty & tuning'),
        h('div', { class: 'stack', style: { flexDirection: 'row', flexWrap: 'wrap' } }, ...Object.keys(DIFFICULTY_PRESETS).map((name) => h('button', {
          class: 'ui-btn small', onclick: () => {
            applyDifficulty(name);
            this.render();
            this.hooks.toast(`Difficulty: ${name}`);
          },
        }, name))),
        ...sliders,
        h('p', { class: 'note', style: { color: 'var(--gp-dim)', fontSize: '12px' } }, 'Changes apply instantly, to monsters already alive too. Density applies to newly generated depths.'),
      ),
    );
  }
}

export class TitleScreen {
  readonly el: HTMLElement;

  constructor(private game: Game, private saves: SaveStore, private hooks: MenuHooks & { started(): void }) {
    this.el = h('div', { id: 'gtitle', hidden: true });
    document.body.append(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  show() {
    this.el.hidden = false;
    this.render();
    this.el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  hide() {
    this.el.hidden = true;
  }

  private render() {
    const s = this.saves.file;
    const cards = s.slots.map((hero, i) => h('div', { class: 'slotcard' },
      h('b', {}, hero ? `${hero.name} · Level ${hero.level}` : `Empty slot ${i + 1}`),
      h('small', {}, hero ? `Deepest: ${hero.progress.endlessBest} · ${hero.gold}g · ${hero.totals.kills} kills` : 'Begin a new run in Haven.'),
      hero
        ? h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { class: 'ui-btn primary', style: { flex: '1' }, onclick: () => this.start(() => this.game.loadGame(i)) }, 'Continue'),
          h('button', {
            class: 'ui-btn danger', onclick: () => {
              if (confirm(`Delete ${hero.name} (level ${hero.level})?`)) {
                this.saves.deleteSlot(i);
                this.render();
              }
            },
          }, 'Delete'))
        : h('button', {
          class: 'ui-btn primary', onclick: () => {
            const name = (prompt('Name your ranger', 'Ranger') ?? '').trim() || 'Ranger';
            this.start(() => this.game.newGame(i, name.slice(0, 24)));
          },
        }, 'New game'),
    ));
    this.el.replaceChildren(
      h('h1', {}, 'DEPTHWARD'),
      h('div', { class: 'sub' }, 'A pixel-art hack-and-slash, rendered live from 3D'),
      h('div', { class: 'slots' }, ...cards),
      h('div', { class: 'more' },
        h('button', { class: 'ui-btn', onclick: () => this.start(() => this.game.startSandbox()) }, 'Training room'),
        h('button', { class: 'ui-btn', onclick: () => this.hooks.openSettings() }, 'Settings'),
      ),
      h('small', { class: 'sub' }, this.saves.persistent ? 'Progress saves automatically in this browser.' : 'Browser storage is unavailable: progress lasts until this page closes.'),
    );
  }

  private start(fn: () => Promise<void>) {
    this.hide();
    this.game.paused = false;
    fn().then(() => this.hooks.started()).catch((e) => {
      console.error(e);
      this.hooks.toast(`Could not start: ${e instanceof Error ? e.message : String(e)}`);
      this.show();
    });
  }
}
