/**
 * Entry point. URL params:
 *   ?agent       agent mode: starts paused, no human input or UI; drive it with window.agent
 *   ?seed=N      RNG seed (default 1)
 *   ?plain       start in plain 3D mode (render.pixelMode = false)
 *   ?sandbox     open the training room directly (agents default to it)
 *   ?town        start a fresh hero in town (agents and quick testing)
 *   ?stage=N     start a fresh hero at depth N (agents and quick testing)
 */
import * as THREE from 'three';
import { createAgentApi } from './agent/api';
import { registerWebMcp } from './agent/webmcp';
import { AudioEngine } from './audio/engine';
import { installLogCapture } from './agent/logs';
import { setConfig } from './config';
import { Game } from './game';
import { InputController, type PanelName } from './input/controller';
import type { TouchControl } from './input/profile';
import { SettingsStore } from './input/store';
import { AssetLibrary } from './render/assets';
import { SaveStore } from './save';
import { registerDesign, setReleased } from './content/bestiary';
import { SKILLS } from './content/skills';
import { newHero } from './sim/hero';
import { focusNav, h } from './ui/dom';
import { GameHud } from './ui/gameHud';
import { installGameStyles } from './ui/gameStyles';
import { hudText } from './ui/hud';
import { PauseMenu, TitleScreen } from './ui/menus';
import { Hints } from './ui/hints';
import { codeLabel, padLabel } from './input/resolve';
import type { Action } from './input/actions';
import { Workshop } from './ui/workshop';
import { Panels, type PanelId } from './ui/panels';
import { SettingsMenu } from './ui/settings';
import { installStyles } from './ui/styles';
import { toast } from './ui/toast';
import { CONTROL_LABELS, TouchControls } from './ui/touch';

const params = new URLSearchParams(location.search);
const agentMode = params.has('agent');

/** Big centered toasts for loot and warnings. */
function gtoast(text: string, color = '#f3ead6') {
  const host = document.getElementById('gtoast');
  if (!host) return toast(text);
  const el = h('div', { style: { color } }, text);
  host.append(el);
  while (host.children.length > 4) host.firstElementChild?.remove();
  setTimeout(() => el.remove(), 2600);
}

