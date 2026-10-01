/**
 * Game panels in one modal sheet: inventory & equipment, character (stats + skill slotting),
 * passive tree, and the townsfolk: merchant (buy / sell / gamble), blacksmith (crafts, salvage),
 * stash, waypoint (choose a depth), sage (tree + respec). Click/tap an item to select it, then use
 * the action buttons (works the same with mouse, touch and gamepad focus).
 */
import { BASES, itemBase, KIND_LABEL, RARITY_COLOR, SLOT_LABEL, type EquipSlot, type Item, type SlotKind } from '../content/items';
import { describeMod, STATS } from '../content/stats';
import { HERO_SKILLS, HOTBAR_SKILLS, SKILL_NAMES, SKILLS } from '../content/skills';
import { NPC_LINES } from '../content/town';
import { TREE, SECTOR_NAME } from '../content/tree';
import { stageMechanics, stageTitle } from '../content/campaign';
import { MECHANICS } from '../content/mechanics';
import { fmtTime } from './gameHud';
import type { Game } from '../game';
import { IconRenderer } from '../render/icons';
import { PortraitRenderer } from '../render/portraits';
import { ensureMonster, MONSTERS } from '../content/monsters';
import { PINNACLE_IDS } from '../content/pinnacles';
import { UNIQUES } from '../content/uniques';
import { upgradeGains } from '../sim/autobuild';
import { PACTS, pactRewardText, pactsOf } from '../content/pacts';
import { dailyTrial, dateKey } from '../content/daily';
import { fmtFrames } from '../game';
import { cooldownOf, costOf } from '../sim/actions';
import { estimateSkill } from '../sim/combat';
import { heroSkills, treePoints, type Hero } from '../sim/hero';
import * as ops from '../sim/heroOps';
import { craftBlocked, craftCost, describeItem, itemValue, salvageValue, type Craft } from '../sim/items';
import { xpToNext } from '../sim/scaling';
import { h } from './dom';
import { skillIconNode } from './skillIcons';
import { TreeView } from './treeView';

export type PanelId = 'inventory' | 'character' | 'tree' | 'merchant' | 'smith' | 'stash' | 'waypoint' | 'sage' | 'shrine_respec';

const TITLES: Record<PanelId, string> = {
  inventory: 'Inventory', character: 'Character', tree: 'Passive Tree', merchant: 'Odessa the Trader', smith: 'Brann the Smith',
  stash: 'Stash', waypoint: 'Waypoint', sage: 'Sage Ilmar', shrine_respec: 'Shrine of Unmaking',
};

const CRAFT_INFO: Record<Craft, { label: string; desc: string }> = {
  upgrade: { label: 'Upgrade rarity', desc: 'Normal → magic → rare, adding affixes.' },
  reforge: { label: 'Reforge', desc: 'Reroll every affix (keeps rarity).' },
  augment: { label: 'Augment', desc: 'Add one random affix if there is room.' },
  temper: { label: 'Temper', desc: 'Reroll the numbers of one random affix.' },
  quality: { label: 'Hone (+5% quality)', desc: 'Raises base damage or defences, up to 20%.' },
};

export class Panels {
  readonly el: HTMLElement;
  private sheet: HTMLElement;
  private header = h('header');
  private tabs = h('div', { class: 'tabs', role: 'tablist' });
  private body = h('div', { class: 'body' });
  private icons: IconRenderer;
  current: PanelId | null = null;
  private tab = '';
  private selected: ops.Loc | null = null;
  private stock: { visit: number; list: ops.StockEntry[] } = { visit: -1, list: [] };
  private wasPaused = false;
  private treeView: TreeView | null = null;
  private portraits: PortraitRenderer | null = null;
  private craftSeed = 1;
  private gainCache: { key: string; map: Map<string, number> } | null = null;

