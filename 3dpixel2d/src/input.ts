/**
 * Keyboard/mouse for a human glancing at the demo. Agents never need this: they use the agent API
 * (and in ?agent mode this is not attached at all). Keys only write input while a key is held or
 * was just released, so an agent driving the player through the API is not overridden.
 */
import { config, setConfig, type ConfigKey } from './config';
import type { Game } from './game';
import { PALETTE_NAMES } from './render/palettes';

export const KEY_HELP = [
  'WASD/arrows move  Shift sprint  Alt walk  Space jump  J/click attack',
  'P pixel/3D  O outlines  I creases  L palette  F snap movers  C smooth scroll',
  'T stepped anim  Y 8-dir  V silhouettes  G colliders  B shadows  1-4 anim fps',
  'Esc pause  N step 1 frame  R reset  H hide help',
];

const TOGGLES: Record<string, ConfigKey> = {
  KeyP: 'render.pixelMode',
  KeyO: 'render.outlines',
  KeyI: 'render.innerLines',
  KeyF: 'render.snapMovers',
  KeyC: 'render.smoothScroll',
  KeyT: 'anim.stepped',
  KeyY: 'anim.dir8',
  KeyV: 'render.silhouettes',
  KeyG: 'render.colliders',
  KeyB: 'render.shadows',
};

export function attachInput(game: Game, hooks: { toggleHelp(): void; reset(): void }) {
  const held = new Set<string>();
  let wasActive = false;
  const player = () => game.sim.characters.get(game.stage.follow);
  const touchHeld = new Map<number, string>();
  const clear = () => { held.clear(); touchHeld.clear(); };
  document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      touchHeld.set(e.pointerId, button.dataset.key!);
      const ch = player();
      if (ch && button.dataset.key === 'Space') ch.input.jump = true;
      if (ch && button.dataset.key === 'KeyJ') ch.input.attack = true;
    });
    const release = (e: PointerEvent) => touchHeld.delete(e.pointerId);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });
  document.getElementById('mode')?.addEventListener('click', () => {
    setConfig('render.pixelMode', !config['render.pixelMode']);
  });
  document.getElementById('pause')?.addEventListener('click', (e) => {
    game.paused = !game.paused;
    (e.currentTarget as HTMLButtonElement).textContent = game.paused ? 'Resume' : 'Pause';
    clear();
  });
  document.getElementById('reset')?.addEventListener('click', () => { clear(); hooks.reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code.startsWith('Arrow') || e.code === 'Space' || e.altKey) e.preventDefault();
    held.add(e.code);
    if (e.repeat) return;
    const ch = player();
    if (TOGGLES[e.code]) setConfig(TOGGLES[e.code], !config[TOGGLES[e.code]]);
    else if (e.code === 'KeyL') {
      const i = PALETTE_NAMES.indexOf(config['render.palette'] as (typeof PALETTE_NAMES)[number]);
      setConfig('render.palette', PALETTE_NAMES[(i + 1) % PALETTE_NAMES.length]);
    } else if (e.code >= 'Digit1' && e.code <= 'Digit4') setConfig('anim.fps', [6, 8, 12, 24][Number(e.code.slice(5)) - 1]);
    else if (e.code === 'Escape') game.paused = !game.paused;
    else if (e.code === 'KeyN') game.step(1);
    else if (e.code === 'KeyR') hooks.reset();
    else if (e.code === 'KeyH') hooks.toggleHelp();
    else if (ch && e.code === 'Space') ch.input.jump = true;
    else if (ch && (e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'Enter')) ch.input.attack = true;
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', clear);
  game.canvas.addEventListener('mousedown', (e) => {
    const ch = player();
    if (ch && e.button === 0) ch.input.attack = true;
  });

  /** Call once per rendered frame. */
  return function applyInput() {
    const pressed = new Set([...held, ...touchHeld.values()]);
    const ch = player();
    if (!ch) return;
    const up = +(pressed.has('KeyW') || pressed.has('ArrowUp')) - +(pressed.has('KeyS') || pressed.has('ArrowDown'));
    const right = +(pressed.has('KeyD') || pressed.has('ArrowRight')) - +(pressed.has('KeyA') || pressed.has('ArrowLeft'));
    const active = up !== 0 || right !== 0;
    if (!active && !wasActive) return;
    wasActive = active;
    const b = game.stage.basis;
    let x = b.groundRight.x * right + b.groundUp.x * up;
    let z = b.groundRight.z * right + b.groundUp.z * up;
    const len = Math.hypot(x, z) || 1;
    x /= len;
    z /= len;
    ch.input.moveX = active ? x : 0;
    ch.input.moveZ = active ? z : 0;
    ch.input.gait = pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 'sprint' : pressed.has('AltLeft') ? 'walk' : 'run';
    ch.inputFrames = -1;
  };
}
