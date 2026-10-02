/**
 * End-to-end check of the single-file agent kit (kit/3dpixel2d.ts) in headless Chromium. Serves
 * kit/demo.html with Vite, opens it in agent mode and checks the agent tools, exact captures,
 * outlines, the palette lock, plain mode, picking, sprite stepping with pixel snapping, determinism
 * across page loads and a clean console. Captures are written to --out (default .agent/out/kit).
 *
 *   npm run verify:kit [-- --out DIR] [-- --headed]
 *
 * Browser: playwright-core's Chromium with SwiftShader WebGL (no GPU needed). Set CHROMIUM_PATH
 * when the installed Chromium is not the revision playwright-core expects.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const OUT = path.resolve(flag('--out', path.join(ROOT, '.agent', 'out', 'kit')));
const PICO8 = ['000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8', 'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'];

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const { createServer } = await import('vite');
const vite = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'error', server: { port: 5192, strictPort: false, host: '127.0.0.1' } });
await vite.listen();
const base = vite.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5192/';
const { chromium } = await import('playwright-core');
let browser;
try {
  browser = await chromium.launch({
    headless: !argv.includes('--headed'),
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
} catch (e) {
  console.error(`Chromium did not start: ${String(e.message).split('\n')[0]}\nSet CHROMIUM_PATH to an installed Chromium executable.`);
  await vite.close();
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const problems = [];

/** A demo page (agent mode unless `human`); console problems are collected. */
async function pageOf(seed, { human = false, ...context } = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, ...context });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  await page.goto(`${base}kit/demo.html?seed=${seed}${human ? '' : '&agent'}`);
  return page;
}

/** Opens the demo in agent mode; returns the page and tool helpers. */
async function open(seed) {
  const page = await pageOf(seed);
  await page.waitForFunction(() => window.agent?.ready || window.agent?.error, null, { timeout: 120000 });
  const error = await page.evaluate(() => window.agent.error ?? null);
  if (error) throw new Error(`demo failed to boot: ${error}`);
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([n, a]) => window.agent.call(n, a), [name, args]);
    if (!r.ok) throw new Error(`${name}: ${r.error}`);
    return r;
  };
  const save = async (file, args = {}) => {
    const r = await call('scene.capture', { scale: 2, ...args });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.images[0].png.split(',')[1], 'base64'));
    return r.data;
  };
  /** The exact frame: size, a byte hash and its distinct colours. */
  const frame = (hud = false) => page.evaluate((hud) => {
    const img = window.engine.capture({ hud });
    let h = 2166136261;
    const colors = new Set();
    for (let i = 0; i < img.data.length; i += 4) {
      for (let c = 0; c < 4; c++) h = Math.imul(h ^ img.data[i + c], 16777619);
      colors.add(((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]).toString(16).padStart(6, '0'));
    }
    return { width: img.width, height: img.height, hash: (h >>> 0).toString(16), colors: [...colors] };
  }, hud);
  return { page, call, save, frame };
}

/** The same input script, through the tools only. */
async function play(s) {
  await s.call('game.input', { input: { moveX: 0.7, moveZ: -0.7 }, frames: 45 });
  await s.call('game.step', { frames: 60 });
  await s.call('game.input', { input: { attack: true }, frames: 1 });
  const slash = await s.call('game.step', { frames: 30 });
  await s.call('game.input', { input: { moveX: -1 }, frames: 30 });
  const end = await s.call('game.step', { frames: 45 });
  const frame = await s.frame(true);
  return { hash: end.data.hash, frame: frame.hash, events: slash.data.events.map((e) => e.type) };
}