  constructor(private game: Game, private toast: (t: string, color?: string) => void) {
    this.icons = new IconRenderer(game.renderer, game.pipeline);
    this.sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, this.header, this.tabs, this.body);
    this.el = h('div', { class: 'gp', hidden: true }, this.sheet);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    this.sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    document.body.append(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  private get hero(): Hero {
    return this.game.hero!;
  }

  show(id: PanelId, tab?: string) {
    if (!this.game.hero) return;
    if (!this.open) {
      this.wasPaused = this.game.paused;
      this.game.paused = true;
    }
    if (this.current !== id) this.selected = null;
    this.current = id;
    this.tab = tab ?? this.defaultTab(id);
    this.el.hidden = false;
    this.el.classList.toggle('treep', id === 'tree' || (id === 'sage' && this.tab === 'tree'));
    this.render();
    (this.sheet.querySelector<HTMLElement>('button') ?? this.sheet).focus({ preventScroll: true });
  }

  toggle(id: PanelId) {
    if (this.open && (this.current === id || (id === 'tree' && this.current === 'sage' && this.tab === 'tree'))) this.close();
    else this.show(id);
  }

  close() {
    if (!this.open) return;
    this.el.hidden = true;
    this.current = null;
    this.game.paused = this.wasPaused;
    this.game.save();
  }

  private defaultTab(id: PanelId) {
    return ({ merchant: 'buy', smith: 'craft', sage: 'tree', character: 'skills' } as Partial<Record<PanelId, string>>)[id] ?? 'main';
  }

  /** After any change to the hero: rebuild stats, save, redraw. */
  private changed() {
    this.game.sim.refreshHero();
    this.render();
  }

  private act(err: string | null, ok?: string) {
    if (err) this.toast(err, '#ff8a8a');
    else {
      if (ok) this.toast(ok);
      this.changed();
    }
  }

  // ---------------------------------------------------------------- rendering

  render() {
    const id = this.current;
    if (!id) return;
    const hero = this.hero;
    const quote = NPC_LINES[id === 'merchant' ? 'merchant' : id === 'smith' ? 'smith' : id === 'sage' ? 'sage' : id === 'stash' ? 'stash' : id === 'waypoint' ? 'waypoint' : id === 'shrine_respec' ? 'shrine_respec' : ''];
    this.header.replaceChildren(
      h('h2', {}, TITLES[id]),
      h('span', { class: 'wallet' }, `${hero.gold.toLocaleString()} gold · ${hero.shards} shards`),
      h('button', { class: 'ui-btn small', 'aria-label': 'Close', onclick: () => this.close() }, '✕'),
    );
    if (quote) this.header.append(h('p', { class: 'quote' }, `“${quote[(this.game.visits + id.length) % quote.length]}”`));
    const tabs = this.tabsFor(id);
    this.tabs.hidden = tabs.length < 2;
    this.tabs.replaceChildren(...tabs.map(([t, label]) => h('button', {
      role: 'tab', 'aria-selected': String(t === this.tab), onclick: () => {
        this.tab = t;
        this.el.classList.toggle('treep', id === 'tree' || (id === 'sage' && t === 'tree'));
        this.render();
      },
    }, label)));
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...this.content(id));
    this.body.scrollTop = scroll;
    if (this.treeView && this.treeView.el.isConnected) this.treeView.mount();
  }

  private tabsFor(id: PanelId): Array<[string, string]> {
    switch (id) {
      case 'merchant': return [['buy', 'Buy'], ['sell', 'Sell'], ['gamble', 'Gamble']];
      case 'smith': return [['craft', 'Craft'], ['salvage', 'Salvage']];
      case 'sage': return [['tree', 'Passive tree'], ['respec', 'Unmake']];
      case 'character': return [['skills', 'Skills'], ['stats', 'Stats'], ['codex', 'Codex']];
      default: return [['main', TITLES[id]]];
    }
  }

  private content(id: PanelId): Node[] {
    switch (id) {
      case 'inventory': return this.inventoryView('inventory');
      case 'stash': return this.stashView();
      case 'merchant': return this.tab === 'buy' ? this.buyView() : this.tab === 'sell' ? this.inventoryView('sell') : this.gambleView();
      case 'smith': return this.tab === 'craft' ? this.inventoryView('craft') : this.inventoryView('salvage');
      case 'character': return this.tab === 'skills' ? this.skillsView() : this.tab === 'codex' ? this.codexView() : this.statsView();
      case 'tree': return this.treeContent();
      case 'sage': return this.tab === 'tree' ? this.treeContent() : this.respecView();
      case 'shrine_respec': return this.respecView();
      case 'waypoint': return this.waypointView();
    }
  }

  // ---------------------------------------------------------------- items

  /** Upgrade estimates for bag items, recomputed only when gear, level or the tree change. */
  private gains(): Map<string, number> {
    const hero = this.hero;
    const key = [hero.level, hero.tree.length, hero.hotbar.join(), ...hero.inventory.map((i) => i?.uid ?? '-'), ...Object.values(hero.equipment).map((i) => i?.uid ?? '-')].join('|');
    if (this.gainCache?.key !== key) this.gainCache = { key, map: upgradeGains(this.game.sim) };
    return this.gainCache.map;
  }

