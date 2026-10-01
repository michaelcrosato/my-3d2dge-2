/**
 * Entry point. URL params:
 *   ?agent      agent mode: starts paused, no human input, no HUD or settings; drive it with window.agent
 *   ?seed=N     RNG seed (default 1)
 *   ?plain      start in plain 3D mode (render.pixelMode = false)
 */
import * as THREE from 'three';
import { setConfig } from './config';
import { Game } from './game';
import { InputController } from './input/controller';
import { SettingsStore } from './input/store';
import { AssetLibrary } from './render/assets';
import { h } from './ui/dom';
import { hudText } from './ui/hud';
import { SettingsMenu } from './ui/settings';
import { installStyles } from './ui/styles';
import { toast } from './ui/toast';
import { CONTROL_LABELS, TouchControls } from './ui/touch';

const params = new URLSearchParams(location.search);
const agentMode = params.has('agent');

/** Settings, input devices, touch overlay, toolbar and HUD for people (never in agent mode). */
function setupHuman(game: Game) {
  installStyles();
  const store = new SettingsStore();
  store.applyGraphics();
  // URL overrides are for this visit only; they are not saved into the profile.
  if (params.has('plain')) store.transient(() => setConfig('render.pixelMode', false));
  const hud = document.getElementById('hud') as HTMLPreElement;
  const touchHost = document.getElementById('touch') as HTMLElement;
  let editing = false;
  let editWasPaused = false;

  let menu: SettingsMenu | null = null;
  const input = new InputController(game, store, {
    menuOpen: () => !!menu?.open || editing,
    toggleMenu: () => (editing ? stopEdit() : menu?.toggle()),
    menuNav: (cmd) => (editing ? cmd === 'back' && stopEdit() : menu?.nav(cmd)),
    reset: () => void game.reset(),
    toggleHelp: () => store.update((p) => (p.prefs.showHelp = !p.prefs.showHelp)),
    toggleStats: () => store.update((p) => (p.prefs.showStats = !p.prefs.showStats)),
    message: toast,
    sprintLatched: (on) => touch.setSprintLatched(on),
  });
  input.attach();

  const touch = new TouchControls(touchHost, () => store.active.touch, {
    move: (m) => input.touchMoveTo(m),
    press: (a) => input.touchPress(a),
    hold: (_a, on) => input.touchHold(on),
  });
  const coarse = matchMedia('(pointer: fine)');
  const touchVisible = () => {
    const show = store.active.touch.show;
    const d = input.device;
    const likelyTouch = !(coarse.matches && window.innerWidth >= 900);
    return editing || show === 'always' || (show === 'auto' && (d === 'touch' || (d !== 'gamepad' && d !== 'keyboard' && likelyTouch)));
  };
  const syncTouch = () => {
    const visible = touchVisible();
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

  const pauseButton = document.getElementById('pause') as HTMLButtonElement;
  document.getElementById('mode')?.addEventListener('click', () => input.press('togglePixel'));
  pauseButton.addEventListener('click', () => (game.paused = !game.paused));
  document.getElementById('reset')?.addEventListener('click', () => void game.reset());
  document.getElementById('settings-open')?.addEventListener('click', () => menu?.show());

  // HUD text changes every frame (frame counter), so refresh it a few times a second, not per frame.
  let hudAt = 0;
  let shownPaused: boolean | null = null;
  return () => {
    input.update();
    const now = performance.now();
    if (game.paused !== shownPaused) {
      shownPaused = game.paused;
      pauseButton.textContent = game.paused ? 'Resume' : 'Pause';
      hudDirty = true;
    }
    if (hudDirty || now - hudAt > 250) {
      hudAt = now;
      hudDirty = false;
      const text = hudText(game, store.active, input.device, !touchHost.hidden);
      if (hud.textContent !== text) hud.textContent = text;
    }
  };
}

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;

  const lib = new AssetLibrary(`${import.meta.env.BASE_URL}assets/`);
  await lib.init([]);
  const game = new Game(renderer, lib, canvas);
  if (agentMode && params.has('plain')) setConfig('render.pixelMode', false);
  const human = agentMode ? null : setupHuman(game);
  await game.reset({ seed: Number(params.get('seed') ?? 1) });

  const agent = { ready: false, step: (frames = 1) => game.step(frames) };
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
    human?.();
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
