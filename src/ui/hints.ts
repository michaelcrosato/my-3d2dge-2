/**
 * First-steps hints: the game teaches itself at the moment each thing matters (the waypoint on
 * arrival, attack and roll in the first fight, the first passive point, the first upgrade, low
 * life, the first boss, the town's services). Each hint fires once per hero (saved in
 * `hero.progress.hints`), names the control for the device in use, and can be turned off
 * (Settings → Gameplay → Hints).
 */
import { config } from '../config';
import type { Game, GameEvent } from '../game';
import type { Action } from '../input/actions';
import { treePoints } from '../sim/hero';
import type { SimEvent } from '../sim/sim';
import { h } from './dom';

export type ControlLabel = (a: Action) => string;

let installed = false;
function installStyles() {
  if (installed) return;
  installed = true;
  document.head.append(h('style', {}, `
#ghint { position: fixed; z-index: 7; left: 0; right: 0; margin: 0 auto; width: fit-content; bottom: calc(max(12px, env(safe-area-inset-bottom)) + 104px); max-width: min(520px, calc(100vw - 24px)); box-sizing: border-box;
  background: #14121bee; color: #f3ead6; border: 1px solid #c9a13b; border-radius: 6px; padding: 8px 12px 8px 12px; font: 600 13px/1.4 system-ui, sans-serif; box-shadow: 0 6px 24px #000a;
  display: flex; gap: 10px; align-items: flex-start; transition: opacity 0.25s; cursor: pointer; }
#ghint[hidden] { display: none; }
#ghint b { color: #ffcf5a; }
#ghint .x { color: #a99fb8; font-size: 12px; }
body.touchui #ghint { bottom: auto; top: calc(max(8px, env(safe-area-inset-top)) + 64px); }
`));
}

export class Hints {
  readonly el = h('div', { id: 'ghint', hidden: true, role: 'status', 'aria-live': 'polite' });
  private queue: Array<{ id: string; text: string }> = [];
  private showing: string | null = null;
  private timer = 0;
  private poll = 0;

  constructor(private game: Game, private label: ControlLabel) {
    installStyles();
    document.body.append(this.el);
    this.el.addEventListener('click', () => this.dismiss());
    game.listeners.add((e) => this.onEvent(e));
  }

  private get seen(): string[] | null {
    return this.game.hero?.progress.hints ?? null;
  }

  /** Queues a hint unless this hero has seen it (or hints are off). */
  private offer(id: string, text: string) {
    const seen = this.seen;
    if (!seen || !config['ui.hints'] || seen.includes(id) || this.queue.some((q) => q.id === id) || this.showing === id) return;
    this.queue.push({ id, text });
  }

  private onEvent(e: GameEvent | SimEvent) {
    const g = this.game, k = this.label;
    switch (e.type) {
      case 'mode':
        if (e.mode === 'town' && (g.hero?.progress.unlocked ?? 1) <= 1) this.offer('waypoint', `Walk to the glowing <b>waypoint</b> and press <b>${k('interact')}</b> to enter the depths.`);
        if (e.mode === 'town' && (g.hero?.inventory.filter(Boolean).length ?? 0) >= 6) this.offer('town', `Back in Haven: <b>Odessa</b> buys and sells, <b>Brann</b> crafts, <b>Sage Ilmar</b> reshapes your tree, <b>Sela</b> builds creatures.`);
        if (e.mode === 'dungeon') this.offer('combat', `Hold <b>${k('attack')}</b> to keep swinging. <b>${k('dodge')}</b> rolls through attacks (you can't be hit mid-roll). Skills: <b>${k('skill1')}</b>, <b>${k('skill2')}</b>.`);
        break;
      case 'pickup':
        if (e.kind === 'item' && e.rarity !== 'normal') this.offer('gear', `New gear! Open your bag with <b>${k('inventory')}</b>: a green <b>▲</b> marks upgrades.`);
        break;
      case 'stage.clear':
        if (!e.arena && !e.trial) this.offer('portal', `The new portal leads deeper. The town portal near the entrance (or <b>${k('townPortal')}</b>) takes you home.`);
        break;
    }
  }

  /** Called every frame by the human loop. */
  update(dt: number) {
    const g = this.game;
    if (this.showing) {
      this.timer -= dt;
      if (this.timer <= 0) this.dismiss();
    }
    this.poll -= dt;
    if (this.poll <= 0) {
      this.poll = 0.5;
      this.check();
    }
    if (!this.showing && this.queue.length && !g.paused && g.mode !== 'title') this.show(this.queue.shift()!);
  }

  private check() {
    const g = this.game, hero = g.hero, sim = g.sim, k = this.label;
    if (!hero || g.mode === 'title' || g.mode === 'sandbox') return;
    if (treePoints(hero) > 0) this.offer('tree', `You have a passive point to spend. Open the tree with <b>${k('tree')}</b>.`);
    const p = sim?.player;
    if (!p || g.mode !== 'dungeon') return;
    if (p.state !== 'dead' && p.life < p.maxLife * 0.35 && hero.flasks[0] >= 10) this.offer('flask', `Low life! Drink a life flask with <b>${k('flask1')}</b>. Kills refill it.`);
    for (const c of sim.characters.values()) {
      if (c.monster?.boss && c.ai.awake && c.state !== 'dead' && Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) < 14) {
        this.offer('boss', 'A boss! Red markings on the ground show where its big attacks land: roll out of them.');
        break;
      }
    }
  }

  private show(hint: { id: string; text: string }) {
    const seen = this.seen;
    if (!seen) return;
    seen.push(hint.id);
    this.showing = hint.id;
    this.timer = 8;
    this.el.innerHTML = '';
    const body = h('div');
    // Hint texts are authored here (no user input), so the <b> markup is safe.
    body.innerHTML = hint.text;
    this.el.append(h('span', {}, '💡'), body, h('span', { class: 'x', 'aria-label': 'Dismiss' }, '✕'));
    this.el.hidden = false;
    this.game.save();
  }

  dismiss() {
    this.el.hidden = true;
    this.showing = null;
  }
}