/** Settings, input devices, touch overlay, HUD, panels and menus for people (never in agent mode). */
function setupHuman(game: Game, saves: SaveStore) {
  installStyles();
  installGameStyles();
  const store = new SettingsStore();
  store.applyGraphics();
  saves.applyTune();
  // URL overrides are for this visit only; they are not saved into the profile.
  if (params.has('plain')) store.transient(() => setConfig('render.pixelMode', false));
  // Respect the system's reduced-motion request unless the player chose a shake strength.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches && store.active.graphics['ui.screenShake'] === undefined) store.transient(() => setConfig('ui.screenShake', 0));
  const hud = document.getElementById('hud') as HTMLPreElement;
  const touchHost = document.getElementById('touch') as HTMLElement;
  let editing = false;
  let editWasPaused = false;

  let menu: SettingsMenu | null = null;
  let panels: Panels | null = null;
  let pause: PauseMenu | null = null;
  let title: TitleScreen | null = null;
  let workshop: Workshop | null = null;
  let audio: AudioEngine | null = null;
  const anyOpen = () => !!menu?.open || !!panels?.open || !!pause?.open || !!title?.open || !!workshop?.open || editing;
  const togglePanel = (p: PanelName | PanelId) => {
    if (!game.hero || game.mode === 'sandbox' || game.mode === 'title') return;
    if (pause?.open) pause.hide();
    panels?.toggle(p as PanelId);
    audio?.play({ id: panels?.open ? 'ui_open' : 'ui_close' });
  };
  const input = new InputController(game, store, {
    menuOpen: anyOpen,
    toggleMenu: () => {
      if (editing) return stopEdit();
      if (menu?.open) return menu.hide();
      if (workshop?.open) return workshop.close();
      if (panels?.open) return panels.close();
      if (title?.open) return;
      pause?.toggle();
    },
    menuNav: (cmd) => {
      if (editing) return cmd === 'back' && stopEdit();
      if (menu?.open) return menu.nav(cmd);
      if (workshop?.open) return focusNav(workshop.el, cmd, () => workshop?.close());
      const box = panels?.open ? panels.el : pause?.open ? pause.el : title?.open ? title.el : null;
      if (box) focusNav(box, cmd, () => (panels?.open ? panels.close() : pause?.hide()));
    },
    reset: () => void (game.mode === 'dungeon' ? game.enterStage(game.stageNo) : game.mode === 'town' ? game.enterTown() : game.reset()),
    toggleHelp: () => store.update((p) => (p.prefs.showHelp = !p.prefs.showHelp)),
    toggleStats: () => store.update((p) => (p.prefs.showStats = !p.prefs.showStats)),
    message: toast,
    sprintLatched: (on) => touch.setSprintLatched(on),
    togglePanel,
    panelOpen: () => !!panels?.open && !menu?.open && !pause?.open,
    townPortal: () => {
      if (game.mode !== 'dungeon') return;
      gtoast('Returning to town…', '#7ab8ff');
      void game.enterTown();
    },
  });
  input.attach();

  const touch = new TouchControls(touchHost, () => store.active.touch, {
    move: (m) => input.touchMoveTo(m),
    press: (a) => input.touchPress(a),
    hold: (a, on) => input.touchHold(a, on),
  });
  touch.labelFor = (c: TouchControl) => {
    const hero = game.hero;
    const m = /^skill(\d)$/.exec(c);
    if (m && hero) {
      const id = hero.hotbar[Number(m[1]) - 1];
      return id ? SKILLS[id].name.split(' ')[0] : '·';
    }
    if (c === 'flask1' && hero) return `♥${Math.floor(hero.flasks[0] / 10)}`;
    if (c === 'flask2' && hero) return `✦${Math.floor(hero.flasks[1] / 10)}`;
    if (c === 'dodge') return 'Roll';
    return CONTROL_LABELS[c];
  };
  const coarse = matchMedia('(pointer: fine)');
  const touchVisible = () => {
    if (game.mode === 'title' || title?.open) return editing;
    const show = store.active.touch.show;
    const d = input.device;
    const likelyTouch = !(coarse.matches && window.innerWidth >= 900);
    return editing || show === 'always' || (show === 'auto' && (d === 'touch' || (d !== 'gamepad' && d !== 'keyboard' && d !== 'mouse' && likelyTouch)));
  };
  const syncTouch = () => {
    const visible = touchVisible();
    document.body.classList.toggle('touchui', visible);
    if (touchHost.hidden === visible) {
      touchHost.hidden = !visible;
      if (visible) touch.render();
    }
  };
  touch.render();
  syncTouch();
  input.deviceListeners.add(syncTouch);
  window.addEventListener('resize', syncTouch);

  // Live layout editing for the current orientation, with a small tool bar.
  const bar = h('div', { id: 'touch-edit-bar', hidden: true, role: 'toolbar', 'aria-label': 'Touch layout editor' });
  document.body.append(bar);
  const renderBar = () => {
    const c = touch.selected;
    const place = c ? store.active.touch.layouts[touch.orientation()][c] : null;
    bar.replaceChildren(
      h('div', { class: 'title' }, `Editing the ${touch.orientation() === 'portrait' ? '9:16 portrait' : '16:9 landscape'} layout: drag controls to move them${c ? ` • ${CONTROL_LABELS[c]}` : ''}`),
      h('button', { class: 'ui-btn small', disabled: !c, 'aria-label': 'Smaller', onclick: () => touch.resizeSelected(-0.1) }, '−'),
      h('button', { class: 'ui-btn small', disabled: !c, 'aria-label': 'Larger', onclick: () => touch.resizeSelected(0.1) }, '+'),
      h('button', { class: 'ui-btn small', disabled: !c, onclick: () => touch.toggleSelected() }, place && !place.visible ? 'Show' : 'Hide'),
      h('button', { class: 'ui-btn small', onclick: () => touch.resetLayout() }, 'Reset'),
      h('button', { class: 'ui-btn small primary', onclick: () => stopEdit() }, 'Done'),
    );
  };
  touch.onSelect = renderBar;
  touch.onLayoutChange = () => {
    store.update(() => {});
    renderBar();
  };
  window.addEventListener('resize', () => editing && renderBar());
  const startEdit = () => {
    menu?.hide();
    editing = true;
    editWasPaused = game.paused;
    game.paused = true;
    touch.setEditing(true);
    syncTouch();
    renderBar();
    bar.hidden = false;
    (bar.querySelector('.primary') as HTMLElement | null)?.focus();
  };
  function stopEdit() {
    editing = false;
    touch.setEditing(false);
    bar.hidden = true;
    store.update(() => {});
    game.paused = editWasPaused;
    syncTouch();
    menu?.show('touch');
  }

  let hudDirty = true;
  menu = new SettingsMenu(game, store, input, {
    touchChanged: () => {
      touch.render();
      syncTouch();
    },
    editTouchLayout: startEdit,
    prefsChanged: () => (hudDirty = true),
  });
  store.listeners.add(() => (hudDirty = true));
  input.deviceListeners.add(() => (hudDirty = true));

  panels = new Panels(game, gtoast);
  const ghud = new GameHud(game, gtoast, () => togglePanel('character'));
  // First-steps hints name the control for the device in use.
  const controlLabel = (a: Action): string => {
    const p = store.active;
    if (input.device === 'gamepad' && p.pad[a]?.[0]) return padLabel(p.pad[a][0]);
    if (document.body.classList.contains('touchui')) {
      const toolbar: Partial<Record<Action, string>> = { inventory: 'Bag', tree: 'Tree', character: 'Char', townPortal: '☰ → Return to town' };
      return toolbar[a] ?? (CONTROL_LABELS as Record<string, string>)[a] ?? a;
    }
    return p.keys[a]?.[0] ? codeLabel(p.keys[a][0]) : a;
  };
  const hints = new Hints(game, controlLabel);
  // Synthesized sound effects and ambience (starts on the first click / key / touch).
  audio = new AudioEngine(game);
  Object.assign(window, { audio });
  // The bestiary: Workshop species are registered at boot; released ones join the depths.
  for (const d of saves.file.bestiary) registerDesign(d);
  setReleased(saves.file.bestiary);
  let workshopFromTitle = false;
  workshop = new Workshop(game, saves, {
    toast: (t, c) => gtoast(t, c),
    testFight: (d) => {
      if (!game.hero) return;
      gtoast(`Entering the Proving Grounds: ${d.name}`, '#7ab8ff');
      void game.enterArena(d).then(() => syncTouch());
    },
    closed: () => {
      if (workshopFromTitle && game.mode === 'title') title?.show();
      workshopFromTitle = false;
      syncTouch();
    },
  });
  const hooks = {
    openSettings: () => menu?.show(),
    openPanel: (p: PanelId) => togglePanel(p),
    toast: (t: string) => gtoast(t),
    openWorkshop: () => {
      workshopFromTitle = game.mode === 'title';
      workshop?.show();
    },
  };
  pause = new PauseMenu(game, saves, hooks);
  title = new TitleScreen(game, saves, { ...hooks, started: () => syncTouch() });

  // Talking to townsfolk opens their panel.
  game.listeners.add((e) => {
    if (e.type !== 'npc.talk') return;
    const role = String(e.role);
    const map: Record<string, PanelId> = { merchant: 'merchant', smith: 'smith', sage: 'sage', stash: 'stash', waypoint: 'waypoint', shrine_respec: 'shrine_respec', anvil: 'smith' };
    const p = map[role];
    if (role === 'workshop') workshop?.show();
    else if (p) panels?.show(p);
    else gtoast(`${e.name}: “${role === 'guard' ? 'Every depth has its own trick. Learn it, or ignore it and swing harder.' : 'Lovely day for not going into the dungeon.'}”`);
  });
  window.addEventListener('game:title', () => {
    game.mode = 'title';
    game.paused = true;
    title?.show();
    syncTouch();
  });

  // Toolbar buttons (touch-friendly shortcuts).
  const btn = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
  btn('menu-open', () => (title?.open ? null : pause?.toggle()));
  btn('bag', () => togglePanel('inventory'));
  btn('treebtn', () => togglePanel('tree'));
  btn('charbtn', () => togglePanel('character'));
  btn('mode', () => input.press('togglePixel'));
  btn('settings-open', () => menu?.show());

  let hudAt = 0;
  let labelsAt = 0;
  let last = performance.now();
  return {
    title,
    tick: () => {
      input.update();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      game.overlayOptions.hover = input.pointerLowRes();
      game.overlayOptions.interactKey = input.device === 'gamepad' ? 'A' : (store.active.keys.interact[0] ?? 'E').replace(/^Key/, '');
      const p = store.active;
      let debug = '';
      const touchUi = document.body.classList.contains('touchui');
      if (game.mode === 'sandbox' || p.prefs.showStats || (p.prefs.showHelp && game.mode !== 'title' && !touchUi)) {
        if (hudDirty || now - hudAt > 250) {
          hudAt = now;
          hudDirty = false;
          debug = hudText(game, p, input.device, !touchHost.hidden);
        } else debug = hud.textContent ?? '';
      }
      if (game.mode === 'sandbox') {
        if (hud.textContent !== debug) hud.textContent = debug;
      } else if (hud.textContent) hud.textContent = '';
      ghud.update(p, input.device, dt, game.mode === 'sandbox' ? '' : debug);
      hints.update(dt);
      const toolbar = document.getElementById('toolbar')!;
      toolbar.hidden = game.mode === 'title';
      // Sit under the pixel minimap (its size depends on the integer upscale).
      const mm = game.overlay.minimapRect;
      const rect = game.canvas.getBoundingClientRect();
      const css = (v: number) => (v * game.pipeline.scale) / (window.devicePixelRatio || 1);
      const short = window.innerHeight <= 450;
      // Short landscape phones: a row beside the minimap; otherwise a column under it.
      const key = mm && game.mode !== 'sandbox' ? `${short}|${mm.y + mm.h}|${mm.w}|${game.pipeline.scale}` : 'none';
      if (toolbar.dataset.key !== key) {
        toolbar.dataset.key = key;
        if (!mm || game.mode === 'sandbox') {
          toolbar.style.top = 'max(8px, env(safe-area-inset-top))';
          toolbar.style.right = 'max(8px, env(safe-area-inset-right))';
          toolbar.style.flexDirection = '';
        } else if (short) {
          toolbar.style.top = 'max(6px, env(safe-area-inset-top))';
          toolbar.style.right = `${Math.round(css(mm.w) + 14)}px`;
          toolbar.style.flexDirection = 'row';
        } else {
          toolbar.style.top = `max(${Math.round(css(mm.y + mm.h - game.pipeline.margin) + rect.top + 8)}px, env(safe-area-inset-top))`;
          toolbar.style.right = 'max(8px, env(safe-area-inset-right))';
          toolbar.style.flexDirection = 'column';
        }
      }
      if (now - labelsAt > 250) {
        labelsAt = now;
        touch.refreshLabels();
      }
    },
  };
}