  private cell(item: Item | null, loc: ops.Loc, label = ''): HTMLElement {
    const sel = this.selected && this.selected.area === loc.area && this.selected.index === loc.index && this.selected.slot === loc.slot;
    const gain = item && loc.area === 'inventory' ? this.gains().get(item.uid) ?? 0 : 0;
    const el = h('button', {
      class: `cell${item ? ` r-${item.rarity}` : ''}${sel ? ' sel' : ''}`,
      'aria-label': item ? item.name : label || 'Empty',
      title: item ? item.name : label,
      onclick: () => {
        this.selected = item ? loc : null;
        this.render();
      },
      ondblclick: () => item && this.quickAction(loc),
    },
    item ? h('img', { class: 'pix', src: this.icons.icon({ base: item.base, rarity: item.rarity, seed: item.seed, unique: item.unique }), alt: '' }) : null,
    gain > 1.02 ? h('span', { class: 'up', title: `Upgrade: about +${Math.round((gain - 1) * 100)}% overall power` }, '▲') : null,
    !item && label ? h('span', { class: 'lbl' }, label) : null);
    return el;
  }

  /** Double-click: the obvious action for where we are. */
  private quickAction(loc: ops.Loc) {
    const hero = this.hero;
    if (this.current === 'stash') return this.act(ops.transfer(hero, loc));
    if (this.current === 'merchant' && this.tab === 'sell') return this.act(ops.sell(hero, loc));
    if (this.current === 'smith' && this.tab === 'salvage') return this.act(ops.salvage(hero, loc));
    if (loc.area === 'equip') return this.act(ops.unequip(hero, loc.slot!));
    const item = ops.itemAt(hero, loc);
    if (item && itemBase(item.base).slot === 'jewel') return this.toast('Socket jewels in the passive tree (allocate a socket, select it, then use Socket).');
    this.act(ops.equip(hero, loc));
    this.selected = null;
  }

  private tooltip(item: Item, compare: Item | null): HTMLElement {
    const lines = describeItem(item, SKILL_NAMES);
    const base = BASES[item.base];
    const tip = h('div', { class: 'tip' },
      h('div', { class: 'name', style: { color: RARITY_COLOR[item.rarity] } }, item.name),
      h('div', { class: 'base' }, `${item.rarity !== 'normal' && item.name !== base.name ? `${base.name} · ` : ''}${KIND_LABEL[base.slot]}${base.weapon ? ` · ${base.weapon.cls}${base.weapon.twoHanded ? ', two-handed' : ''}` : ''}`),
      ...lines.map((l) => h('div', { class: l.kind }, l.text, l.tier && l.kind === 'affix' ? h('span', { class: 'req' }, `  T${l.tier}`) : null)),
      h('div', { class: 'req' }, `Sells for ${itemValue(item)}g · salvages for ${salvageValue(item)} shards`),
    );
    if (compare && compare.uid !== item.uid) {
      tip.append(h('div', { class: 'cmp' }, h('div', { class: 'base' }, 'Currently equipped:'), h('div', { class: 'name', style: { color: RARITY_COLOR[compare.rarity], fontSize: '12px' } }, compare.name),
        ...describeItem(compare, SKILL_NAMES).filter((l) => l.kind !== 'flavour' && l.kind !== 'req').map((l) => h('div', { class: l.kind }, l.text))));
    }
    return tip;
  }

