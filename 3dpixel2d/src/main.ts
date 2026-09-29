/**
 * Entry point. URL params:
 *   ?agent      agent mode: starts paused, no keyboard, no HUD; drive it with window.agent
 *   ?seed=N     RNG seed (default 1)
 *   ?plain      start in plain 3D mode (render.pixelMode = false)
 */
import * as THREE from 'three';
import { setConfig } from './config';
import { Game } from './game';
import { KEY_HELP, attachInput } from './input';
import { AssetLibrary } from './render/assets';

const params = new URLSearchParams(location.search);
const agentMode = params.has('agent');

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLPreElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;

  const lib = new AssetLibrary(`${import.meta.env.BASE_URL}assets/`);
  await lib.init([]);
  const game = new Game(renderer, lib, canvas);
  if (params.has('plain')) setConfig('render.pixelMode', false);
  await game.reset({ seed: Number(params.get('seed') ?? 1) });

  const agent = { ready: false, step: (frames = 1) => game.step(frames) };
  Object.assign(window, { agent, game });

  let showHelp = !agentMode;
  const applyInput = agentMode
    ? () => {}
    : attachInput(game, { toggleHelp: () => (showHelp = !showHelp), reset: () => void game.reset() });
  if (agentMode) game.paused = true;
  document.getElementById('loading')?.remove();
  document.body.classList.toggle('agent-mode', agentMode);

  let last = performance.now();
  const loop = (now: number) => {
    if (agentMode && game.paused) {
      // Agent mode renders on demand (every API call that changes state draws a frame).
      last = now;
      requestAnimationFrame(loop);
      return;
    }
    applyInput();
    game.advance((now - last) / 1000);
    last = now;
    if (!agentMode) {
      const p = game.pipeline;
      const status = `${game.paused ? 'PAUSED  ' : ''}${game.fps} fps  frame ${game.sim.frame}  ${p.width - 2 * p.margin}x${p.height - 2 * p.margin} x${p.scale}`;
      hud.textContent = showHelp ? `${status}\n${matchMedia('(pointer: coarse)').matches ? 'Move with the pad • Jump / Attack\nPixel / 3D switches rendering' : KEY_HELP.join('\n')}` : '';
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
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
