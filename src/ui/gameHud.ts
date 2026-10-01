/**
 * The in-game HUD (DOM): life and mana orbs, flasks, the hotbar with live cooldowns, costs and
 * key labels from the active bindings, experience, buffs, the boss bar, stage banners and loot
 * toasts. Debug help/stats text sits in a corner when enabled.
 */
import type { Game, GameEvent } from '../game';
import { RARITY_COLOR } from '../content/items';
import { SKILLS } from '../content/skills';
import { statusDef } from '../content/statuses';
import type { Action } from '../input/actions';
import type { Device } from '../input/controller';
import type { Profile } from '../input/profile';
import { codeLabel, padLabel } from '../input/resolve';
import { blockedReason, cooldownOf, costOf } from '../sim/actions';
import { heroSkills, treePoints } from '../sim/hero';
import { xpToNext } from '../sim/scaling';
import type { SimEvent } from '../sim/sim';
import { h } from './dom';
import { skillIconNode } from './skillIcons';

const SLOT_ACTIONS: Action[] = ['attack', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5'];

function bar(cls: string, color: string) {
  const fill = h('i', { style: { width: '0%' } });
  const label = h('span');
  const el = h('div', { class: `gbar ${cls}`, style: { ['--c' as never]: color } as Partial<CSSStyleDeclaration> }, fill, label);
  el.style.setProperty('--c', color);
  return { el, fill, label };
}

function orb(color: string) {
  const fill = h('i');
  const label = h('span');
  const el = h('div', { class: 'orb' }, fill, label);
  el.style.setProperty('--c', color);
  return { el, fill, label };
}

export function bindingLabel(p: Profile, a: Action, device: Device): string {
  if (device === 'gamepad') return p.pad[a][0] ? padLabel(p.pad[a][0]) : '';
  const code = p.keys[a][0];
  if (!code) return '';
  const l = codeLabel(code);
  return l === 'Left click' ? 'LMB' : l === 'Right click' ? 'RMB' : l === 'Middle click' ? 'MMB' : l;
}

export class GameHud {
  readonly el: HTMLElement;
  private title = h('div', { class: 'title' });
  private life = bar('life', 'var(--gp-life)');
  private mana = bar('mana', 'var(--gp-mana)');
  private xp = bar('xp', 'var(--gp-xp)');
  private lifeOrb = orb('linear-gradient(#ff6a6a, #8a1020)');
  private manaOrb = orb('linear-gradient(#7aa0ff, #102a8a)');
  private slots: Array<{ el: HTMLElement; icon: HTMLElement; key: HTMLElement; cd: HTMLElement; skill: string | null }> = [];
  private flasks: Array<{ el: HTMLElement; num: HTMLElement; key: HTMLElement }> = [];
  private buffs = h('div', { class: 'buffs' });
  private boss = h('div', { class: 'boss', hidden: true });
  private bossBar = bar('boss', '#d6283a');
  private bossName = h('b');
  private banner = h('div', { class: 'banner' });
  private debug = h('div', { class: 'debug' });
  private bannerTimer = 0;
  private lastText = 0;
  private keyCache = '';

  constructor(private game: Game, private toast: (text: string, color?: string) => void, private onSlotClick: (slot: number) => void) {
    const hotbar = h('div', { class: 'hotbar' });
    const flaskWrap = h('div', { class: 'hotbar' });
    for (let i = 0; i < 2; i++) {
      const num = h('span', { class: 'num' });
      const key = h('span', { class: 'key' });
      const icon = h('div', { style: { width: '14px', height: '26px', borderRadius: '4px 4px 6px 6px', border: '2px solid #c9a13b', background: i ? '#3a6aff' : '#d6283a' } });
      const el = h('div', { class: 'slot', title: i ? 'Mana flask' : 'Life flask', style: { width: '30px' } }, icon, key, num);
      flaskWrap.append(el);
      this.flasks.push({ el, num, key });
    }
    for (let i = 0; i < SLOT_ACTIONS.length; i++) {
      const icon = h('div');
      const key = h('span', { class: 'key' });
      const cd = h('div', { class: 'cd', style: { height: '0%' } });
      const el = h('div', { class: 'slot', role: 'button', title: i === 0 ? 'Attack' : `Skill ${i}`, onclick: () => i > 0 && this.onSlotClick(i - 1) }, icon, cd, key);
      hotbar.append(el);
      this.slots.push({ el, icon, key, cd, skill: null });
    }
    this.boss.append(this.bossName, this.bossBar.el);
    this.el = h('div', { id: 'ghud', hidden: true },
      this.title,
      h('div', { class: 'bars' }, this.life.el, this.mana.el),
      h('div', { class: 'xpline' }, this.xp.el),
      this.buffs,
      this.boss,
      h('div', { class: 'bottom' }, this.lifeOrb.el, flaskWrap, hotbar, this.manaOrb.el),
      this.banner,
      this.debug,
    );
    document.body.append(this.el);
    game.listeners.add((e) => this.onEvent(e));
  }

  showBanner(title: string, sub = '', tip = '', seconds = 3.5) {
    this.banner.replaceChildren(...[h('b', {}, title), sub ? h('span', {}, sub) : null, tip ? h('em', {}, tip) : null].filter((x): x is HTMLElement => !!x));
    this.banner.style.opacity = '1';
    this.bannerTimer = seconds;
  }

  private onEvent(e: GameEvent | SimEvent) {
    const game = this.game;
    switch (e.type) {
      case 'mode':
        if (e.mode === 'dungeon') this.showBanner(String(e.title ?? ''), String(e.subtitle ?? ''), String(e.tip ?? ''), 5);
        else if (e.mode === 'town') this.showBanner(String(e.title ?? 'Haven'), String(e.subtitle ?? ''), '', 2.5);
        break;
      case 'stage.clear':
        this.showBanner('Depth cleared', `${fmtTime((e.time as number) / 60)} · ${e.kills} kills${e.mechanicKills ? ` (${e.mechanicKills} by tricks)` : ''} · +${e.gold} gold${e.first ? ' · +1 passive point' : ''}`, 'A portal has opened. Step in to go deeper, or use the town portal near the entrance.', 6);
        break;
      case 'levelup':
        this.showBanner(`Level ${e.level}`, `${treePoints(game.hero!)} passive point${treePoints(game.hero!) === 1 ? '' : 's'} to spend (P)`, '', 3);
        break;
      case 'hero.died':
        this.showBanner('You have fallen', 'Rising again at the entrance…', '', 3);
        break;
      case 'hero.respawn':
        if ((e.goldLost as number) > 0) this.toast(`Lost ${e.goldLost} gold`, '#ffd84a');
        break;
      case 'pickup':
        if (e.kind === 'item' && e.rarity !== 'normal') this.toast(String(e.name), RARITY_COLOR[e.rarity as 'magic']);
        break;
      case 'inventory.full':
        this.toast('Inventory is full', '#ff6a6a');
        break;
      case 'boss.phase':
        this.showBanner('The boss grows desperate', '', '', 2);
        break;
      case 'exit.open':
        this.toast('A portal to the next depth has opened', '#7ab8ff');
        break;
      case 'flask.empty':
        this.toast('Flask is empty. Kills refill it.', '#ff9a9a');
        break;
      case 'steal':
        this.toast('Stolen power!', '#ffe14d');
        break;
    }
  }

  update(profile: Profile, device: Device, dt: number, debugText: string) {
    const game = this.game;
    const hero = game.hero;
    const sim = game.sim;
    const ch = sim.player;
    const show = (game.mode === 'town' || game.mode === 'dungeon') && !!hero && !!ch;
    this.el.hidden = !show;
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.style.opacity = '0';
    }
    if (!show || !hero || !ch) return;
    const lifePct = Math.max(0, ch.life / ch.maxLife), manaPct = ch.maxMana ? Math.max(0, ch.mana / ch.maxMana) : 0;
    this.life.fill.style.width = `${lifePct * 100}%`;
    this.mana.fill.style.width = `${manaPct * 100}%`;
    this.lifeOrb.fill.style.height = `${lifePct * 100}%`;
    this.manaOrb.fill.style.height = `${manaPct * 100}%`;
    const need = xpToNext(hero.level);
    this.xp.fill.style.width = `${Math.min(100, (hero.xp / need) * 100)}%`;
    // Hotbar cooldowns every frame; text a few times per second.
    const known = heroSkills(hero);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const id = i === 0 ? 'slash1' : hero.hotbar[i - 1] && known.includes(hero.hotbar[i - 1]!) ? hero.hotbar[i - 1] : null;
      if (slot.skill !== id) {
        slot.skill = id;
        slot.icon.replaceChildren(id ? skillIconNode(id) : h('span', { style: { color: '#6a6078' } }, '+'));
        slot.el.classList.toggle('empty', !id);
        slot.el.title = id ? `${SKILLS[id].name}: ${SKILLS[id].desc}` : 'Empty: assign a skill in the Character panel (C)';
      }
      if (!id || i === 0) {
        slot.cd.style.height = '0%';
        continue;
      }
      const s = SKILLS[id];
      const cdLeft = ch.cooldowns[id] ?? 0;
      const total = cooldownOf(sim, ch, s) || 1;
      slot.cd.style.height = cdLeft > 0 ? `${Math.min(100, (cdLeft / total) * 100)}%` : '0%';
      slot.el.classList.toggle('nomana', blockedReason(sim, ch, id) === 'mana' && costOf(sim, ch, s) > 0);
    }
    this.lastText += dt;
    if (this.lastText < 0.15) return;
    this.lastText = 0;
    const keyKey = `${profile.id}|${device}`;
    if (keyKey !== this.keyCache) {
      this.keyCache = keyKey;
      this.slots.forEach((s, i) => (s.key.textContent = bindingLabel(profile, SLOT_ACTIONS[i], device)));
      this.flasks.forEach((f, i) => (f.key.textContent = bindingLabel(profile, i ? 'flask2' : 'flask1', device)));
    }
    this.flasks.forEach((f, i) => (f.num.textContent = String(Math.floor(hero.flasks[i]))));
    this.life.label.textContent = `${Math.ceil(ch.life)} / ${Math.round(ch.maxLife)}`;
    this.mana.label.textContent = `${Math.floor(ch.mana)} / ${Math.round(ch.maxMana)}`;
    this.lifeOrb.label.textContent = String(Math.ceil(ch.life));
    this.manaOrb.label.textContent = String(Math.floor(ch.mana));
    this.xp.label.textContent = '';
    const timer = game.mode === 'dungeon' ? ` · ${fmtTime(sim.stage.time / 60)}${sim.stage.mechanicKills ? ` · ${sim.stage.mechanicKills} trick kills` : ''}` : '';
    const pts = treePoints(hero);
    const auto = game.autopilot;
    const titleText = `${sim.level.title ?? ''}|Lv ${hero.level} · ${hero.gold}g${timer}${pts > 0 ? ` · ${pts} pts` : ''}${auto.on ? ` · AUTOPILOT: ${auto.goal}` : ''}`;
    if (this.title.dataset.t !== titleText) {
      this.title.dataset.t = titleText;
      const [t, sub] = titleText.split('|');
      this.title.replaceChildren(h('b', {}, t), h('small', {}, sub));
    }
    // Buffs and ailments on the hero.
    const buffText = ch.statuses.map((s) => `${s.id}:${Math.ceil(s.time)}`).join(',');
    if (this.buffs.dataset.t !== buffText) {
      this.buffs.dataset.t = buffText;
      const seen = new Set<string>();
      this.buffs.replaceChildren(...ch.statuses.filter((s) => !seen.has(s.id) && seen.add(s.id)).map((s) => {
        const d = statusDef(s.id);
        const el = h('span', {}, `${d.name} ${s.time < 100 ? Math.ceil(s.time) : ''}`);
        el.style.setProperty('--c', d.color);
        return el;
      }));
    }
    // Boss bar: the nearest awake boss.
    let boss = null;
    for (const c of sim.characters.values()) if (c.monster?.boss && c.state !== 'dead' && c.ai.awake && Math.hypot(c.pos.x - ch.pos.x, c.pos.z - ch.pos.z) < 30) boss = c;
    this.boss.hidden = !boss;
    if (boss) {
      this.bossName.textContent = boss.name;
      this.bossBar.fill.style.width = `${Math.max(0, (boss.life / boss.maxLife) * 100)}%`;
      this.bossBar.label.textContent = `${Math.round((boss.life / boss.maxLife) * 100)}%`;
    }
    if (this.debug.textContent !== debugText) this.debug.textContent = debugText;
  }
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