  private selectedDetails(mode: 'inventory' | 'sell' | 'craft' | 'salvage' | 'stash'): HTMLElement {
    const hero = this.hero;
    const loc = this.selected;
    const item = loc ? ops.itemAt(hero, loc) : null;
    const box = h('section', {}, h('h3', {}, 'Selected'));
    if (!item || !loc) {
      box.append(h('p', { class: 'note' }, mode === 'craft' ? 'Select an item (equipped or in your bags) to work on it.' : 'Select an item to see its details. Double-click / double-tap for the quick action.'));
      return box;
    }
    const slot = ops.slotFor(hero, item);
    const compare = loc.area !== 'equip' && slot ? hero.equipment[slot] ?? null : null;
    box.append(this.tooltip(item, compare));
    const gain = loc.area === 'inventory' ? this.gains().get(item.uid) : undefined;
    if (gain !== undefined) {
      const pct = Math.round((gain - 1) * 100);
      box.append(h('p', { class: 'note', style: { color: pct > 1 ? '#5ad06a' : pct < -1 ? '#ff8a8a' : undefined } }, pct > 1 ? `▲ Upgrade: about +${pct}% overall power (damage and survival)` : pct < -1 ? `▼ About ${pct}% overall power if equipped` : 'About the same overall power if equipped'));
    }
    const actions = h('div', { class: 'actions' });
    const btn = (label: string, fn: () => string | null, primary = false, ok?: string) => actions.append(h('button', { class: `ui-btn small${primary ? ' primary' : ''}`, onclick: () => this.act(fn(), ok) }, label));
    const kind = itemBase(item.base).slot;
    if (mode === 'inventory' || mode === 'stash') {
      if (loc.area === 'equip') btn('Unequip', () => ops.unequip(hero, loc.slot!), true);
      else if (kind !== 'jewel') btn('Equip', () => { const e = ops.equip(hero, loc); this.selected = null; return e; }, true);
      if (mode === 'stash' && loc.area !== 'equip') btn(loc.area === 'stash' ? 'Take' : 'Store', () => { const e = ops.transfer(hero, loc); this.selected = null; return e; }, true);
      if (kind === 'ring' && loc.area !== 'equip') btn('Equip as ring 2', () => ops.equip(hero, loc, 'ring2'));
    }
    if (mode === 'sell' && loc.area !== 'equip') btn(`Sell (${itemValue(item)}g)`, () => { const e = ops.sell(hero, loc); this.selected = null; return e; }, true);
    if (mode === 'salvage' && loc.area !== 'equip') btn(`Salvage (+${salvageValue(item)} shards)`, () => { const e = ops.salvage(hero, loc); this.selected = null; return e; }, true);
    if (mode === 'craft') {
      for (const c of Object.keys(CRAFT_INFO) as Craft[]) {
        const blocked = craftBlocked(item, c);
        const cost = craftCost(item, c);
        actions.append(h('button', {
          class: 'ui-btn small', disabled: !!blocked, title: blocked ?? CRAFT_INFO[c].desc,
          onclick: () => this.act(ops.craft(hero, loc, c, hero.nextUid * 7919 + this.craftSeed++), `${CRAFT_INFO[c].label}: done`),
        }, `${CRAFT_INFO[c].label} · ${cost.gold}g ${cost.shards}◆`));
      }
    }
    box.append(actions);
    return box;
  }

  private dollView(): HTMLElement {
    const hero = this.hero;
    const order: EquipSlot[] = ['helmet', 'amulet', 'weapon', 'offhand', 'chest', 'gloves', 'belt', 'boots', 'ring1', 'ring2', 'flask1', 'flask2'];
    return h('div', { class: 'doll' }, ...order.map((s) => this.cell(hero.equipment[s] ?? null, { area: 'equip', slot: s }, SLOT_LABEL[s])));
  }

  private inventoryView(mode: 'inventory' | 'sell' | 'craft' | 'salvage'): Node[] {
    const hero = this.hero;
    const bulk = h('div', { class: 'actions' },
      h('button', { class: 'ui-btn small', onclick: () => { ops.sortArea(hero, 'inventory'); this.render(); } }, 'Sort'),
      mode === 'sell' ? h('button', {
        class: 'ui-btn small', onclick: () => {
          let gold = 0;
          hero.inventory.forEach((it, i) => {
            if (it && (it.rarity === 'normal' || it.rarity === 'magic')) {
              gold += itemValue(it);
              ops.sell(hero, { area: 'inventory', index: i });
            }
          });
          this.act(null, `Sold for ${gold}g`);
        },
      }, 'Sell all normal & magic') : null,
      mode === 'salvage' ? h('button', {
        class: 'ui-btn small', onclick: () => {
          let n = 0;
          hero.inventory.forEach((it, i) => {
            if (it && (it.rarity === 'normal' || it.rarity === 'magic')) {
              n += salvageValue(it);
              ops.salvage(hero, { area: 'inventory', index: i });
            }
          });
          this.act(null, `+${n} shards`);
        },
      }, 'Salvage all normal & magic') : null,
    );
    return [
      h('section', {}, h('h3', {}, 'Equipped'), this.dollView(), h('h3', {}, `Bags (${hero.inventory.filter(Boolean).length}/${hero.inventory.length})`),
        h('div', { class: 'grid' }, ...hero.inventory.map((it, i) => this.cell(it, { area: 'inventory', index: i }))), bulk),
      this.selectedDetails(mode),
    ];
  }