try {
  const a = await open(1);
  const help = await a.call('help');
  const tools = Object.values(help.data.groups).flat().map((t) => t.name);
  check('help lists the 7 built-in tools', tools.length === 7 && tools.includes('scene.capture'), tools.join(', '));
  await a.call('game.step', { frames: 30 });
  const state = (await a.call('game.state')).data;
  check('game.state reports the actors and input keys', state.actors.length === 4 && state.inputKeys.join() === 'moveX,moveZ,attack', `${state.actors.length} actors, input ${state.inputKeys}`);
  const shot = await a.save('01-demo.png');
  check('scene.capture returns the exact low-res frame', shot.width === state.view.width && shot.height === state.view.height && shot.width === 480, `${shot.width}x${shot.height}, scale ${state.view.scale}`);
  const hero = state.actors.find((x) => x.id === 'hero');
  const [hx, hy] = hero.screen;
  check('the camera centres the followed hero (feet ~24 px below centre)', Math.abs(hx - shot.width / 2) <= 1 && hy - shot.height / 2 >= 20 && hy - shot.height / 2 <= 28, `feet at ${hx},${hy}`);

  const lit = await a.frame();
  check('the frame has pixel-art detail', lit.colors.length > 20, `${lit.colors.length} colours`);
  await a.call('config.set', { values: { 'render.outlines': false } });
  const flat = await a.frame();
  check('outlines change the frame', flat.hash !== lit.hash);
  await a.save('02-no-outlines.png', { hud: false });
  await a.call('config.set', { values: { 'render.outlines': true, 'render.palette': 'pico8' } });
  const pico = await a.frame();
  const strays = pico.colors.filter((c) => !PICO8.includes(c));
  check('the palette lock leaves only PICO-8 colours', strays.length === 0 && pico.colors.length > 4, strays.length ? `strays ${strays.slice(0, 5)}` : `${pico.colors.length} colours`);
  await a.save('03-pico8.png');
  await a.call('config.set', { values: { 'render.palette': 'none', 'render.pixelMode': false } });
  const plain = await a.frame(true);
  check('plain 3D mode captures at the same size', plain.width === lit.width && plain.height === lit.height && plain.hash !== lit.hash);
  await a.save('04-plain-3d.png');
  await a.call('config.set', { values: { 'render.pixelMode': true } });

  const pick = await a.page.evaluate(() => {
    const r = window.engine.canvas.getBoundingClientRect();
    const p = window.engine.pick(r.left + r.width / 2, r.top + r.height / 2);
    return p && window.engine.toCapture(p);
  });
  check('pick() and toCapture() round-trip the screen centre', !!pick && Math.abs(pick.x - lit.width / 2) <= 1 && Math.abs(pick.y - lit.height / 2) <= 1, pick ? `${pick.x.toFixed(2)},${pick.y.toFixed(2)}` : 'no hit');
  await a.page.screenshot({ path: path.join(OUT, '05-canvas.png') });

  const run1 = await play(await open(1)), run2 = await play(await open(1)), other = await play(await open(2));
  check('the same seed and inputs give the same state and pixels', run1.hash === run2.hash && run1.frame === run2.frame, `state ${run1.hash}, frame ${run1.frame}`);
  check('another seed gives another state', other.hash !== run1.hash);
  check('the attack input slashes', run1.events.includes('slash'), run1.events.join(', '));

  // Sprite stepping with pixel snapping, the core trick: with the camera fixed and the room hidden,
  // the walking hero is the only thing drawn. Within one sprite tick it must be the identical block
  // of pixels, only moved by whole pixels; between ticks the pose changes.
  const s = await open(1);
  const walk = (snap) => s.page.evaluate(async (snap) => {
    const e = window.engine, w = e.world;
    window.agent.step(1);
    for (const id of [...w.actors.keys()]) if (id !== 'hero') w.remove(id);
    for (const o of e.scene.children) if (o.isMesh && o.name !== 'blob-shadow') o.visible = false;
    e.lights.group.visible = false;
    await window.agent.call('config.set', { values: { 'render.blobShadows': false, 'render.snapMovers': snap } });
    const hero = w.get('hero');
    hero.pos = { x: -4, y: 0, z: 4.6 };
    hero.prevPos = { ...hero.pos };
    hero.yaw = Math.PI / 2;
    e.follow = null;
    e.focus.set(-3, 0.9, 4.6);
    w.setInput({ moveX: 1, moveZ: 0 });
    const frames = [];
    for (let i = 0; i < 30; i++) {
      e.step(1);
      const img = e.capture({ hud: false });
      const bg = img.data.slice(0, 3).join();
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const k = (y * img.width + x) * 4;
          if (`${img.data[k]},${img.data[k + 1]},${img.data[k + 2]}` === bg) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      let h = 2166136261;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const k = (y * img.width + x) * 4;
          for (let c = 0; c < 3; c++) h = Math.imul(h ^ img.data[k + c], 16777619);
        }
      frames.push({ tick: hero.sprite.tick, x: x0, y: y0, crop: (h >>> 0).toString(16), heroX: hero.pos.x });
    }
    return frames;
  }, snap);
  const pairs = (frames) => frames.slice(1).map((f, i) => ({ prev: frames[i], f }));
  const snapped = await walk(true);
  const sameTick = pairs(snapped).filter(({ prev, f }) => prev.tick === f.tick);
  check('within a sprite tick the hero is the identical pixel block', sameTick.length >= 15 && sameTick.every(({ prev, f }) => prev.crop === f.crop), `${sameTick.length} same-tick pairs`);
  check('the held pose moves by whole pixels as the hero walks', new Set(snapped.map((f) => f.x)).size >= 10 && snapped.at(-1).heroX > snapped[0].heroX + 1, `x ${snapped[0].x} -> ${snapped.at(-1).x}`);
  check('the pose changes on sprite ticks', new Set(snapped.map((f) => f.crop)).size >= 3, `${new Set(snapped.map((f) => f.tick)).size} ticks, ${new Set(snapped.map((f) => f.crop)).size} distinct poses`);
  const loose = await walk(false);
  check('without snapping the same pose re-rasterizes (control)', pairs(loose).some(({ prev, f }) => prev.tick === f.tick && prev.crop !== f.crop));

  // People: the same page without ?agent runs in real time on touch, mouse and keyboard.
  const phone = await pageOf(1, { human: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await phone.waitForFunction(() => window.agent?.ready && window.engine.world.frame > 10, null, { timeout: 60000 });
  const heroPos = (pg) => pg.evaluate(() => ({ ...window.engine.world.get('hero').pos }));
  /** Client (CSS px) position of a world point, through the capture mapping. */
  const clientOf = (pg, p) => pg.evaluate((p) => {
    const e = window.engine, c = e.toCapture(p), r = e.viewRect(), pl = e.pipeline, box = e.canvas.getBoundingClientRect();
    return { x: box.left + ((c.x + r.x) * pl.scale - (pl.width * pl.scale - pl.deviceW) / 2) / devicePixelRatio, y: box.top + ((c.y + r.y) * pl.scale - (pl.height * pl.scale - pl.deviceH) / 2) / devicePixelRatio };
  }, p);
  // 2 m toward the camera: straight down the screen, so it stays visible on a narrow phone.
  const start = await heroPos(phone), goal = { x: start.x + 1.4, y: 0, z: start.z + 1.4 };
  const tapAt = await clientOf(phone, goal);
  await phone.touchscreen.tap(tapAt.x, tapAt.y);
  await phone.waitForTimeout(2500);
  const reached = await heroPos(phone);
  check('touch: tapping the floor walks the knight there', Math.hypot(reached.x - goal.x, reached.z - goal.z) < 0.5, `${Math.hypot(reached.x - goal.x, reached.z - goal.z).toFixed(2)} m from the tap`);
  const onHero = await clientOf(phone, { ...reached, y: 0.8 });
  await phone.touchscreen.tap(onHero.x, onHero.y);
  await phone.waitForTimeout(600);
  const slashes = await phone.evaluate(() => window.engine.world.events.filter((e) => e.type === 'slash').length);
  check('touch: tapping the knight slashes', slashes === 1, `${slashes} slash event(s)`);
  await phone.screenshot({ path: path.join(OUT, '06-phone.png') });
  const desk = await pageOf(1, { human: true });
  await desk.waitForFunction(() => window.agent?.ready && window.engine.world.frame > 10, null, { timeout: 60000 });
  const before = await heroPos(desk);
  await desk.keyboard.down('KeyD');
  await desk.waitForTimeout(700);
  await desk.keyboard.up('KeyD');
  const after = await heroPos(desk);
  // D walks screen-right, which is +X -Z on the ground with the 45° camera.
  check('keyboard: holding D walks the knight screen-right', after.x - before.x > 0.3 && after.z - before.z < -0.3, `moved ${(after.x - before.x).toFixed(2)}, ${(after.z - before.z).toFixed(2)}`);

  check('no console errors or warnings', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (e) {
  check('verification ran to the end', false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  await vite.close();
}
const shown = path.relative(ROOT, OUT);
console.log(`\n${failed ? `${failed} check(s) failed` : 'all checks passed'}; captures in ${shown.startsWith('..') ? OUT : shown}`);
process.exit(failed ? 1 : 0);