async function boot() {
  installLogCapture();
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;

  const lib = new AssetLibrary(`${import.meta.env.BASE_URL}assets/`);
  await lib.init([]);
  // Every model up front: monsters, summons and townsfolk spawn without hitches.
  await Promise.all(lib.manifest.models.map((m) => lib.loadModel(m.id)));
  const game = new Game(renderer, lib, canvas);
  if (agentMode && params.has('plain')) setConfig('render.pixelMode', false);
  const saves = new SaveStore(agentMode ? null : undefined);
  game.saves = saves;
  const human = agentMode ? null : setupHuman(game, saves);
  const seed = Number(params.get('seed') ?? 1);
  game.seed = seed;
  const stageParam = params.get('stage');
  // Quick starts and the title backdrop use throwaway heroes that never touch the save slots.
  if (stageParam) {
    game.hero = newHero();
    game.ephemeralHero = true;
    await game.enterStage(Math.max(1, Number(stageParam) || 1));
  } else if (params.has('town')) {
    game.hero = newHero();
    game.ephemeralHero = true;
    await game.enterTown();
  } else if (agentMode || params.has('sandbox')) {
    await game.reset({ seed });
    game.mode = 'sandbox';
  } else {
    // Title screen over the town as a living backdrop.
    game.hero = newHero();
    game.ephemeralHero = true;
    await game.enterTown();
    game.hero = null;
    game.mode = 'title';
    human?.title.show();
  }

  const agent = createAgentApi(game);
  // Browser AI agents (WebMCP) get the same tools as the console, CLI and MCP server.
  registerWebMcp(agent);
  Object.assign(window, { agent, game });
  if (agentMode) game.paused = true;
  document.getElementById('loading')?.remove();
  document.body.classList.toggle('agent-mode', agentMode);

  // THREE.Timer (r183+ replacement for Clock) ignores the time spent in a hidden tab.
  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = timer.getDelta();
    // Agent mode renders on demand (every API call that changes state draws a frame).
    if (agentMode && game.paused) return;
    human?.tick();
    // Title screen: the town lives on behind the menu.
    if (game.mode === 'title') {
      game.paused = false;
      game.advance(dt);
      return;
    }
    // Paused and nothing changed: the last frame is still on screen, skip the GPU work.
    if (game.paused && !game.needsRender) return;
    game.advance(dt);
  });
  agent.ready = true;
}

boot().catch((e) => {
  console.error(e);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `boot failed: ${e instanceof Error ? e.message : String(e)}`;
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Unable to start. Open this file in a browser with WebGL 2 support. See the error above.';
  Object.assign(window, { agent: { ready: false, error: String(e) } });
});