  private stashView(): Node[] {
    const hero = this.hero;
    return [
      h('section', {}, h('h3', {}, `Stash (${hero.stash.filter(Boolean).length}/${hero.stash.length})`),
        h('div', { class: 'grid' }, ...hero.stash.map((it, i) => this.cell(it, { area: 'stash', index: i }))),
        h('div', { class: 'actions' }, h('button', { class: 'ui-btn small', onclick: () => { ops.sortArea(hero, 'stash'); this.render(); } }, 'Sort stash'))),
      h('section', {}, h('h3', {}, 'Bags'), h('div', { class: 'grid' }, ...hero.inventory.map((it, i) => this.cell(it, { area: 'inventory', index: i }))), this.selectedDetails('stash')),
    ];
  }

  private buyView(): Node[] {
    const hero = this.hero;
    if (this.stock.visit !== this.game.visits) this.stock = { visit: this.game.visits, list: ops.vendorStock(hero, this.game.visits) };
    return [h('section', {}, h('h3', {}, 'Wares (restocked every visit)'), ...this.stock.list.map((entry, i) => h('div', { class: 'row' },
      h('img', { class: 'pix', src: this.icons.icon(entry.item), alt: '', style: { width: '40px', height: '40px', background: '#0b0a10' } }),
      h('div', { class: 'grow' }, this.tooltip(entry.item, (() => { const s = ops.slotFor(hero, entry.item); return s ? hero.equipment[s] ?? null : null; })())),
      h('button', {
        class: 'ui-btn small primary', disabled: hero.gold < entry.price, onclick: () => {
          const err = ops.buy(hero, entry);
          if (!err) this.stock.list.splice(i, 1);
          this.act(err, `Bought ${entry.item.name}`);
        },
      }, `Buy ${entry.price}g`))))];
  }

  private gambleView(): Node[] {
    const hero = this.hero;
    const cost = ops.gambleCost(hero);
    const kinds: SlotKind[] = ['weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'jewel'];
    return [h('section', {},
      h('h3', {}, `Mystery goods · ${cost}g each`),
      h('p', { class: 'note' }, 'Pick a kind of item; you get a random one, rolled with a big rarity bonus. Uniques are possible.'),
      h('div', { class: 'actions' }, ...kinds.map((k) => h('button', {
        class: 'ui-btn', disabled: hero.gold < cost, onclick: () => {
          const err = ops.gamble(hero, k, hero.nextUid * 104729 + hero.gold);
          const got = err ? null : hero.inventory.filter(Boolean).slice(-1)[0];
          this.act(err);
          if (got) this.toast(`Got: ${got.name}`, RARITY_COLOR[got.rarity]);
        },
      }, k[0].toUpperCase() + k.slice(1)))))];
  }

  // ---------------------------------------------------------------- character

  private skillsView(): Node[] {
    const hero = this.hero;
    const game = this.game;
    const ch = game.sim.player;
    const known = new Set(heroSkills(hero));
    const unlockAt = new Map<string, string>();
    for (const n of TREE.nodes) if (n.skill) unlockAt.set(n.skill, SECTOR_NAME[n.sector]);
    const cards = HERO_SKILLS.filter((s) => HOTBAR_SKILLS.includes(s.id)).sort((a, b) => Number(known.has(b.id)) - Number(known.has(a.id))).map((s) => {
      const learned = known.has(s.id);
      const est = learned && ch ? estimateSkill(game.sim, ch, s) : null;
      const cost = ch ? costOf(game.sim, ch, s) : s.cost ?? 0;
      const cd = ch ? cooldownOf(game.sim, ch, s) : s.cooldown ?? 0;
      return h('div', { class: `skillcard${learned ? '' : ' locked'}` },
        skillIconNode(s.id),
        h('div', { class: 'd' },
          h('b', {}, s.name), ' ', h('small', { class: 'note' }, s.tags.filter((t) => !t.startsWith('skill:')).join(' · ')),
          h('div', {}, s.desc),
          h('small', { class: 'note' }, learned
            ? `${est ? `~${Math.round(est.hit)} per hit${est.critChance > 0 ? `, ${est.critChance.toFixed(0)}% crit` : ''}` : ''}${cost ? ` · ${cost.toFixed(0)} mana` : ''}${cd ? ` · ${cd.toFixed(1)}s cooldown` : ''}`
            : `Unlock in the ${unlockAt.get(s.id) ?? '?'} region of the passive tree.`)),
        learned ? h('div', { class: 'slots' }, ...[0, 1, 2, 3, 4].map((i) => h('button', {
          class: `ui-btn small${hero.hotbar[i] === s.id ? ' primary' : ''}`, title: `Put in slot ${i + 1}`,
          onclick: () => this.act(ops.setHotbar(hero, i, hero.hotbar[i] === s.id ? null : s.id)),
        }, String(i + 1)))) : null);
    });
    const slash = ch ? estimateSkill(game.sim, ch, SKILLS.slash1) : null;
    return [h('section', {},
      h('h3', {}, 'Hotbar'),
      h('p', { class: 'note' }, `Basic attack: Slash${slash ? ` (~${Math.round(slash.hit)} per hit)` : ''}. Slots 1–5 hold your skills; tap a number on a skill to slot it there. More skills unlock in the passive tree (P).`),
      ...cards)];
  }

  private statsView(): Node[] {
    const hero = this.hero;
    const sim = this.game.sim;
    const ch = sim.player;
    if (!ch) return [];
    const st = sim.stats(ch);
    const w = sim.heroBuild?.weapon;
    const row = (k: string, v: string | number) => [h('span', {}, k), h('span', {}, String(v))];
    const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(Math.abs(v) < 10 ? 1 : 0));
    const groups: Array<[string, Array<[string, string | number]>]> = [
      ['Hero', [['Level', hero.level], ['Experience', `${hero.xp} / ${xpToNext(hero.level)}`], ['Passive points', `${treePoints(hero)} unspent`], ['Gold', hero.gold], ['Kills', hero.totals.kills], ['Deepest cleared', hero.progress.endlessBest]]],
      ['Attributes', [['Strength', fmt(st.get('str'))], ['Dexterity', fmt(st.get('dex'))], ['Intelligence', fmt(st.get('int'))]]],
      ['Defence', [['Life', `${Math.round(ch.life)} / ${Math.round(ch.maxLife)}`], ['Mana', `${Math.round(ch.mana)} / ${Math.round(ch.maxMana)}`], ['Life regen', `${fmt(st.get('lifeRegen') + (st.get('lifeRegenPct') / 100) * ch.maxLife)}/s`], ['Mana regen', `${fmt(st.get('manaRegen'))}/s`],
        ['Armour', fmt(st.get('armor'))], ['Evasion', fmt(st.get('evasion'))], ['Block', `${fmt(st.get('block'))}%`],
        ['Fire / Cold / Lightning', `${fmt(st.get('resFire'))}% / ${fmt(st.get('resCold'))}% / ${fmt(st.get('resLightning'))}%`], ['Chaos resistance', `${fmt(st.get('resChaos'))}%`]]],
      ['Offence', [['Weapon', w ? Object.entries(w.dmg).map(([t, r]) => `${r![0]}-${r![1]} ${t}`).join(', ') : '-'], ['Attack speed', `${fmt(st.get('attackSpeed') * (w?.speed ?? 1))}%`], ['Cast speed', `${fmt(st.get('castSpeed'))}%`],
        ['Crit multiplier', `${fmt(st.get('critMulti'))}%`], ['Area of effect', `${fmt(st.get('area'))}%`], ['Move speed', `${fmt(st.get('moveSpeed'))}%`], ['Cooldown recovery', `${fmt(st.get('cooldownRecovery'))}%`]]],
      ['Loot', [['Item rarity', `+${fmt(st.get('itemRarity'))}%`], ['Item quantity', `+${fmt(st.get('itemQuantity'))}%`], ['Gold find', `+${fmt(st.get('goldFind'))}%`]]],
    ];
    const rules = st.mods.filter((m) => m.kind === 'flag' && STATS[m.stat].group === 'rules').map((m) => describeMod(m, SKILL_NAMES));
    return [
      ...groups.map(([title, rows]) => h('section', {}, h('h3', {}, title), h('div', { class: 'stat' }, ...rows.flatMap(([k, v]) => row(k, v))))),
      rules.length ? h('section', {}, h('h3', {}, 'Rules'), ...[...new Set(rules)].map((r) => h('div', { class: 'note' }, r))) : null,
    ].filter((x): x is HTMLElement => !!x);
  }

  // ---------------------------------------------------------------- codex

  /** Species slain (with portraits), uniques found, pinnacles defeated. */
  private codexView(): Node[] {
    const codex = this.hero.progress.codex;
    const game = this.game;
    this.portraits ??= new PortraitRenderer(game.renderer, game.pipeline, game.stage.basis, game.lib);
    const pr = this.portraits;
    const name = (def: string) => {
      try {
        return ensureMonster(def).name;
      } catch {
        return 'A forgotten creation';
      }
    };
    const species = Object.entries(codex.kills).sort((a, b) => b[1] - a[1]);
    const SHOW = 48;
    const pinCards = PINNACLE_IDS.map((id, i) => {
      const won = codex.pinnacles.includes(id);
      const md = MONSTERS[id];
      const src = won ? pr.portrait(id) : '';
      return h('div', { class: `ccard${won ? '' : ' locked'}` },
        src ? h('img', { class: 'pix', src, alt: '' }) : h('div', { class: 'ph' }, '?'),
        h('div', {}, h('b', {}, won ? md.name : '???'), h('small', {}, won ? md.boss!.title : `Waits at depth ${(i + 1) * 10}${i + 1 + PINNACLE_IDS.length <= 99 ? `, ${(i + 1 + PINNACLE_IDS.length) * 10}` : ''}…`)));
    });
    const uniqueCells = UNIQUES.map((u) => {
      const found = codex.uniques.includes(u.id);
      return h('div', { class: `cell${found ? ' r-unique' : ''}`, title: found ? `${u.name} — ${u.flavour}` : `Undiscovered ${KIND_LABEL[itemBase(u.base).slot]}` },
        found ? h('img', { class: 'pix', src: this.icons.icon({ base: u.base, rarity: 'unique', seed: 1, unique: u.id }), alt: u.name }) : h('span', { class: 'lbl', style: { position: 'static', fontSize: '16px' } }, '?'));
    });
    const speciesCards = species.slice(0, SHOW).map(([def, kills]) => {
      const src = pr.portrait(def);
      return h('div', { class: 'ccard' }, src ? h('img', { class: 'pix', src, alt: '' }) : h('div', { class: 'ph' }, '·'), h('div', {}, h('b', {}, name(def)), h('small', {}, `${kills.toLocaleString()} slain`)));
    });
    return [
      h('section', { class: 'codex', style: { flexBasis: '100%' } },
        h('p', { class: 'note' }, `${species.length} species slain · ${codex.uniques.length}/${UNIQUES.length} uniques found · ${codex.pinnacles.length}/${PINNACLE_IDS.length} pinnacles defeated`),
        h('h3', {}, 'Pinnacles'), h('div', { class: 'ccards' }, ...pinCards),
        h('h3', {}, `Uniques (${codex.uniques.length}/${UNIQUES.length})`), h('div', { class: 'grid' }, ...uniqueCells),
        h('h3', {}, `Bestiary (${species.length})`),
        species.length ? h('div', { class: 'ccards' }, ...speciesCards) : h('p', { class: 'note' }, 'Every species you slay is recorded here, from the humble hollow to creatures no one has named yet.'),
        species.length > SHOW ? h('p', { class: 'note' }, `…and ${species.length - SHOW} more.`) : null),
    ];
  }

  // ---------------------------------------------------------------- tree / respec / waypoint

  private treeContent(): Node[] {
    if (!this.treeView) this.treeView = new TreeView(() => this.hero, () => this.game.sim.refreshHero(), (t) => this.toast(t, '#ff8a8a'));
    const extra: Node[] = [];
    const sel = this.selected;
    const jewelSel = sel ? ops.itemAt(this.hero, sel) : null;
    if (jewelSel && itemBase(jewelSel.base).slot === 'jewel') extra.push(h('p', { class: 'note' }, `Selected jewel: ${jewelSel.name}. Allocate a socket in the tree, then use “Socket” in its details.`));
    return [this.treeView.el, ...extra];
  }

  private respecView(): Node[] {
    const hero = this.hero;
    const cost = ops.respecCost(hero);
    return [h('section', {},
      h('h3', {}, 'Unmake your choices'),
      h('p', { class: 'note' }, `Refund every passive point (${hero.tree.length} allocated). Single nodes can also be refunded from the tree for ${ops.refundCost(hero)}g each.`),
      h('button', { class: 'ui-btn danger', disabled: !hero.tree.length || hero.gold < cost, onclick: () => this.act(ops.respecAll(hero), 'All passive points refunded') }, `Refund all (${cost}g)`),
      h('h3', {}, 'Jewels'),
      h('p', { class: 'note' }, 'Jewels drop from monsters and sit in jewel sockets of the tree. Select a jewel in your bags, then press Socket on an allocated socket.'),
      ...Object.keys(hero.jewels).map((k) => h('div', { class: 'note' }, `${k}: ${hero.jewels[k].name}`)),
      h('div', { class: 'actions' }, ...TREE.nodes.filter((n) => n.kind === 'socket' && hero.tree.includes(n.id)).map((n) => h('button', {
        class: 'ui-btn small', onclick: () => {
          const jewelIdx = hero.inventory.findIndex((it) => it && itemBase(it.base).slot === 'jewel');
          if (jewelIdx < 0) return this.toast('No jewel in your bags');
          this.act(ops.socketJewel(hero, n.id, { area: 'inventory', index: jewelIdx }), 'Jewel socketed');
        },
      }, `Socket into ${n.id}${hero.jewels[n.id] ? ' (swap)' : ''}`))),
    )];
  }

  private waypointView(): Node[] {
    const hero = this.hero;
    const rows: HTMLElement[] = [];
    const max = Math.max(1, hero.progress.unlocked);
    for (let n = 1; n <= max; n++) {
      const best = hero.progress.cleared[String(n)];
      const mechs = stageMechanics(n);
      rows.push(h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('b', {}, `${n}. ${stageTitle(n)}`), ' ',
          h('small', {}, best ? `cleared · best ${fmtTime(best / 60)}` : n === max ? 'new' : 'not cleared'),
          h('div', {}, ...mechs.map((m) => h('span', { class: 'mech', title: MECHANICS[m].tip }, MECHANICS[m].name)))),
        h('button', { class: `ui-btn small${n === max ? ' primary' : ''}`, onclick: () => { this.close(); void this.game.enterStage(n); } }, 'Enter')));
    }
    rows.reverse();
    // Pacts: optional risk for reward, unlocked as the hero goes deeper.
    const open = PACTS.filter((p) => p.minDepth <= max);
    const chosen = this.game.pacts.filter((id) => open.some((p) => p.id === id));
    const pactBox = open.length ? h('section', {},
      h('h3', {}, 'Pacts'),
      h('p', { class: 'note' }, 'Optional: make the depths harder for better rewards. Pacts stay until you change them.'),
      h('div', { class: 'pacts' }, ...open.map((p) => h('button', {
        class: `ui-btn small${chosen.includes(p.id) ? ' primary' : ''}`, 'aria-pressed': String(chosen.includes(p.id)), title: `${p.desc} Reward: ${pactRewardText([p.id])}`,
        onclick: () => {
          this.game.pacts = chosen.includes(p.id) ? chosen.filter((x) => x !== p.id) : [...chosen, p.id];
          this.render();
        },
      }, h('span', { style: { color: p.color } }, '◆ '), p.name))),
      chosen.length
        ? h('div', { class: 'note' }, h('b', {}, 'Risk: '), pactsOf(chosen).map((p) => p.desc).join(' '), h('br'), h('b', {}, 'Reward: '), pactRewardText(chosen))
        : h('div', { class: 'note' }, 'No pacts: the depths as they come.'),
    ) : null;
    const locked = PACTS.find((p) => p.minDepth > max);
    // Daily Trial: the same seeded challenge for everyone today, at this hero's frontier.
    const trial = dailyTrial(dateKey(), hero.progress.unlocked);
    const best = hero.progress.trials[trial.key];
    const trialBox = h('section', {},
      h('h3', {}, 'Daily Trial'),
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('b', {}, trial.title), ' ', h('small', {}, `depth ${trial.depth} · ${best ? `best ${fmtFrames(best)}` : 'not cleared today'}`),
          h('div', {}, ...trial.mechanics.map((m) => h('span', { class: 'mech', title: MECHANICS[m].tip }, MECHANICS[m].name)), ...pactsOf(trial.pacts).map((p) => h('span', { class: 'mech', style: { borderColor: p.color, color: p.color }, title: p.desc }, p.name)))),
        h('button', { class: 'ui-btn small primary', onclick: () => { this.close(); void this.game.enterTrial(trial.key); } }, best ? 'Again' : 'Enter')),
      h('p', { class: 'note' }, best ? 'Race your best time. New mechanics and pacts tomorrow.' : 'Same mechanics and pacts for everyone today. The first clear pays a hoard; no campaign progress.'));
    return [trialBox, pactBox ?? h('section', {}, h('h3', {}, 'Pacts'), h('p', { class: 'note' }, `Reach depth ${locked?.minDepth ?? 3} to make pacts: harder depths for richer rewards.`)),
      h('section', { class: 'stagelist' },
        h('h3', {}, 'Choose a depth'),
        h('p', { class: 'note' }, 'Each depth is named after its trick: use it, or ignore it and swing harder. Clear the boss to unlock the next. Past depth 24 new depths combine tricks forever.'),
        ...rows)];
  }
}

