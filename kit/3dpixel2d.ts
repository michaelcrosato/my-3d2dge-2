/**
 * 3dpixel2d agent kit: the Depthward engine in one file, for AI coding agents
 * =============================================================================================
 * Live 3D (three.js) drawn as crisp pixel-art sprites, on a deterministic 60 Hz simulation that
 * agents can step, inspect and photograph frame by frame. The rules, the rendering recipe,
 * working code and a playable demo are all here.
 * HOW TO READ IT: this header (the contract and API) and the EXAMPLE right after the imports (a
 * complete small game, runDemo) are all you need to build on the kit. The numbered sections after
 * them are the implementation; jump to one ("== 6.") only to change or debug that part.
 *
 * Distilled from github.com/michaelcrosato/my-3d2dge-2 (src/render, src/sim, src/agent,
 * src/config.ts). Its tests/kit.test.ts keeps the shared parts identical: GLSL, config, RNG, grid
 * math, palettes, material patches, lights, geometry kit, pixel font, tool registry.
 * Requires three@0.186 (+ @types/three) and WebGL 2; no assets or other packages. Load it as
 * TypeScript (it is erasable syntax only): Vite for the browser, and Node 22.18+ runs it unbuilt,
 * where World, Rng and the grid math work headless (tests, bots, balance runs).
 *
 * QUICK START
 *   import * as THREE from 'three';
 *   import { PixelEngine, ActorView, box, merge, toonMaterial, drawText, bindKeyboard, installAgent } from './3dpixel2d';
 *   const engine = new PixelEngine(canvas, { seed: 1 });
 *   engine.scene.add(new THREE.Mesh(merge([box(1, 1, 1, '#b98150', { at: [2, 0.5, 0] })]), toonMaterial(0xffffff, null, true)));
 *   const hero = engine.world.spawn('hero');                  // simulation state
 *   engine.addView('hero', new ActorView(heroObject3D));      // how it is drawn (model faces +Z)
 *   engine.world.onStep((w) => {                              // game logic: 60 Hz, deterministic
 *     hero.pos.x += Number(w.input.moveX) * 4 * w.dt;
 *     hero.pos.z += Number(w.input.moveZ) * 4 * w.dt;
 *   });
 *   engine.follow = 'hero';
 *   engine.hud = (g, r) => drawText(g, `frame ${engine.world.frame}`, r.x + 2, r.y + 2, '#fff');
 *   bindKeyboard(engine);   // WASD / arrows -> world.input (ignored in agent mode)
 *   installAgent(engine);   // window.agent: step / state / capture / call / tools
 *   engine.start();         // real-time loop; a page opened with ?agent starts paused
 *
 * RULES (the contract; break one and replays, captures and tests stop matching)
 *  1. The simulation is World.onStep systems: fixed 60 Hz steps, randomness only from world.rng,
 *     no wall clock, no DOM, no three.js objects. Same seed + same inputs = same world.hash().
 *  2. Rendering only reads the simulation: views interpolate prevPos -> pos by alpha and snap.
 *     UI, tools and previews never call world.rng (fork a new Rng(hashSeed(...)) instead).
 *  3. Every material in the scene writes view-space normals to a second render target: build
 *     with toonMaterial / glowMaterial / fxMaterial / toonize, or wrap with writesNormals(m).
 *     The engine patches stragglers and warns once. Custom ShaderMaterials must declare
 *     `layout(location = 1) out highp vec4 pc_fragNormal;` and write it. Use a colour background.
 *  4. Movers are drawn on whole art pixels (snapToGrid) and posed only on sprite ticks (anim.fps,
 *     12 by default) with 8-way facing. That is what makes 3D read as hand-drawn sprites.
 *  5. Tunables live in one flat table (CONFIG_SPEC) with descriptions and ranges. Agents read
 *     describeConfig() and change values through setConfig() or the config.set tool.
 *
 * HOW A FRAME IS MADE (pixel mode)
 *   scene ── one pass, two targets (colour + normals) + depth ──> low-res target (~270 lines)
 *   post  ── 1-px dark outline on the near side of depth edges, 1-px light crease from normal
 *            edges, sRGB encode, optional palette lock (nearest colour in OKLab) ──> 8-bit target
 *   upscale ── nearest neighbour, whole-number factor, centred, HUD canvas on top ──> screen
 *   Camera: orthographic, yaw 45, pitch 30 (exact 2:1 pixel lines), 31.1127 art px per metre:
 *   a 1 m floor tile is a 44x22 px diamond and a 1.8 m figure is about 48 px tall. Toon shading
 *   has 3 hard bands; a fixed pool of 16 point lights moves to where light is needed, so changing
 *   lights never recompiles shaders.
 *
 * API AT A GLANCE (§ = section)
 *   new PixelEngine(canvas, { seed, clips, input, agentMode, yawDeg, pitchDeg, sun, world })   §12
 *     .scene .camera .world .lights .views .follow .focus .hud .background .paused .agentMode
 *     .addView(id, view) .onRender((alpha, dt) => {}) .start() .stop() .step(frames) .render()
 *     .capture({ hud }) -> Img .toCapture(worldPoint) .pick(clientX, clientY) .state() .dispose()
 *   new World({ seed, clips, input }) .spawn(id, { x, z, yawDeg, clip, data }) .get .remove   §10
 *     .onStep((w) => {}) .step() .setInput(partial, frames) .play(actor, clip, opts) .clipDone
 *     .turnToward(actor, yaw, rate) .emit(type, data) .eventsSince(seq) .hash() .snapshot()
 *     fields: .rng .dt .frame .input .actors .events;  Actor { id pos prevPos yaw groundY anim sprite data }
 *   new ActorView(object3D, { clips, pose: (p, view) => {}, shadow })                           §11
 *   toonMaterial(color, map?, vertexColors?) glowMaterial fxMaterial toonize writesNormals       §5
 *   box(w, h, d, color, { at, rot, scale }) cyl cone sphere torus ico octa lathe merge tone
 *     checkerTexture pixelTexture blobShadow freeze                                             §8
 *   engine.lights.add({ x, y, z, color, intensity, range, priority }) inside onRender           §7
 *   drawText(g, text, x, y, color) textWidth                                                    §9
 *   config[key] setConfig(key, value) describeConfig() resetConfig() configListeners            §1
 *   new Rng(seed).next/range/int/chance/pick/weighted/shuffle  hashSeed(...parts)  hashNumbers  §2
 *   isoBasis snapToGrid subPixel chooseScale dir8 screenToGround yawOf                          §3
 *   installAgent(engine) defineTool({ ... }) callTool describeTools bindKeyboard(engine)       §13
 *   runDemo(canvas, { seed }) the example game. Sections: 1 Config, 2 Determinism, 3 Pixel grid,
 *   4 Palettes, 5 Materials, 6 Pipeline, 7 Lights, 8 Modeling, 9 Pixel font, 10 World, 11 Views,
 *   12 Engine, 13 Agent tools.
 *
 * DRIVING IT AS AN AGENT (page opened with ?agent: paused, keyboard ignored, draws on demand)
 *   await agent.call('help')                                    tools by group, or one in detail
 *   await agent.call('game.input', { input: { moveX: 1 }, frames: 30 })   hold input 30 frames
 *   await agent.call('game.step', { frames: 60 })               exact frames; returns the events
 *   await agent.call('game.state')                              actors, sprite frames, screen px
 *   await agent.call('scene.capture', { scale: 2 })             exact low-res pixels as a PNG
 *   await agent.call('config.set', { values: { 'render.palette': 'pico8' } })
 *   Headless: playwright-core Chromium renders without a GPU with args ['--use-gl=angle',
 *   '--use-angle=swiftshader', '--enable-unsafe-swiftshader']; page.evaluate(() =>
 *   agent.call('scene.capture')) returns the PNG as a data URL. Add tools with defineTool().
 *
 * NOT IN THIS FILE (see the full repository): Rapier physics and character controllers
 * (src/sim/sim.ts), glTF character assembly and clip retargeting (src/render/characterView.ts,
 * retarget.ts), procedural creature genomes and rigs (src/content/procgen/creature.ts,
 * src/render/creature/), wall cutaway and occlusion silhouettes (src/render/materials.ts,
 * characterView.ts), replays, audio, input devices and touch UI, the ARPG itself and its 46 tools.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// == EXAMPLE: runDemo() ===========================================================================
// A complete small game on the kit, and its smoke test. Everything it calls is defined in the numbered
// sections below, which are the implementation: read one when you need to change or debug it.

const DEMO_CLIPS: ClipTable = {
  idle: { duration: 1.6, loop: true }, walk: { duration: 0.75, loop: true }, slash: { duration: 0.42, loop: false }, hop: { duration: 0.9, loop: true },
};

/** A knight from boxes on pivot groups (no skinning, no assets), facing +Z, with a procedural pose. */
function buildKnight() {
  const mat = toonMaterial(0xffffff, null, true);
  const root = new THREE.Group();
  const part = (parent: THREE.Object3D, at: [number, number, number], parts: THREE.BufferGeometry[]) => {
    const pivot = new THREE.Group();
    pivot.position.set(...at);
    pivot.add(new THREE.Mesh(merge(parts), mat));
    parent.add(pivot);
    return pivot;
  };
  const steel = '#9aa4b5', cloth = '#3d6fb6', leather = '#6b4a35';
  const leg = () => [box(0.14, 0.5, 0.14, cloth, { at: [0, -0.25, 0] }), box(0.15, 0.1, 0.22, leather, { at: [0, -0.5, 0.03] })];
  const arm = () => box(0.12, 0.42, 0.12, steel, { at: [0, -0.19, 0] });
  const hips = part(root, [0, 0.8, 0], [box(0.34, 0.16, 0.2, cloth)]);
  const torso = part(hips, [0, 0.06, 0], [box(0.4, 0.42, 0.24, steel, { at: [0, 0.24, 0] }), box(0.42, 0.06, 0.26, leather, { at: [0, 0.03, 0] })]);
  part(torso, [0, 0.46, 0], [box(0.26, 0.24, 0.26, '#e8b796', { at: [0, 0.13, 0] }), box(0.3, 0.14, 0.3, steel, { at: [0, 0.27, 0] }), box(0.2, 0.04, 0.02, '#262b44', { at: [0, 0.16, 0.135] })]);
  const armL = part(torso, [0.27, 0.42, 0], [arm()]);
  const armR = part(torso, [-0.27, 0.42, 0], [arm(), box(0.05, 0.05, 0.16, leather, { at: [0, -0.42, 0.04] }), box(0.04, 0.03, 0.62, '#dfe6f0', { at: [0, -0.42, 0.42] })]);
  const legL = part(hips, [0.1, -0.04, 0], leg()), legR = part(hips, [-0.1, -0.04, 0], leg());
  const pose = (p: PoseInput) => {
    const u = p.time / DEMO_CLIPS[p.clip].duration, w = Math.sin(u * Math.PI * 2);
    hips.position.y = 0.8;
    torso.position.y = 0.06;
    torso.rotation.y = legL.rotation.x = legR.rotation.x = armL.rotation.x = armR.rotation.x = 0;
    if (p.clip === 'walk') {
      legL.rotation.x = 0.7 * w;
      legR.rotation.x = -0.7 * w;
      armL.rotation.x = -0.5 * w;
      armR.rotation.x = 0.5 * w;
      hips.position.y = 0.8 + 0.035 * Math.abs(Math.cos(u * Math.PI * 2));
    } else if (p.clip === 'slash') {
      const e = 1 - (1 - u) ** 3;
      armR.rotation.x = -2.6 + 3.1 * e;
      torso.rotation.y = 0.5 - 1.1 * e;
      legL.rotation.x = -0.25;
      legR.rotation.x = 0.25;
    } else torso.position.y = 0.06 + 0.012 * w;
  };
  return { root, pose };
}

/** A slime: a squashed sphere with glowing eyes that hops and squashes procedurally. */
function buildSlime(color: string) {
  const body = new THREE.Group();
  body.add(new THREE.Mesh(merge([sphere(0.32, color, { at: [0, 0.24, 0], scale: [1, 0.75, 1] }, 10, 8)]), toonMaterial(0xffffff, null, true)));
  body.add(new THREE.Mesh(merge([sphere(0.045, '#fff', { at: [0.1, 0.32, 0.25] }), sphere(0.045, '#fff', { at: [-0.1, 0.32, 0.25] })]), glowMaterial(0xffffff)));
  const root = new THREE.Group().add(body);
  const pose = (p: PoseInput) => {
    const s = Math.sin((p.time / DEMO_CLIPS[p.clip].duration) * Math.PI * 2), hop = p.clip === 'hop';
    body.position.y = hop ? 0.3 * Math.max(0, s) : 0;
    body.scale.set(1 + 0.12 * (hop ? -s : 0.3 * s), 1 + 0.18 * (hop ? s : -0.3 * s), 1);
  };
  return { root, pose };
}

/**
 * The training room, built only from this file: a procedural knight you steer (WASD/arrows or
 * click/tap the floor; Space or a tap on the knight slashes), slimes that wander (world.rng) and get
 * knocked back, crates, torches lit from the light pool and a pixel-font HUD. P toggles pixel/3D,
 * O outlines, 1-4 palettes. Opened with ?agent it starts paused for agents (input keys moveX,
 * moveZ, attack).
 */
export function runDemo(canvas: HTMLCanvasElement, o: { seed?: number; agentMode?: boolean } = {}): PixelEngine {
  const engine = new PixelEngine(canvas, { seed: o.seed ?? 1, clips: DEMO_CLIPS, agentMode: o.agentMode, input: { attack: false } });
  const { world, scene } = engine;
  const H = 6, ROOM = H * 2 + 1;

  // Room: checker floor, tall walls at the back (west, north) and low ones in front, so the 45°
  // camera always sees in. Static meshes are merged (one draw call each) and frozen.
  const floorTex = checkerTexture('#4b4553', '#554e5e');
  floorTex.repeat.set(H, H);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), toonMaterial(0xffffff, floorTex));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const wall = '#6e6479', top = '#8f86a0';
  const walls = new THREE.Mesh(merge([
    box(0.5, 2.4, ROOM, wall, { at: [-H - 0.25, 1.2, 0] }), box(ROOM, 2.4, 0.5, wall, { at: [0, 1.2, -H - 0.25] }),
    box(0.52, 0.06, ROOM, top, { at: [-H - 0.25, 2.43, 0] }), box(ROOM, 0.06, 0.52, top, { at: [0, 2.43, -H - 0.25] }),
    box(0.5, 0.4, ROOM, top, { at: [H + 0.25, 0.2, 0] }), box(ROOM, 0.4, 0.5, top, { at: [0, 0.2, H + 0.25] }),
  ]), toonMaterial(0xffffff, null, true));
  const CRATES = [{ x: -3.5, z: -3.5, s: 1 }, { x: -2.6, z: -3.7, s: 0.8 }, { x: 3, z: -1.5, s: 1.2 }, { x: -2.2, z: 2.6, s: 0.9 }, { x: 2.8, z: 3, s: 0.7 }];
  const crates = new THREE.Mesh(merge(CRATES.flatMap((c) => [
    box(c.s, c.s, c.s, '#a8743f', { at: [c.x, c.s / 2, c.z] }), box(c.s * 1.02, 0.08, c.s * 1.02, '#6b4a35', { at: [c.x, c.s * 0.75, c.z] }),
  ])), toonMaterial(0xffffff, null, true));
  walls.castShadow = walls.receiveShadow = crates.castShadow = crates.receiveShadow = true;
  const TORCHES: Array<[number, number]> = [[-H + 0.5, -1.5], [1.5, -H + 0.5]];
  const poles = new THREE.Mesh(merge(TORCHES.flatMap(([x, z]) => [cyl(0.05, 0.07, 1.2, '#5a4632', { at: [x, 0.6, z] }), cyl(0.16, 0.08, 0.14, '#3a3446', { at: [x, 1.25, z] })])), toonMaterial(0xffffff, null, true));
  const flames = new THREE.Mesh(merge(TORCHES.map(([x, z]) => octa(0.12, '#ffc46b', { at: [x, 1.42, z], scale: [1, 1.6, 1] }))), glowMaterial(0xffffff));
  flames.material.vertexColors = true;
  for (const m of [floor, walls, crates, poles, flames]) scene.add(freeze(m));

  // Actors: state in the world, drawings in views.
  const knight = buildKnight();
  world.spawn('hero', { x: 0, z: 1.5, yawDeg: 45 });
  engine.addView('hero', new ActorView(knight.root, { pose: knight.pose }));
  const SLIMES: Array<[string, number, number]> = [['#63c74d', -4, 0], ['#41a6f6', 0.5, -3], ['#f6757a', 4, 1]];
  SLIMES.forEach(([color, x, z], i) => {
    world.spawn(`slime${i + 1}`, { x, z, data: { tx: x, tz: z, wait: 0, kx: 0, kz: 0, hits: 0 } });
    const slime = buildSlime(color);
    engine.addView(`slime${i + 1}`, new ActorView(slime.root, { pose: slime.pose, shadow: 0.34 }));
  });

  // Simulation: two systems, deterministic (input and world.rng only).
  const collide = (a: Actor, r: number) => {
    a.pos.x = Math.max(-H + r, Math.min(H - r, a.pos.x));
    a.pos.z = Math.max(-H + r, Math.min(H - r, a.pos.z));
    for (const c of CRATES) {
      const dx = a.pos.x - c.x, dz = a.pos.z - c.z, px = c.s / 2 + r - Math.abs(dx), pz = c.s / 2 + r - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) a.pos.x += Math.sign(dx) * px;
        else a.pos.z += Math.sign(dz) * pz;
      }
    }
  };
  world.onStep((w) => {
    const hero = w.get('hero');
    const slashing = hero.anim.clip === 'slash' && !w.clipDone(hero);
    if (w.input.attack && !slashing) {
      w.input.attack = false; // consume the press; one made during a slash waits (input buffering)
      w.play(hero, 'slash', { restart: true, blend: 0.03 });
      hero.data.swept = [];
      w.emit('slash', { id: hero.id });
    }
    const mx = Number(w.input.moveX) || 0, mz = Number(w.input.moveZ) || 0, len = Math.hypot(mx, mz);
    if (len > 0.05) {
      const k = (Math.min(1, len) * 4.2 * (slashing ? 0.25 : 1) * w.dt) / len;
      hero.pos.x += mx * k;
      hero.pos.z += mz * k;
      w.turnToward(hero, yawOf(mx, mz));
    }
    collide(hero, 0.3);
    if (hero.anim.clip !== 'slash') return w.play(hero, len > 0.05 ? 'walk' : 'idle');
    const u = hero.anim.time / DEMO_CLIPS.slash.duration, swept = hero.data.swept as string[];
    for (const s of w.actors.values()) {
      if (u < 0.3 || u > 0.65 || !s.id.startsWith('slime') || swept.includes(s.id)) continue;
      const dx = s.pos.x - hero.pos.x, dz = s.pos.z - hero.pos.z, d = Math.hypot(dx, dz);
      if (d > 1.5 || d < 1e-6 || (dx * Math.sin(hero.yaw) + dz * Math.cos(hero.yaw)) / d < 0.2) continue;
      const sd = s.data as { kx: number; kz: number; hits: number };
      swept.push(s.id);
      sd.kx = (dx / d) * 6;
      sd.kz = (dz / d) * 6;
      w.emit('hit', { id: s.id, hits: ++sd.hits });
    }
    if (w.clipDone(hero)) w.play(hero, len > 0.05 ? 'walk' : 'idle');
  });
  world.onStep((w) => {
    for (const s of w.actors.values()) {
      if (!s.id.startsWith('slime')) continue;
      const d = s.data as { tx: number; tz: number; wait: number; kx: number; kz: number };
      if (d.kx || d.kz) {
        s.pos.x += d.kx * w.dt;
        s.pos.z += d.kz * w.dt;
        d.kx *= 0.88;
        d.kz *= 0.88;
        if (Math.hypot(d.kx, d.kz) < 0.05) d.kx = d.kz = 0;
      } else {
        if ((d.wait -= w.dt) <= 0) Object.assign(d, { tx: w.rng.range(-H + 1, H - 1), tz: w.rng.range(-H + 1, H - 1), wait: w.rng.range(2, 4) });
        const dx = d.tx - s.pos.x, dz = d.tz - s.pos.z, dist = Math.hypot(dx, dz);
        if (dist > 0.15) {
          s.pos.x += (dx / dist) * 1.1 * w.dt;
          s.pos.z += (dz / dist) * 1.1 * w.dt;
          w.turnToward(s, yawOf(dx, dz), 6);
        }
        w.play(s, dist > 0.15 ? 'hop' : 'idle');
      }
      collide(s, 0.3);
    }
  });

  // Rendering extras: torch lights from the pool, flickering on sim time so captures repeat.
  engine.onRender((alpha) => {
    const t = (world.frame + alpha) / STEP_HZ;
    TORCHES.forEach(([x, z], i) => {
      const f = 1 - 0.25 * (0.5 + 0.5 * Math.sin(t * 9 + i * 1.7) * Math.sin(t * 13.7 + i * 3.4));
      engine.lights.add({ x, y: 1.5, z, color: '#ffb066', intensity: 2.6 * f, range: 6.5, priority: 1 });
    });
  });
  engine.follow = 'hero';
  engine.hud = (g, r) => {
    let hits = 0;
    for (const a of world.actors.values()) hits += Number(a.data.hits ?? 0);
    drawText(g, '3DPIXEL2D AGENT KIT', r.x + 3, r.y + 3, '#f3ead6');
    drawText(g, `FRAME ${world.frame}  HITS ${hits}  ${config['render.palette']}`, r.x + 3, r.y + 10, '#9fd0ff');
    const hint = 'WASD/CLICK MOVE  SPACE SLASH  P 3D  O OUTLINES  1-4 PALETTE';
    drawText(g, textWidth(hint) + 6 <= r.w ? hint : 'TAP: MOVE / SLASH', r.x + 3, r.y + r.h - 8, '#8f86a0');
  };
  if (!engine.agentMode) {
    bindKeyboard(engine);
    // Click or tap: walk to the floor point under the pointer, or slash when it is on the knight.
    let target: V3 | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      const floor = engine.pick(e.clientX, e.clientY), chest = engine.pick(e.clientX, e.clientY, 0.8), hero = world.get('hero');
      if (!floor || !chest) return;
      if (Math.hypot(chest.x - hero.pos.x, chest.z - hero.pos.z) < 0.6) world.input.attack = true;
      else target = floor;
    });
    engine.onRender(() => {
      if (!target) return;
      const hero = world.get('hero'), dx = target.x - hero.pos.x, dz = target.z - hero.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.15) target = null;
      world.input.moveX = target ? dx / d : 0;
      world.input.moveZ = target ? dz / d : 0;
    });
    addEventListener('keydown', (e) => {
      if (/^(Key[WASD]|Arrow)/.test(e.code)) target = null; // the keyboard takes over
      if (e.code === 'KeyP') setConfig('render.pixelMode', !config['render.pixelMode']);
      if (e.code === 'KeyO') setConfig('render.outlines', !config['render.outlines']);
      const pal = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (pal >= 0) setConfig('render.palette', PALETTE_NAMES[pal]);
    });
  }
  installAgent(engine);
  return engine.start();
}

// == 1. CONFIG =====================================================================================

export interface ConfigSpec { value: boolean | number | string; desc: string; min?: number; max?: number; options?: readonly string[] }

/**
 * Every tunable, keyed by stable dotted paths; code reads `config['render.outlines']`. `render.*`
 * keys only change how frames are drawn and `anim.*` keys what the sim samples for drawing, so
 * neither affects world.hash(). Same keys, defaults, ranges and text as the engine's src/config.ts.
 */
export const CONFIG_SPEC = {
  'render.pixelMode': {
    value: true,
    desc: 'Master switch. false = plain full-resolution 3D with smooth 60 fps animation and free rotation (the "before" picture); all sprite techniques off.',
  },
  'render.targetLines': {
    value: 270, min: 120, max: 540,
    desc: 'Desired low-res height in art pixels; the integer upscale factor is picked to land closest to it for the current window.',
  },
  'render.pixelsPerMeter': {
    value: 31.1127, min: 8, max: 128,
    desc: 'Art pixels per meter across the screen. 31.1127 makes a 1 m floor tile an exact 44x22 px diamond and a 1.8 m character ~48 px tall.',
  },
  'render.outlines': { value: true, desc: '1-px dark outline on the near side of depth edges (silhouettes).' },
  'render.outlineStrength': { value: 0.62, min: 0, max: 1, desc: 'How much outline pixels are darkened.' },
  'render.innerLines': { value: true, desc: '1-px light line on creases (normal edges), like painted highlights.' },
  'render.innerLineStrength': { value: 0.28, min: 0, max: 1, desc: 'How much crease pixels are brightened.' },
  'render.palette': { value: 'none', options: ['none', 'endesga32', 'sweetie16', 'pico8'], desc: 'Lock final colors to a fixed palette (nearest color in OKLab).' },
  'render.toonBands': { value: 3, min: 2, max: 6, desc: 'Number of hard light bands in the toon shading.' },
  'render.snapMovers': { value: true, desc: 'Draw every moving object at whole art-pixel positions, so a held pose moves as identical pixels (the key sprite trick).' },
  'render.snapCamera': { value: true, desc: 'Keep the camera on the art-pixel grid so static scenery never shimmers.' },
  'render.smoothScroll': {
    value: false,
    desc: "true: camera follows the player's continuous position and the leftover sub-pixel is applied after upscaling (smooth world scroll, player jitters up to 1 art px). false: camera locks to the player's snapped position (player steady, world scrolls in whole pixels).",
  },
  'render.blobShadows': { value: true, desc: 'Round shadow under each character (stable at low resolution).' },
  'render.shadows': { value: true, desc: 'Hard-edged shadow maps cast by walls and crates.' },
  'anim.stepped': { value: true, desc: 'Hold each pose until the next sprite tick instead of animating every frame.' },
  'anim.fps': { value: 12, min: 1, max: 60, desc: 'Sprite ticks per second. Poses and 8-way facing change only on ticks.' },
  'anim.dir8': { value: true, desc: 'Displayed facing snaps to 8 directions like an 8-way sprite sheet.' },
  'anim.blend': { value: 0.1, min: 0, max: 0.5, desc: 'Crossfade seconds between clips.' },
  'sim.timeScale': { value: 1, min: 0, max: 4, desc: 'Real-time playback speed. Ignored by agent step(), which always advances exact frames.' },
} as const satisfies Record<string, ConfigSpec>;

type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : never;
export type ConfigKey = keyof typeof CONFIG_SPEC;
export type Config = { -readonly [K in ConfigKey]: Widen<(typeof CONFIG_SPEC)[K]['value']> };

const configDefaults = () => Object.fromEntries(Object.entries(CONFIG_SPEC).map(([k, s]) => [k, s.value])) as Config;

/** Live values. Read freely; write through setConfig so values are validated and listeners run. */
export const config: Config = configDefaults();
export const configListeners = new Set<(key: ConfigKey) => void>();

export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_SPEC, key);
}

/** Throws with a message an agent can act on unless `value` is valid for `key`. */
export function validateConfig(key: string, value: unknown): asserts key is ConfigKey {
  if (!isConfigKey(key)) throw new Error(`unknown config key "${key}". Call describeConfig() (tool config.get) for the list.`);
  const spec: ConfigSpec = CONFIG_SPEC[key];
  if (typeof spec.value === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${key} expects a boolean`);
  } else if (typeof spec.value === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} expects a number`);
    if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max))
      throw new Error(`${key} must be within [${spec.min}, ${spec.max}]`);
  } else {
    if (typeof value !== 'string') throw new Error(`${key} expects a string`);
    if (spec.options && !spec.options.includes(value)) throw new Error(`${key} must be one of: ${spec.options.join(', ')}`);
  }
}

/** Validates and applies one value, then notifies listeners. */
export function setConfig(key: string, value: unknown): { key: ConfigKey; value: unknown; previous: unknown } {
  validateConfig(key, value);
  const previous = config[key];
  (config as Record<string, unknown>)[key] = value;
  for (const fn of configListeners) fn(key);
  return { key, value, previous };
}

export function resetConfig(): void {
  const d = configDefaults();
  for (const k of Object.keys(d) as ConfigKey[]) if (config[k] !== d[k]) setConfig(k, d[k]);
}

export function describeConfig() {
  return (Object.keys(CONFIG_SPEC) as ConfigKey[]).map((key) => {
    const s: ConfigSpec = CONFIG_SPEC[key];
    return { key, value: config[key], default: s.value, desc: s.desc, min: s.min, max: s.max, options: s.options };
  });
}

// == 2. DETERMINISM ================================================================================

/** Simulation rate: one World.step() is one frame of exactly 1/60 s. There is no variable timestep. */
export const STEP_HZ = 60;

/** Seeded PRNG (mulberry32). The sim and every generator use it; nothing calls Math.random, so runs replay exactly. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]; }
  /** Picks by weight; entries with weight <= 0 never win. */
  weighted<T>(list: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const t of list) total += Math.max(0, weight(t));
    let r = this.next() * total;
    for (const t of list) {
      r -= Math.max(0, weight(t));
      if (r < 0) return t;
    }
    return list[list.length - 1];
  }
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
}

/** Stable 32-bit hash of strings/numbers, for deriving independent seeds ("level 7 loot", "creature 42"). */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

/** Order-sensitive FNV hash of numbers rounded to 1e-4, as 8 hex digits. Equal hashes: the runs matched. */
export function hashNumbers(values: Iterable<number>): string {
  let h = 2166136261;
  for (const n of values) {
    h ^= Math.round(n * 1e4);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// == 3. PIXEL GRID =================================================================================
// The camera is orthographic with a fixed yaw/pitch, so "screen position in art pixels" is a dot
// product with the camera's right/up vectors times pixelsPerMeter. Snapping a world point to the
// grid rounds those two coordinates and leaves depth alone. When the camera and an object are both
// snapped, the object lands on whole pixels, so a held pose rasterizes to the same pixels anywhere.

export interface V3 { x: number; y: number; z: number }

export interface IsoBasis {
  right: V3;
  up: V3;
  /** Direction the camera looks (into the screen). */
  forward: V3;
  /** Ground-plane unit vectors for screen-relative movement (screen right / screen up). */
  groundRight: V3;
  groundUp: V3;
}

const DEG = Math.PI / 180;

/** yaw: camera azimuth from +Z toward +X; pitch: downward tilt. 45/30 gives exact 2:1 pixel lines. */
export function isoBasis(yawDeg: number, pitchDeg: number): IsoBasis {
  const sy = Math.sin(yawDeg * DEG), cy = Math.cos(yawDeg * DEG);
  const sp = Math.sin(pitchDeg * DEG), cp = Math.cos(pitchDeg * DEG);
  return {
    right: { x: cy, y: 0, z: -sy },
    up: { x: -sy * sp, y: cp, z: -cy * sp },
    forward: { x: -sy * cp, y: -sp, z: -cy * cp },
    groundRight: { x: cy, y: 0, z: -sy },
    groundUp: { x: -sy, y: 0, z: -cy },
  };
}

export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Screen coordinates in art pixels (x right, y up), relative to the world origin. */
export function screenPx(p: V3, b: IsoBasis, ppm: number): { x: number; y: number } {
  return { x: dot(p, b.right) * ppm, y: dot(p, b.up) * ppm };
}

/** Moves p within the screen plane so it sits on whole art pixels. Depth is unchanged. */
export function snapToGrid(p: V3, b: IsoBasis, ppm: number, out: V3 = { x: 0, y: 0, z: 0 }): V3 {
  const sx = dot(p, b.right) * ppm;
  const sy = dot(p, b.up) * ppm;
  const dx = (Math.round(sx) - sx) / ppm;
  const dy = (Math.round(sy) - sy) / ppm;
  out.x = p.x + b.right.x * dx + b.up.x * dy;
  out.y = p.y + b.right.y * dx + b.up.y * dy;
  out.z = p.z + b.right.z * dx + b.up.z * dy;
  return out;
}

/** Sub-pixel remainder of p (in art pixels), i.e. how far p is from its snapped position. */
export function subPixel(p: V3, b: IsoBasis, ppm: number): { x: number; y: number } {
  const sx = dot(p, b.right) * ppm;
  const sy = dot(p, b.up) * ppm;
  return { x: sx - Math.round(sx), y: sy - Math.round(sy) };
}

/**
 * Integer upscale for a canvas measured in DEVICE pixels (so Windows 125%/150% scaling stays crisp).
 * Returns the low-res size that covers the canvas (plus `margin` texels per side for sub-pixel scroll).
 */
export function chooseScale(deviceW: number, deviceH: number, targetLines: number, margin = 1) {
  const scale = Math.max(1, Math.round(deviceH / targetLines));
  return {
    scale,
    width: Math.ceil(deviceW / scale) + margin * 2,
    height: Math.ceil(deviceH / scale) + margin * 2,
    margin,
  };
}

/** Nearest of 8 directions. Index 0 = +Z (toward the camera's lower-left on screen), counter-clockwise seen from above. */
export function dir8(yaw: number): { index: number; yaw: number } {
  const step = Math.PI / 4;
  const index = ((Math.round(yaw / step) % 8) + 8) % 8;
  return { index, yaw: index * step };
}

/** Names of the 8 directions as they appear on screen with the default 45° camera yaw. */
export const DIR8_SCREEN_NAMES = ['down-left', 'down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left'] as const;

/** Screen direction (x right, y up: a stick or WASD) -> world XZ direction on the ground, length <= 1. */
export function screenToGround(b: IsoBasis, sx: number, sy: number): { x: number; z: number } {
  const len = Math.hypot(sx, sy);
  if (len < 1e-6) return { x: 0, z: 0 };
  const k = Math.min(1, len) / len;
  return { x: (b.groundRight.x * sx + b.groundUp.x * sy) * k, z: (b.groundRight.z * sx + b.groundUp.z * sy) * k };
}

// == 4. PALETTES ===================================================================================

/** Fixed palettes for the optional palette lock (render.palette). Colors are sRGB hex. */
export const PALETTES = {
  none: [] as string[],
  // ENDESGA 32 by Endesga (lospec.com/palette-list/endesga-32)
  endesga32: [
    'be4a2f', 'd77643', 'ead4aa', 'e4a672', 'b86f50', '733e39', '3e2731', 'a22633',
    'e43b44', 'f77622', 'feae34', 'fee761', '63c74d', '3e8948', '265c42', '193c3e',
    '124e89', '0099db', '2ce8f5', 'ffffff', 'c0cbdc', '8b9bb4', '5a6988', '3a4466',
    '262b44', '181425', 'ff0044', '68386c', 'b55088', 'f6757a', 'e8b796', 'c28569',
  ],
  // Sweetie 16 by GrafxKid
  sweetie16: [
    '1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179',
    '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57',
  ],
  // PICO-8
  pico8: [
    '000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8',
    'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa',
  ],
} as const satisfies Record<string, readonly string[]>;

export type PaletteName = keyof typeof PALETTES;
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];
export const MAX_PALETTE = 64;

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** sRGB hex -> OKLab (L, a, b). Used to match colors perceptually in the post shader. */
export function hexToOklab(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// == 5. MATERIALS ==================================================================================
// The pipeline draws colour and view-space normals in ONE pass (two render targets). Opaque
// materials write their shading normal (crease lines come from normal edges); blended overlays
// ('fx') write alpha 0, which leaves the normal buffer unchanged (so they get no outline). Toon
// shading: hard light bands, no specular; the dark band stays fairly bright, because pixel-art
// shadows are a hue/value shift, not black.

type NormalPatch = 'normals-surface' | 'normals-fx';

function patchNormals(material: THREE.Material, patch: NormalPatch) {
  material.onBeforeCompile = (shader) => {
    let frag = shader.fragmentShader;
    // Unlit materials have no shading normal: derive a flat facet normal from screen-space
    // derivatives of the view-space position (crisp, matches the toon look).
    const unlit = patch === 'normals-surface' && (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;
    if (unlit) {
      shader.vertexShader = `varying vec3 vPcView;\n${shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvPcView = mvPosition.xyz;')}`;
      frag = `varying vec3 vPcView;\n${frag}`;
    }
    const write = patch === 'normals-fx' ? 'pc_fragNormal = vec4( 0.0 );'
      : unlit ? 'pc_fragNormal = vec4( normalize( cross( dFdx( vPcView ), dFdy( vPcView ) ) ) * 0.5 + 0.5, 1.0 );'
        : 'pc_fragNormal = vec4( normalize( normal ) * 0.5 + 0.5, 1.0 );';
    shader.fragmentShader = `layout(location = 1) out highp vec4 pc_fragNormal;\n${frag.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n\t${write}`)}`;
  };
  material.customProgramCacheKey = () => patch;
  material.userData.patches = [patch];
}

/** Makes a built-in material write the normal target: 'surface' for opaque things, 'fx' for blended overlays. */
export function writesNormals<T extends THREE.Material>(material: T, kind: 'surface' | 'fx' = 'surface'): T {
  patchNormals(material, kind === 'surface' ? 'normals-surface' : 'normals-fx');
  return material;
}

let gradient: THREE.DataTexture | null = null;
let gradientBands = 0;

/** Shared N-band ramp (nearest-filtered), rebuilt when render.toonBands changes. */
export function toonGradient(): THREE.DataTexture {
  const bands = config['render.toonBands'];
  if (gradient && gradientBands === bands) return gradient;
  const data = new Uint8Array(bands * 4);
  for (let i = 0; i < bands; i++) {
    const v = Math.round(255 * (0.42 + 0.58 * (i / (bands - 1))));
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, bands, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  if (gradient) {
    gradient.image = tex.image;
    gradient.needsUpdate = true;
    tex.dispose();
  } else gradient = tex;
  gradientBands = bands;
  return gradient!;
}

/** The default surface: toon bands, optional pixel texture, optional vertex colours (geometry kit). */
export function toonMaterial(color: THREE.ColorRepresentation, map: THREE.Texture | null = null, vertexColors = false): THREE.MeshToonMaterial {
  return writesNormals(new THREE.MeshToonMaterial({ color, map, gradientMap: toonGradient(), vertexColors }));
}

/** Unlit glowing material (eyes, runes, embers): still writes normals so outlines work. */
export function glowMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return writesNormals(new THREE.MeshBasicMaterial({ color }));
}

/** Blended overlay (blob shadows, decals, auras, ghosts): transparent, no depth write, no outline. */
export function fxMaterial(params: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  return writesNormals(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...params }), 'fx');
}

/** Converts any glTF material (usually MeshStandardMaterial) into a toon material with the same color/map. */
export function toonize(src: THREE.Material): THREE.MeshToonMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshToonMaterial({
    name: s.name,
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    gradientMap: toonGradient(),
    transparent: s.transparent,
    alphaTest: s.alphaTest || (s.transparent ? 0.5 : 0),
    side: s.side,
  });
  if (m.map) {
    m.map.colorSpace = THREE.SRGBColorSpace;
    // Mipmaps keep minified textures stable (no sparkle) at ~48 px character height.
    m.map.anisotropy = 1;
  }
  // Alpha-blended hair cards read as noise at low res; cut them out instead.
  if (m.transparent) {
    m.transparent = false;
    m.alphaTest = 0.5;
  }
  return writesNormals(m);
}

const SURFACE_TYPES = new Set(['MeshBasicMaterial', 'MeshLambertMaterial', 'MeshMatcapMaterial', 'MeshPhongMaterial', 'MeshPhysicalMaterial', 'MeshStandardMaterial', 'MeshToonMaterial']);

/** Patches every material under `root` that does not write normals yet (the engine runs this each frame). */
export function ensureNormals(root: THREE.Object3D): number {
  let patched = 0;
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      if (m.userData.patches) continue;
      const kind = !m.transparent && SURFACE_TYPES.has(m.type) ? 'surface' : 'fx';
      writesNormals(m, kind);
      m.needsUpdate = true;
      patched++;
      console.warn(`3dpixel2d: material "${m.name || m.type}" on "${o.name || o.type}" did not write normals; patched as ${kind}. Build materials with toonMaterial/glowMaterial/fxMaterial/writesNormals.`);
    }
  });
  return patched;
}

// == 6. PIPELINE ===================================================================================
// Frame flow in pixel mode: (1) scene -> targets.scene in ONE geometry pass with two attachments
// (half-float colour, packed view-space normals) plus a depth/stencil texture; (2) post ->
// targets.post (edges, sRGB encode, palette; 8-bit, what agents capture); (3) upscale -> canvas
// (nearest, integer factor, centred, optional sub-pixel offset). Plain mode renders the scene at
// full device resolution with 4x MSAA instead.

export class PixelTargets {
  readonly width: number;
  readonly height: number;
  /** textures[0] = linear color, textures[1] = packed view-space normals. */
  readonly scene: THREE.WebGLRenderTarget;
  readonly post: THREE.WebGLRenderTarget;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedInt248Type);
    depthTexture.format = THREE.DepthStencilFormat;
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    this.scene = new THREE.WebGLRenderTarget(width, height, {
      ...nearest, type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, depthTexture, count: 2,
    });
    this.scene.textures[1].name = 'normal';
    this.post = new THREE.WebGLRenderTarget(width, height, { ...nearest, type: THREE.UnsignedByteType, depthBuffer: false });
  }
  get normal(): THREE.Texture {
    return this.scene.textures[1];
  }
  dispose() {
    this.scene.depthTexture?.dispose();
    this.scene.dispose();
    this.post.dispose();
  }
}

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const postFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec4 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float outlineStrength;
uniform float innerStrength;
uniform float depthThreshold;
uniform int paletteSize;
uniform vec3 paletteLab[${MAX_PALETTE}];
uniform vec3 paletteRgb[${MAX_PALETTE}];
varying vec2 vUv;

float depthAt(vec2 uv) { return cameraNear + texture2D(tDepth, uv).r * (cameraFar - cameraNear); }
// Normals share the half-float MRT pass; quantize like an 8-bit target so flat faces compare exactly equal.
vec3 normalAt(vec2 uv) { return normalize(floor(texture2D(tNormal, uv).rgb * 255.0 + 0.5) / 255.0 * 2.0 - 1.0); }

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toOklab(vec3 c) {
  float l = pow(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 1.0 / 3.0);
  float m = pow(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 1.0 / 3.0);
  float s = pow(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b, 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

// Crease test against one neighbour: only the shallower pixel, and only the side whose normal
// leans toward the bias direction, marks the edge, so creases stay exactly 1 px wide.
float crease(vec2 offs, float d, vec3 n) {
  vec2 uv = vUv + offs * resolution.zw;
  float dd = depthAt(uv) - d;
  if (abs(dd) > depthThreshold) return 0.0;
  vec3 nn = normalAt(uv);
  float side = step(0.0, dot(n - nn, vec3(1.0, 1.0, 1.0)));
  float shallower = step(0.0, dd * 0.25 + 0.0025);
  return (1.0 - dot(n, nn)) * side * shallower;
}

void main() {
  vec4 color = texture2D(tColor, vUv);
  vec3 c = color.rgb;
  float a = color.a;
  float d = depthAt(vUv);
  vec2 px = resolution.zw;

  float far = 0.0;
  far = max(far, depthAt(vUv + vec2(px.x, 0.0)) - d);
  far = max(far, depthAt(vUv - vec2(px.x, 0.0)) - d);
  far = max(far, depthAt(vUv + vec2(0.0, px.y)) - d);
  far = max(far, depthAt(vUv - vec2(0.0, px.y)) - d);
  bool isOutline = outlineStrength > 0.0 && far > depthThreshold && a > 0.0;

  if (isOutline) {
    c *= 1.0 - outlineStrength;
  } else if (innerStrength > 0.0 && a > 0.0) {
    vec3 n = normalAt(vUv);
    float e = crease(vec2(1.0, 0.0), d, n) + crease(vec2(-1.0, 0.0), d, n)
            + crease(vec2(0.0, 1.0), d, n) + crease(vec2(0.0, -1.0), d, n);
    if (e > 0.18) c = mix(c, c * 1.6 + 0.04, innerStrength);
  }

  vec3 outRgb = toSrgb(c);
  if (paletteSize > 0) {
    vec3 lab = toOklab(clamp(c, 0.0, 1.0));
    float best = 1e9;
    vec3 pick = outRgb;
    for (int i = 0; i < ${MAX_PALETTE}; i++) {
      if (i >= paletteSize) break;
      vec3 dl = lab - paletteLab[i];
      float dist = dot(dl, dl);
      if (dist < best) { best = dist; pick = paletteRgb[i]; }
    }
    outRgb = pick;
  }
  gl_FragColor = vec4(outRgb, a);
}`;

const upscaleFragment = /* glsl */ `
uniform sampler2D tPost;
uniform sampler2D tOverlay;
uniform float overlayOn;
uniform vec2 lowRes;
uniform float scale;
uniform vec2 offset;
uniform vec2 overlayOffset;
uniform vec3 background;
void main() {
  vec2 p = floor((gl_FragCoord.xy + offset) / scale);
  vec4 c = texture2D(tPost, (p + 0.5) / lowRes);
  vec3 col = mix(background, c.rgb, c.a);
  if (overlayOn > 0.5) {
    // The overlay is anchored to the screen grid (not the sub-pixel scroll), so HUD text never wobbles.
    vec2 q = floor((gl_FragCoord.xy + overlayOffset) / scale);
    vec4 o = texture2D(tOverlay, (q + 0.5) / lowRes);
    col = mix(col, o.rgb, o.a);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const copyFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tOverlay;
uniform float overlayOn;
uniform vec2 lowRes;
uniform float scale;
uniform vec2 overlayOffset;
varying vec2 vUv;
void main() {
  vec3 c = clamp(texture2D(tColor, vUv).rgb, 0.0, 1.0);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  if (overlayOn > 0.5) {
    vec2 q = floor((gl_FragCoord.xy + overlayOffset) / scale);
    vec4 o = texture2D(tOverlay, (q + 0.5) / lowRes);
    c = mix(c, o.rgb, o.a);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

/** The pipeline's shaders, exported for inspection and tests. */
export const GLSL = { quadVertex, postFragment, upscaleFragment, copyFragment } as const;

export interface RenderOptions {
  /** Sub-pixel camera remainder in art pixels (smooth scroll), applied after upscaling. */
  subPixel?: { x: number; y: number };
  /** Draw edges/palette. false = raw low-res (used for plain-mode comparisons). */
  post?: boolean;
  /** Low-res overlay (the HUD canvas) composited over the frame. */
  overlay?: THREE.Texture | null;
}

/** Low-res render -> 1-px outlines/creases -> optional palette lock -> exact integer upscale. */
export class PixelPipeline {
  scale = 1;
  width = 2;
  height = 2;
  margin = 1;
  deviceW = 1;
  deviceH = 1;
  main: PixelTargets;
  /** Colour outside the scene, as raw sRGB components (setStyle(hex, THREE.LinearSRGBColorSpace)). */
  readonly background = new THREE.Color(0x0d0c11);
  readonly renderer: THREE.WebGLRenderer;
  private full: THREE.WebGLRenderTarget;
  private postMaterial: THREE.ShaderMaterial;
  private upscaleMaterial: THREE.ShaderMaterial;
  private copyMaterial: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private paletteKey = '';

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.main = new PixelTargets(2, 2);
    this.full = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.postMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: postFragment,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
        resolution: { value: new THREE.Vector4() }, cameraNear: { value: 0.1 }, cameraFar: { value: 100 },
        outlineStrength: { value: 0 }, innerStrength: { value: 0 }, depthThreshold: { value: 0.3 },
        paletteSize: { value: 0 },
        paletteLab: { value: Array.from({ length: MAX_PALETTE }, () => new THREE.Vector3()) },
        paletteRgb: { value: Array.from({ length: MAX_PALETTE }, () => new THREE.Vector3()) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.upscaleMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: upscaleFragment,
      uniforms: {
        tPost: { value: null }, lowRes: { value: new THREE.Vector2() }, scale: { value: 1 },
        offset: { value: new THREE.Vector2() }, background: { value: new THREE.Vector3() },
        tOverlay: { value: null }, overlayOn: { value: 0 }, overlayOffset: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: copyFragment,
      uniforms: {
        tColor: { value: null }, tOverlay: { value: null }, overlayOn: { value: 0 }, lowRes: { value: new THREE.Vector2() },
        scale: { value: 1 }, overlayOffset: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Canvas size in device pixels. Recomputes the integer scale and low-res target size. */
  setSize(deviceW: number, deviceH: number): boolean {
    const s = chooseScale(deviceW, deviceH, config['render.targetLines']);
    const changed = s.width !== this.width || s.height !== this.height || deviceW !== this.deviceW || deviceH !== this.deviceH;
    this.deviceW = deviceW;
    this.deviceH = deviceH;
    this.scale = s.scale;
    this.margin = s.margin;
    if (s.width !== this.width || s.height !== this.height) {
      this.main.dispose();
      this.main = new PixelTargets(s.width, s.height);
      this.width = s.width;
      this.height = s.height;
    }
    this.full.setSize(deviceW, deviceH);
    return changed;
  }

  /** Visible low-res rectangle (inside the margin), in target pixels, origin bottom-left. */
  visibleRect() {
    const w = Math.ceil(this.deviceW / this.scale);
    const h = Math.ceil(this.deviceH / this.scale);
    return { x: Math.floor((this.width - w) / 2), y: Math.floor((this.height - h) / 2), w, h };
  }

  private syncPalette() {
    const name = config['render.palette'] as PaletteName;
    if (name === this.paletteKey) return;
    this.paletteKey = name;
    const colors = PALETTES[name] ?? [];
    const u = this.postMaterial.uniforms;
    u.paletteSize.value = Math.min(colors.length, MAX_PALETTE);
    colors.slice(0, MAX_PALETTE).forEach((hex, i) => {
      const [L, A, B] = hexToOklab(hex);
      (u.paletteLab.value as THREE.Vector3[])[i].set(L, A, B);
      const n = parseInt(hex, 16);
      (u.paletteRgb.value as THREE.Vector3[])[i].set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    });
  }

  /** Steps 1-2 into `targets`. The camera must already be sized to the targets. */
  renderLowRes(targets: PixelTargets, scene: THREE.Scene, camera: THREE.OrthographicCamera, opts: RenderOptions = {}) {
    const r = this.renderer;
    r.setRenderTarget(targets.scene);
    r.clear(true, true, true);
    r.render(scene, camera);

    const post = opts.post !== false;
    this.syncPalette();
    const u = this.postMaterial.uniforms;
    u.tColor.value = targets.scene.texture;
    u.tDepth.value = targets.scene.depthTexture;
    u.tNormal.value = targets.normal;
    u.resolution.value.set(targets.width, targets.height, 1 / targets.width, 1 / targets.height);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.outlineStrength.value = post && config['render.outlines'] ? config['render.outlineStrength'] : 0;
    u.innerStrength.value = post && config['render.innerLines'] ? config['render.innerLineStrength'] : 0;
    if (!post) u.paletteSize.value = 0;
    this.quad.material = this.postMaterial;
    r.setRenderTarget(targets.post);
    this.quad.render(r);
    if (!post) this.paletteKey = '';
  }

  /** Full frame to the canvas. */
  render(scene: THREE.Scene, camera: THREE.OrthographicCamera, opts: RenderOptions = {}) {
    const r = this.renderer;
    const ovOffX = (this.width * this.scale - this.deviceW) / 2, ovOffY = (this.height * this.scale - this.deviceH) / 2;
    if (!config['render.pixelMode']) {
      r.setRenderTarget(this.full);
      r.clear(true, true, true);
      r.render(scene, camera);
      const cu = this.copyMaterial.uniforms;
      cu.tColor.value = this.full.texture;
      cu.tOverlay.value = opts.overlay ?? null;
      cu.overlayOn.value = opts.overlay ? 1 : 0;
      cu.lowRes.value.set(this.width, this.height);
      cu.scale.value = this.scale;
      cu.overlayOffset.value.set(ovOffX, ovOffY);
      this.quad.material = this.copyMaterial;
      r.setRenderTarget(null);
      this.quad.render(r);
      return;
    }
    this.renderLowRes(this.main, scene, camera, opts);
    const u = this.upscaleMaterial.uniforms;
    u.tPost.value = this.main.post.texture;
    u.lowRes.value.set(this.width, this.height);
    u.scale.value = this.scale;
    const sub = opts.subPixel ?? { x: 0, y: 0 };
    u.offset.value.set(
      (this.width * this.scale - this.deviceW) / 2 + sub.x * this.scale,
      (this.height * this.scale - this.deviceH) / 2 + sub.y * this.scale,
    );
    const bg = this.background;
    u.background.value.set(bg.r, bg.g, bg.b);
    u.tOverlay.value = opts.overlay ?? null;
    u.overlayOn.value = opts.overlay ? 1 : 0;
    u.overlayOffset.value.set(ovOffX, ovOffY);
    this.quad.material = this.upscaleMaterial;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  /** RGBA bytes of a target's post image, top row first. `rect` in target pixels (origin bottom-left). */
  read(targets: PixelTargets, rect?: { x: number; y: number; w: number; h: number }): Img {
    const { x, y, w, h } = rect ?? { x: 0, y: 0, w: targets.width, h: targets.height };
    const buf = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(targets.post, x, y, w, h, buf);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) out.set(buf.subarray((h - 1 - row) * w * 4, (h - row) * w * 4), row * w * 4);
    return { width: w, height: h, data: out };
  }

  dispose() {
    this.main.dispose();
    this.full.dispose();
    for (const m of [this.postMaterial, this.upscaleMaterial, this.copyMaterial]) m.dispose();
    this.quad.dispose();
  }
}

// == 7. LIGHTS =====================================================================================
// three.js recompiles every material when the number of lights changes, so the pool keeps N lights
// alive forever and, each frame, hands them to the N most important requests near the camera
// (torches, projectiles, explosions, pickups, the hero's lantern). Unused lights sit at intensity 0.
// Toon materials quantize the falloff into hard bands, which reads well at pixel resolution.

export interface LightRequest {
  x: number; y: number; z: number; color: THREE.ColorRepresentation; intensity: number; range: number;
  /** Higher wins when the pool is full (explosions > projectiles > torches). */
  priority?: number;
}

export const POOL_SIZE = 16;

export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private requests: LightRequest[] = [];
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'light-pool';
    for (let i = 0; i < POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 1.4);
      l.castShadow = false;
      l.name = `pool${i}`;
      this.lights.push(l);
      this.group.add(l);
    }
  }

  begin() {
    this.requests.length = 0;
  }

  add(r: LightRequest) {
    if (r.intensity > 0.01) this.requests.push(r);
  }

  /** Assigns the best requests to pool lights. `fx, fz` = view center; `reach` = view radius. */
  commit(fx: number, fz: number, reach: number) {
    const scored = this.requests
      .map((r) => {
        const d = Math.hypot(r.x - fx, r.z - fz);
        return { r, score: (r.priority ?? 0) * 10 - Math.max(0, d - r.range * 0.5) + (d > reach + r.range ? -1000 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    for (let i = 0; i < POOL_SIZE; i++) {
      const l = this.lights[i];
      const s = scored[i];
      if (!s || s.score < -500) {
        l.intensity = 0;
        continue;
      }
      l.position.set(s.r.x, s.r.y, s.r.z);
      l.color.set(s.r.color);
      l.intensity = s.r.intensity;
      l.distance = s.r.range;
    }
  }

  get active() {
    return this.lights.filter((l) => l.intensity > 0).length;
  }
}

// == 8. MODELING ===================================================================================
// A tiny procedural modeling kit: vertex-coloured primitives that are transformed and merged into
// one geometry (one draw call). Draw them with toonMaterial(0xffffff, null, true). In the full
// engine every prop, decor piece, item and creature part is built this way, so every asset is code
// an agent can read, tweak and regenerate.

export type Color = THREE.ColorRepresentation;

const tmpColor = new THREE.Color();

/** Strips uvs, adds a flat vertex color. */
export function paint(g: THREE.BufferGeometry, color: Color): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  tmpColor.set(color);
  for (let i = 0; i < n; i++) tmpColor.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export interface Place { at?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] | number }

export function place(g: THREE.BufferGeometry, p: Place = {}): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
  const s = typeof p.scale === 'number' ? new THREE.Vector3(p.scale, p.scale, p.scale) : new THREE.Vector3(...(p.scale ?? [1, 1, 1]));
  m.compose(new THREE.Vector3(...(p.at ?? [0, 0, 0])), q, s);
  g.applyMatrix4(m);
  return g;
}

export const box = (w: number, h: number, d: number, color: Color, p?: Place) => place(paint(new THREE.BoxGeometry(w, h, d), color), p);
export const cyl = (rt: number, rb: number, h: number, color: Color, p?: Place, seg = 8) => place(paint(new THREE.CylinderGeometry(rt, rb, h, seg), color), p);
export const cone = (r: number, h: number, color: Color, p?: Place, seg = 6) => place(paint(new THREE.ConeGeometry(r, h, seg), color), p);
export const sphere = (r: number, color: Color, p?: Place, w = 8, hs = 6) => place(paint(new THREE.SphereGeometry(r, w, hs), color), p);
export const torus = (r: number, tube: number, color: Color, p?: Place, rs = 6, ts = 12, arc = Math.PI * 2) => place(paint(new THREE.TorusGeometry(r, tube, rs, ts, arc), color), p);
export const ico = (r: number, color: Color, p?: Place, detail = 0) => place(paint(new THREE.IcosahedronGeometry(r, detail), color), p);
export const octa = (r: number, color: Color, p?: Place) => place(paint(new THREE.OctahedronGeometry(r, 0), color), p);
export const lathe = (pts: Array<[number, number]>, color: Color, p?: Place, seg = 10) =>
  place(paint(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color), p);

/** Merges parts (all indexed or all non-indexed handled) into one geometry. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.filter(Boolean);
  const indexed = list.every((g) => g.index);
  const norm = indexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(norm, false);
  if (!merged) throw new Error('merge failed: mismatched attributes');
  merged.computeBoundingSphere();
  return merged;
}

/** Darken/lighten a hex color. */
export function tone(color: Color, k: number): THREE.Color {
  const c = new THREE.Color(color);
  return c.multiplyScalar(k);
}

/** Nearest-filtered sRGB texture from a canvas you painted texel by texel. */
export function pixelTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 2x2 checker (repeat it so one texel covers one floor tile). */
export function checkerTexture(a: string, b: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 2, 2);
  g.fillStyle = b;
  g.fillRect(1, 0, 1, 1);
  g.fillRect(0, 1, 1, 1);
  return pixelTexture(c, true);
}

/** Round shadow under a character: stable at low resolution, cheaper than a shadow map. */
export function blobShadow(radius = 0.36): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), fxMaterial({ color: 0x000000, opacity: 0.32, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.name = 'blob-shadow';
  return m;
}

/** Static meshes: compute the matrix once and skip per-frame matrix updates. */
export function freeze<T extends THREE.Object3D>(o: T): T {
  o.matrixAutoUpdate = false;
  o.updateMatrix();
  return o;
}

// == 9. PIXEL FONT =================================================================================
// A 3x5 bitmap font drawn with fillRect, so HUD text is made of exact art pixels (no antialiasing
// blur at any scale). Uppercase only; lowercase maps to uppercase.

const G: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', '!': '010010010000010',
  '?': '111001011000010', '-': '000000111000000', '+': '000010111010000', ':': '000010000010000', '/': '001001010100100',
  '%': '101001010100101', "'": '010010000000000', '(': '010100100100010', ')': '010001001001010', '[': '110100100100110',
  ']': '011001001001011', '#': '101111101111101', '*': '000101010101000', '=': '000111000111000', '<': '001010100010001',
  '>': '100010001010100', '&': '010101010101011',
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** The 3x5 bitmap of a character, row-major '1'/'0' (unknown characters draw as '?'). */
export function glyphBits(ch: string): string {
  return G[ch.toUpperCase()] ?? G['?'];
}

/** Width in pixels of `text` at `scale` (1 px gap between glyphs). */
export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * (GLYPH_W + 1) - 1) * scale : 0;
}

export function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1, outline: string | null = '#0b0a10') {
  x = Math.round(x);
  y = Math.round(y);
  const up = text.toUpperCase();
  if (outline) {
    g.fillStyle = outline;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) paintText(g, up, x + ox, y + oy, scale);
  }
  g.fillStyle = color;
  paintText(g, up, x, y, scale);
}

function paintText(g: CanvasRenderingContext2D, text: string, x: number, y: number, s: number) {
  let cx = x;
  for (const ch of text) {
    const bits = G[ch] ?? G['?'];
    for (let r = 0; r < GLYPH_H; r++)
      for (let c = 0; c < GLYPH_W; c++) if (bits[r * GLYPH_W + c] === '1') g.fillRect(cx + c * s, y + r * s, s, s);
    cx += (GLYPH_W + 1) * s;
  }
}

// == 10. WORLD =====================================================================================
// The deterministic simulation: plain data and math (no DOM, no three.js objects, no wall clock), so
// it runs headless in Node exactly as in the browser. Each step: frame++, prevPos = pos, systems run
// in order, animations advance, timed input expires, and on sprite ticks every actor's pose and
// 8-way facing are sampled for drawing.

/** Clip timing the sim needs (durations drive looping and clipDone). */
export type ClipTable = Record<string, { duration: number; loop: boolean }>;

/** Clip table from glTF clips (`gltf.animations`); `once` names the clips that do not loop. */
export function clipTableOf(clips: THREE.AnimationClip[], once: string[] = []): ClipTable {
  return Object.fromEntries(clips.map((c) => [c.name, { duration: c.duration, loop: !once.includes(c.name) }]));
}

/** The clip playing now, advanced at 60 Hz; `prevClip` fades out while `blend` goes 0 -> 1 (anim.blend s). */
export interface AnimState { clip: string; time: number; speed: number; prevClip: string | null; prevTime: number; prevSpeed: number; blend: number }

/** What views draw: the animation and facing sampled at the last sprite tick (`dir` = dir8 index). */
export interface SpriteState { clip: string; time: number; prevClip: string | null; prevTime: number; blend: number; yaw: number; dir: number; tick: number }

/** Facing toward a ground direction: 0 = +Z, increasing toward +X (three.js rotation.y). */
export const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function spriteOf(a: AnimState, yaw: number): Omit<SpriteState, 'tick'> {
  const d = dir8(yaw);
  return { clip: a.clip, time: a.time, prevClip: a.prevClip, prevTime: a.prevTime, blend: a.blend, yaw: config['anim.dir8'] ? d.yaw : yaw, dir: d.index };
}

/** One simulated thing (hero, monster, NPC, projectile). Views interpolate prevPos -> pos by alpha. */
export class Actor {
  readonly id: string;
  pos: V3;
  prevPos: V3;
  /** Radians, see yawOf. */
  yaw: number;
  /** Ground height under the actor (blob shadow placement). */
  groundY = 0;
  anim: AnimState;
  sprite: SpriteState;
  /** Game state (life, team, timers). Plain JSON: it is hashed and snapshotted. */
  data: Record<string, unknown> = {};
  constructor(id: string, x = 0, z = 0, yaw = 0, clip = 'idle') {
    this.id = id;
    this.pos = { x, y: 0, z };
    this.prevPos = { x, y: 0, z };
    this.yaw = yaw;
    this.anim = { clip, time: 0, speed: 1, prevClip: null, prevTime: 0, prevSpeed: 1, blend: 1 };
    this.sprite = { ...spriteOf(this.anim, yaw), tick: 0 };
  }
}

export type Input = Record<string, number | boolean | string | null>;
export interface WorldEvent { seq: number; frame: number; type: string; [key: string]: unknown }
export type System = (world: World) => void;
export interface WorldOptions {
  seed?: number;
  clips?: ClipTable;
  /** Default input (what setInput resets to); moveX/moveZ, a world XZ direction, always exist. */
  input?: Input;
}

export class World {
  readonly dt = 1 / STEP_HZ;
  frame = 0;
  readonly seed: number;
  /** The only randomness the simulation may use. */
  readonly rng: Rng;
  clips: ClipTable;
  readonly actors = new Map<string, Actor>();
  /** Read by systems each step; written by people (bindKeyboard), agents (game.input) and bots. */
  input: Input;
  /** The last 256 events. */
  readonly events: WorldEvent[] = [];
  private readonly defaultInput: Input;
  private inputFrames = -1;
  private systems: System[] = [];
  private seq = 0;
  private lastTick = -1;

  constructor(o: WorldOptions = {}) {
    this.seed = o.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.clips = o.clips ?? {};
    this.defaultInput = { moveX: 0, moveZ: 0, ...o.input };
    this.input = { ...this.defaultInput };
  }

  /** Adds a system (runs every step, in the order added). Returns its remover. */
  onStep(fn: System): () => void {
    this.systems.push(fn);
    return () => {
      this.systems = this.systems.filter((s) => s !== fn);
    };
  }

  spawn(id: string, o: { x?: number; z?: number; yawDeg?: number; clip?: string; data?: Record<string, unknown> } = {}): Actor {
    if (this.actors.has(id)) throw new Error(`actor "${id}" already exists`);
    const a = new Actor(id, o.x ?? 0, o.z ?? 0, ((o.yawDeg ?? 0) * Math.PI) / 180, o.clip ?? 'idle');
    if (o.data) a.data = structuredClone(o.data);
    this.actors.set(id, a);
    return a;
  }

  get(id: string): Actor {
    const a = this.actors.get(id);
    if (!a) throw new Error(`no actor "${id}". Actors: ${[...this.actors.keys()].join(', ') || '(none)'}`);
    return a;
  }

  remove(id: string) {
    this.actors.delete(id);
  }

  /** The input keys this world defines (what game.input can set). */
  get inputKeys(): string[] {
    return Object.keys(this.defaultInput);
  }

  /** Replaces the input with defaults + `partial`; it resets after `frames` steps (-1: until changed). */
  setInput(partial: Input, frames = -1) {
    this.input = { ...this.defaultInput, ...partial };
    this.inputFrames = frames;
  }

  emit(type: string, data: Record<string, unknown> = {}) {
    this.events.push({ ...data, seq: ++this.seq, frame: this.frame, type });
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
  }

  eventsSince(seq: number): WorldEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  get lastEventSeq(): number {
    return this.seq;
  }

  /** Starts `clip` (no-op if it is already playing, unless `restart`), fading from the current clip. */
  play(a: Actor, clip: string, o: { speed?: number; start?: number; restart?: boolean; blend?: number } = {}) {
    const cur = a.anim;
    if (cur.clip === clip && !o.restart) {
      if (o.speed !== undefined) cur.speed = o.speed;
      return;
    }
    const blendTime = o.blend ?? config['anim.blend'];
    a.anim = {
      clip, time: o.start ?? 0, speed: o.speed ?? 1,
      prevClip: blendTime > 0 ? cur.clip : null, prevTime: cur.time, prevSpeed: cur.speed,
      blend: blendTime > 0 ? 0 : 1,
    };
  }

  /** True once a non-looping clip has reached its end. */
  clipDone(a: Actor): boolean {
    return a.anim.time >= this.meta(a.anim.clip).duration - 1e-6;
  }

  /** Turns toward `targetYaw` by at most `rate` rad/s (the full engine's sim.turnRate is 14). */
  turnToward(a: Actor, targetYaw: number, rate = 14) {
    const d = wrapAngle(targetYaw - a.yaw);
    const maxStep = rate * this.dt;
    a.yaw = wrapAngle(a.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
  }

  step() {
    this.frame++;
    for (const a of this.actors.values()) a.prevPos = { ...a.pos };
    for (const s of this.systems) s(this);
    for (const a of this.actors.values()) this.advanceAnim(a);
    if (this.inputFrames > 0 && --this.inputFrames === 0) this.input = { ...this.defaultInput };
    this.spriteTick();
  }

  private meta(clip: string) {
    return this.clips[clip] ?? { duration: 1, loop: true };
  }

  private advanceAnim(a: Actor) {
    const s = a.anim;
    const m = this.meta(s.clip);
    s.time += this.dt * s.speed;
    if (m.loop) s.time %= m.duration;
    else s.time = Math.min(s.time, m.duration);
    if (s.prevClip) {
      const pm = this.meta(s.prevClip);
      s.prevTime = pm.loop ? (s.prevTime + this.dt * s.prevSpeed) % pm.duration : Math.min(s.prevTime + this.dt * s.prevSpeed, pm.duration);
      const bt = config['anim.blend'];
      s.blend = bt > 0 ? Math.min(1, s.blend + this.dt / bt) : 1;
      if (s.blend >= 1) s.prevClip = null;
    }
  }

  /** Poses and facing are sampled only on sprite ticks (anim.fps), like frames of a sprite sheet. */
  private spriteTick() {
    const tick = Math.floor((this.frame * config['anim.fps']) / STEP_HZ);
    if (config['anim.stepped'] && tick === this.lastTick) return;
    this.lastTick = tick;
    for (const a of this.actors.values()) a.sprite = { ...spriteOf(a.anim, a.yaw), tick };
  }

  /** Hash of the frame, the RNG and every actor (position, facing, animation time, data). */
  hash(): string {
    const nums: number[] = [this.frame, this.rng.state];
    for (const a of this.actors.values()) {
      nums.push(a.pos.x, a.pos.y, a.pos.z, a.yaw, a.anim.time);
      for (const ch of JSON.stringify(a.data)) nums.push(ch.charCodeAt(0));
    }
    return hashNumbers(nums);
  }

  /** JSON summary for agents and tests. */
  snapshot() {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const fps = config['anim.fps'];
    return {
      frame: this.frame,
      time: r3(this.frame / STEP_HZ),
      seed: this.seed,
      input: { ...this.input },
      actors: [...this.actors.values()].map((a) => ({
        id: a.id,
        pos: [r3(a.pos.x), r3(a.pos.y), r3(a.pos.z)],
        yawDeg: r3((a.yaw * 180) / Math.PI),
        facing: DIR8_SCREEN_NAMES[dir8(a.yaw).index],
        clip: a.anim.clip,
        sprite: {
          clip: a.sprite.clip,
          frame: Math.floor(a.sprite.time * fps + 1e-6),
          frames: Math.max(1, Math.round(this.meta(a.sprite.clip).duration * fps)),
          dir: a.sprite.dir,
          dirName: DIR8_SCREEN_NAMES[a.sprite.dir],
        },
        data: structuredClone(a.data),
      })),
      events: this.events.slice(-20),
    };
  }
}

// == 11. VIEWS =====================================================================================

export interface PoseInput { clip: string; time: number; prevClip: string | null; prevTime: number; blend: number }

export interface ActorViewOptions {
  /** Skeletal clips (e.g. gltf.animations), posed exactly at the sim's clip times. */
  clips?: THREE.AnimationClip[];
  /** Procedural animation (alone or on top of clips); runs only when the pose changes. */
  pose?: (p: PoseInput, view: ActorView) => void;
  /** Blob shadow radius in metres (0 = none). */
  shadow?: number;
}

/**
 * The render side of an actor. `root` follows it (interpolated, snapped to the art-pixel grid,
 * turned to the sprite's 8-way facing); `object` is your model inside root, facing +Z. Poses only
 * change on sprite ticks, so a held pose is the same pixels wherever it moves. Run toonize() on
 * glTF materials (ensureNormals is only a fallback).
 */
export class ActorView {
  readonly root = new THREE.Group();
  readonly object: THREE.Object3D;
  readonly shadow: THREE.Mesh | null;
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly poseFn: ActorViewOptions['pose'];
  private readonly last: PoseInput = { clip: '', time: NaN, prevClip: null, prevTime: NaN, blend: NaN };

  constructor(object: THREE.Object3D, o: ActorViewOptions = {}) {
    this.object = object;
    this.root.add(object);
    for (const c of o.clips ?? []) this.clips.set(c.name, c);
    this.mixer = this.clips.size ? new THREE.AnimationMixer(object) : null;
    this.poseFn = o.pose;
    this.shadow = o.shadow === 0 ? null : blobShadow(o.shadow ?? 0.36);
  }

  /** Poses the model exactly at the given clip times (no mixer clock). */
  pose(p: PoseInput) {
    const l = this.last;
    if (p.clip === l.clip && p.time === l.time && p.prevClip === l.prevClip && p.blend === l.blend &&
      (p.prevClip === null || p.blend >= 1 || p.prevTime === l.prevTime)) return;
    Object.assign(l, { clip: p.clip, time: p.time, prevClip: p.prevClip, prevTime: p.prevTime, blend: p.blend });
    if (this.mixer && this.clips.has(p.clip)) {
      const cur = this.action(p.clip);
      const prev = p.prevClip && p.blend < 1 && this.clips.has(p.prevClip) ? this.action(p.prevClip) : null;
      for (const a of this.actions.values()) if (a !== cur && a !== prev && a.isRunning()) a.stop();
      if (!cur.isRunning()) cur.play();
      cur.time = p.time;
      cur.setEffectiveWeight(prev ? p.blend : 1);
      if (prev) {
        if (!prev.isRunning()) prev.play();
        prev.time = p.prevTime;
        prev.setEffectiveWeight(1 - p.blend);
      }
      this.mixer.update(0);
    }
    this.poseFn?.(p, this);
  }

  private action(name: string): THREE.AnimationAction {
    let a = this.actions.get(name);
    if (!a) this.actions.set(name, (a = this.mixer!.clipAction(this.clips.get(name)!)));
    return a;
  }

  dispose() {
    this.root.removeFromParent();
    this.shadow?.removeFromParent();
    this.mixer?.stopAllAction();
  }
}

// == 12. ENGINE ====================================================================================

/** RGBA pixels, top row first. */
export interface Img { width: number; height: number; data: Uint8ClampedArray }
/** The visible part of the low-res frame in HUD-canvas coordinates (origin top-left, art pixels). */
export interface ViewRect { x: number; y: number; w: number; h: number }

export interface EngineOptions extends WorldOptions {
  /** Draw an existing world (e.g. one built and tested headless) instead of creating one. */
  world?: World;
  /** Start paused and ignore human input; agents advance with step(). Default: the URL has ?agent. */
  agentMode?: boolean;
  /** Camera azimuth and tilt in degrees (45 / 30 give exact 2:1 pixel lines). */
  yawDeg?: number;
  pitchDeg?: number;
  sun?: { azimuthDeg: number; elevationDeg: number };
}

const CAMERA_DISTANCE = 40;
const FOLLOW_HEIGHT = 0.9;

/**
 * Owns the renderer, scene, iso camera, lights, pipeline and World, and runs the frame loop. Real
 * time: start() steps the world at 60 Hz from an accumulator (at most 6 steps per frame) and draws
 * with interpolation. Agents: step(n) advances exact frames, then draws once.
 */
export class PixelEngine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly pipeline: PixelPipeline;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 2.5);
  readonly basis: IsoBasis;
  readonly world: World;
  readonly lights = new LightPool();
  readonly hemi = new THREE.HemisphereLight(0xc4ccff, 0x3d3446, 1.35);
  readonly sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  readonly views = new Map<string, ActorView>();
  /** Actor id the camera follows (null: move `focus` yourself). */
  follow: string | null = null;
  /** Camera look-at point in world space, before snapping. */
  readonly focus = new THREE.Vector3();
  /** HUD painter, called every draw on a low-res canvas: exact art pixels, `view` = visible area. */
  hud: ((g: CanvasRenderingContext2D, view: ViewRect, engine: PixelEngine) => void) | null = null;
  paused: boolean;
  readonly agentMode: boolean;
  /** Visual seconds drawn so far (sim time is world.frame / 60). */
  time = 0;
  fps = 0;
  /** Draw calls, triangles and milliseconds of the last frame. */
  readonly frameStats = { calls: 0, triangles: 0, ms: 0 };
  subPixel = { x: 0, y: 0 };
  /** Something visible changed (config, resize): a paused loop redraws. */
  needsRender = true;
  private renderHooks: Array<(alpha: number, dt: number) => void> = [];
  private hudCanvas: HTMLCanvasElement | null = null;
  private hudCtx: CanvasRenderingContext2D | null = null;
  private hudTexture: THREE.CanvasTexture | null = null;
  private hudOn = true;
  private acc = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private pausedRedraws = 0;
  private sizeDirty = true;
  private drawnFrame = -1;
  private timer: THREE.Timer | null = null;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private shadowCell = { x: NaN, z: NaN };
  private backgroundCss = '';
  private resizeObserver: ResizeObserver | null = null;
  private readonly onConfig = (key: ConfigKey) => {
    this.needsRender = true;
    if (key === 'render.targetLines') this.sizeDirty = true;
  };
  private readonly markResized = () => {
    this.sizeDirty = true;
    this.needsRender = true;
  };

  constructor(canvas: HTMLCanvasElement, o: EngineOptions = {}) {
    this.canvas = canvas;
    this.agentMode = o.agentMode ?? (typeof location !== 'undefined' && new URLSearchParams(location.search).has('agent'));
    this.paused = this.agentMode;
    this.world = o.world ?? new World(o);
    this.basis = isoBasis(o.yawDeg ?? 45, o.pitchDeg ?? 30);
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    r.setPixelRatio(1);
    r.autoClear = false;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.BasicShadowMap;
    r.info.autoReset = false;
    this.pipeline = new PixelPipeline(r);
    this.background = '#0d0c11';
    const sun = o.sun ?? { azimuthDeg: 20, elevationDeg: 55 };
    const az = sun.azimuthDeg * DEG, el = sun.elevationDeg * DEG;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.hemi, this.sun, this.sun.target, this.lights.group);
    configListeners.add(this.onConfig);
    if (typeof ResizeObserver !== 'undefined') (this.resizeObserver = new ResizeObserver(this.markResized)).observe(canvas);
    addEventListener('resize', this.markResized);
  }

  /** Background colour (CSS/hex) of the scene and the frame margin. */
  get background(): string {
    return this.backgroundCss;
  }
  set background(css: string) {
    this.backgroundCss = css;
    this.scene.background = new THREE.Color(css);
    // The upscale pass mixes this into sRGB-encoded pixels, so keep the hex's raw components.
    this.pipeline.background.setStyle(css, THREE.LinearSRGBColorSpace);
    this.needsRender = true;
  }

  /** Draws actor `id` with `view` (its root and blob shadow join the scene). */
  addView(id: string, view: ActorView): ActorView {
    this.removeView(id);
    this.views.set(id, view);
    this.scene.add(view.root);
    if (view.shadow) this.scene.add(view.shadow);
    return view;
  }

  removeView(id: string) {
    this.views.get(id)?.dispose();
    this.views.delete(id);
  }

  /** Runs every draw after actor views are placed, before the camera: effects, light requests. */
  onRender(fn: (alpha: number, dt: number) => void): () => void {
    this.renderHooks.push(fn);
    return () => {
      this.renderHooks = this.renderHooks.filter((h) => h !== fn);
    };
  }

  /** Starts the real-time loop (idempotent). A paused engine only redraws when something changed. */
  start(): this {
    if (this.timer) return this;
    // THREE.Timer ignores the time spent in a hidden tab.
    const timer = (this.timer = new THREE.Timer());
    timer.connect(document);
    this.renderer.setAnimationLoop((now) => {
      timer.update(now);
      this.advance(timer.getDelta());
    });
    return this;
  }

  stop() {
    this.renderer.setAnimationLoop(null);
    this.timer?.dispose();
    this.timer = null;
  }

  /** One real-time tick: fixed steps from the accumulator, then a draw with interpolation. */
  advance(realDt: number) {
    const dt = Math.min(0.1, realDt);
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = this.fpsFrames = 0;
    }
    if (this.paused) {
      // Draw a change twice: WebKit can leave a single paused frame unpresented.
      if (this.needsRender) this.pausedRedraws = 2;
      if (this.pausedRedraws-- > 0) this.render(1, 0);
      return;
    }
    this.acc += dt * config['sim.timeScale'];
    let n = 0;
    for (; this.acc >= this.world.dt && n < 6; n++) {
      this.world.step();
      this.acc -= this.world.dt;
    }
    if (n === 6) this.acc = 0;
    this.render(this.acc / this.world.dt, dt);
  }

  /** Advances exactly `frames` sim frames (independent of wall-clock time), then draws. */
  step(frames = 1, draw = true) {
    for (let i = 0; i < frames; i++) this.world.step();
    this.acc = 0;
    if (draw) this.render(1);
  }

  /**
   * Draws a frame. `alpha` interpolates movers between their last two steps; `dt` ages visual
   * effects and defaults to the sim time since the last draw, so a draw after a long headless step
   * shows what a player would see at that moment.
   */
  render(alpha = 1, dt?: number) {
    const t0 = performance.now();
    dt ??= this.drawnFrame < 0 ? 0 : Math.max(0, this.world.frame - this.drawnFrame) / STEP_HZ;
    this.drawnFrame = this.world.frame;
    this.time += dt;
    this.renderer.info.reset();
    this.resize();
    const pixel = config['render.pixelMode'];
    const snapMovers = pixel && config['render.snapMovers'];
    const ppm = config['render.pixelsPerMeter'];
    const snap = (p: V3): V3 => (snapMovers ? snapToGrid(p, this.basis, ppm) : p);
    this.lights.begin();

    let followPos: V3 | null = null, followDrawn: V3 | null = null;
    for (const [id, view] of this.views) {
      const a = this.world.actors.get(id);
      view.root.visible = !!a;
      if (view.shadow) view.shadow.visible = !!a && config['render.blobShadows'];
      if (!a) continue;
      const p = {
        x: a.prevPos.x + (a.pos.x - a.prevPos.x) * alpha,
        y: a.prevPos.y + (a.pos.y - a.prevPos.y) * alpha,
        z: a.prevPos.z + (a.pos.z - a.prevPos.z) * alpha,
      };
      const s = snap(p);
      view.root.position.set(s.x, s.y, s.z);
      view.root.rotation.y = pixel ? a.sprite.yaw : a.yaw;
      view.pose(pixel ? a.sprite : a.anim);
      if (view.shadow) {
        const height = Math.max(0, p.y - a.groundY);
        const sh = snap({ x: p.x, y: a.groundY + 0.012, z: p.z });
        view.shadow.position.set(sh.x, a.groundY + 0.012, sh.z);
        view.shadow.scale.setScalar(Math.max(0.4, 1 - height * 0.3));
        view.shadow.visible = config['render.blobShadows'] && height < 3;
      }
      if (id === this.follow) {
        followPos = p;
        followDrawn = { x: s.x, y: s.y, z: s.z };
      }
    }
    // Locked mode follows the target's SNAPPED position: it keeps the exact same screen pixels
    // while the world scrolls in whole art pixels.
    if (followPos && followDrawn) {
      const f = config['render.smoothScroll'] || !snapMovers ? followPos : followDrawn;
      this.focus.set(f.x, f.y + FOLLOW_HEIGHT, f.z);
    }
    for (const h of this.renderHooks) h(alpha, dt);

    const snapCam = pixel && config['render.snapCamera'];
    const fp = { x: this.focus.x, y: this.focus.y, z: this.focus.z };
    this.subPixel = snapCam && config['render.smoothScroll'] ? subPixel(fp, this.basis, ppm) : { x: 0, y: 0 };
    this.placeCamera(snapCam ? snapToGrid(fp, this.basis, ppm) : fp);

    // The sun's shadow camera follows the view in 6 m steps, so shadow texels never crawl.
    this.sun.castShadow = config['render.shadows'];
    const cx = Math.round(this.focus.x / 6) * 6, cz = Math.round(this.focus.z / 6) * 6;
    if (cx !== this.shadowCell.x || cz !== this.shadowCell.z) {
      this.shadowCell = { x: cx, z: cz };
      this.sun.position.set(cx + this.sunDir.x * 40, this.sunDir.y * 40, cz + this.sunDir.z * 40);
      this.sun.target.position.set(cx, 0, cz);
      this.sun.target.updateMatrixWorld();
    }
    const reach = Math.max(this.pipeline.width, this.pipeline.height) / 2 / ppm + 7;
    this.lights.commit(this.focus.x, this.focus.z, reach);

    ensureNormals(this.scene);
    this.pipeline.render(this.scene, this.camera, { subPixel: this.subPixel, overlay: this.drawHud() });
    this.needsRender = false;
    const info = this.renderer.info.render;
    Object.assign(this.frameStats, { calls: info.calls, triangles: info.triangles, ms: performance.now() - t0 });
  }

  private placeCamera(f: V3) {
    const b = this.basis, cam = this.camera, ppm = config['render.pixelsPerMeter'];
    cam.position.set(f.x - b.forward.x * CAMERA_DISTANCE, f.y - b.forward.y * CAMERA_DISTANCE, f.z - b.forward.z * CAMERA_DISTANCE);
    cam.lookAt(f.x, f.y, f.z);
    const hw = this.pipeline.width / 2 / ppm, hh = this.pipeline.height / 2 / ppm;
    Object.assign(cam, { left: -hw, right: hw, top: hh, bottom: -hh });
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** Canvas backing store in DEVICE pixels, so integer upscaling stays exact under OS display scaling. */
  private resize() {
    if (!this.sizeDirty) return;
    this.sizeDirty = false;
    const dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
  }

  /** The visible part of the low-res frame in HUD-canvas coordinates (origin top-left). */
  viewRect(): ViewRect {
    const v = this.pipeline.visibleRect();
    return { x: v.x, y: this.pipeline.height - v.y - v.h, w: v.w, h: v.h };
  }

  private drawHud(): THREE.Texture | null {
    if (!this.hud || !this.hudOn) return null;
    const { width: w, height: h } = this.pipeline;
    if (!this.hudCanvas) {
      this.hudCanvas = document.createElement('canvas');
      // capture() reads the HUD back to composite it over the exact pixels.
      this.hudCtx = this.hudCanvas.getContext('2d', { willReadFrequently: true })!;
    }
    const c = this.hudCanvas, g = this.hudCtx!;
    if (!this.hudTexture || c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      // A resized canvas needs a fresh GPU texture.
      this.hudTexture?.dispose();
      const t = (this.hudTexture = new THREE.CanvasTexture(c));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
    }
    g.clearRect(0, 0, w, h);
    this.hud(g, this.viewRect(), this);
    this.hudTexture.needsUpdate = true;
    return this.hudTexture;
  }

  /**
   * The current frame as exact low-res pixels (draws first): origin top-left, 1 unit = 1 art pixel.
   * `hud: false` leaves the HUD out. Plain mode: the canvas downsampled to the same size.
   */
  capture(o: { hud?: boolean } = {}): Img {
    const p = this.pipeline, hud = o.hud !== false;
    this.hudOn = hud || config['render.pixelMode'];
    this.render(1);
    this.hudOn = true;
    const rect = p.visibleRect();
    if (!config['render.pixelMode']) {
      const g = Object.assign(document.createElement('canvas'), { width: rect.w, height: rect.h }).getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.renderer.domElement, 0, 0, rect.w, rect.h);
      const d = g.getImageData(0, 0, rect.w, rect.h);
      return { width: d.width, height: d.height, data: d.data };
    }
    const img = p.read(p.main, rect);
    if (hud && this.hud && this.hudCtx) {
      const v = this.viewRect();
      const ov = this.hudCtx.getImageData(v.x, v.y, v.w, v.h).data;
      for (let i = 0; i < ov.length; i += 4) {
        const k = ov[i + 3] / 255;
        if (k > 0) for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(ov[i + c] * k + img.data[i + c] * (1 - k));
      }
    }
    return img;
  }

  /** World point -> capture pixel (origin top-left of the visible frame), with the last drawn camera. */
  toCapture(p: V3): { x: number; y: number } {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    const r = this.viewRect();
    return { x: ((v.x + 1) / 2) * this.pipeline.width - r.x, y: ((1 - v.y) / 2) * this.pipeline.height - r.y };
  }

  /**
   * Ground point under a client (CSS pixel) position: undoes the integer upscale and sub-pixel
   * offset, unprojects through the orthographic camera and meets the plane y = planeY.
   */
  pick(clientX: number, clientY: number, planeY = 0): V3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dx = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const dy = ((clientY - rect.top) / rect.height) * this.canvas.height;
    let ndcX: number, ndcY: number;
    if (config['render.pixelMode']) {
      const p = this.pipeline, sub = this.subPixel;
      const tx = (dx + (p.width * p.scale - p.deviceW) / 2 + sub.x * p.scale) / p.scale;
      const ty = (p.deviceH - dy + (p.height * p.scale - p.deviceH) / 2 + sub.y * p.scale) / p.scale;
      ndcX = (tx / p.width) * 2 - 1;
      ndcY = (ty / p.height) * 2 - 1;
    } else {
      ndcX = (dx / this.canvas.width) * 2 - 1;
      ndcY = 1 - (dy / this.canvas.height) * 2;
    }
    const origin = new THREE.Vector3(ndcX, ndcY, -1).unproject(this.camera);
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (planeY - origin.y) / dir.y;
    return { x: origin.x + dir.x * t, y: planeY, z: origin.z + dir.z * t };
  }

  /** Everything an agent needs about the current frame, as JSON. */
  state() {
    const s = this.world.snapshot();
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const rect = this.pipeline.visibleRect();
    return {
      ...s,
      hash: this.world.hash(),
      paused: this.paused,
      agentMode: this.agentMode,
      inputKeys: this.world.inputKeys,
      view: {
        width: rect.w, height: rect.h, scale: this.pipeline.scale, pixelMode: config['render.pixelMode'], palette: config['render.palette'],
        focus: [r3(this.focus.x), r3(this.focus.y), r3(this.focus.z)], fps: this.fps, ...this.frameStats,
      },
      // Each drawn actor's feet in capture pixels (the coordinates of scene.capture).
      actors: s.actors.map((a) => {
        const v = this.views.get(a.id);
        if (!v?.root.visible) return { ...a, screen: null };
        const c = this.toCapture(v.root.position);
        return { ...a, screen: [Math.round(c.x), Math.round(c.y)] };
      }),
    };
  }

  dispose() {
    this.stop();
    configListeners.delete(this.onConfig);
    removeEventListener('resize', this.markResized);
    this.resizeObserver?.disconnect();
    for (const id of [...this.views.keys()]) this.removeView(id);
    this.hudTexture?.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
  }
}

/** Keys for bindKeyboard (KeyboardEvent.code values): movement plus named buttons. */
export const DEFAULT_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  buttons: { attack: ['Space', 'KeyJ'] } as Record<string, string[]>,
};

/**
 * Keyboard -> world.input: moveX/moveZ from screen directions ("up" walks up the screen) and
 * `input[button] = true` on press. Buttons latch until the game consumes them (sets them false),
 * so a tap between two steps is never lost. Ignored in agent mode. Returns an unbind function.
 */
export function bindKeyboard(engine: PixelEngine, keys = DEFAULT_KEYS): () => void {
  const held = new Set<string>();
  const any = (codes: string[]) => codes.some((c) => held.has(c));
  const mapped = new Set([...keys.up, ...keys.down, ...keys.left, ...keys.right, ...Object.values(keys.buttons).flat()]);
  const sync = () => {
    const m = screenToGround(engine.basis, Number(any(keys.right)) - Number(any(keys.left)), Number(any(keys.up)) - Number(any(keys.down)));
    engine.world.input.moveX = m.x;
    engine.world.input.moveZ = m.z;
  };
  const down = (e: KeyboardEvent) => {
    if (engine.agentMode || !mapped.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    for (const [name, codes] of Object.entries(keys.buttons)) if (codes.includes(e.code)) engine.world.input[name] = true;
    sync();
  };
  const up = (e: KeyboardEvent) => {
    if (held.delete(e.code)) sync();
  };
  const blur = () => {
    held.clear();
    sync();
  };
  addEventListener('keydown', down);
  addEventListener('keyup', up);
  addEventListener('blur', blur);
  return () => {
    removeEventListener('keydown', down);
    removeEventListener('keyup', up);
    removeEventListener('blur', blur);
  };
}

// == 13. AGENT TOOLS ===============================================================================
// Typed tools with validated parameters, defaults, examples and JSON Schemas (the engine's
// src/agent/registry.ts contract), so any agent can discover and call them: browser console,
// Playwright, or an MCP bridge. Tools that draw set needs: 'engine'. Images: a tool calls
// ctx.image(name, img) and puts the returned reference in its data; the result carries the PNG.

export type ParamType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export interface ParamSpec {
  type: ParamType; desc: string; default?: unknown; enum?: readonly (string | number)[]; min?: number; max?: number; required?: boolean;
  /** Element type for arrays. */
  items?: { type: ParamType; enum?: readonly (string | number)[] };
}

/** `png` is a data URL in the browser; under Node the raw pixels come in `img`. */
export interface ToolImage { name: string; width: number; height: number; png?: string; img?: Img }

export interface ToolContext {
  engine: PixelEngine | null;
  /** Attach an image to the result; returns a reference to put in the data. */
  image(name: string, img: Img, scale?: number): string;
}

export interface ToolDef {
  name: string;
  group: string;
  desc: string;
  params: Record<string, ParamSpec>;
  /** 'engine' tools need the live renderer (browser). */
  needs?: 'engine';
  /** Example arguments shown in help (give one when a parameter is required). */
  example?: Record<string, unknown>;
  run(args: Record<string, any>, ctx: ToolContext): unknown;
}

export type ToolResult = { ok: true; data: unknown; images: ToolImage[]; ms: number } | { ok: false; error: string; ms: number };

const TOOLS = new Map<string, ToolDef>();

export function defineTool(t: ToolDef): ToolDef {
  if (TOOLS.has(t.name)) throw new Error(`tool "${t.name}" defined twice`);
  TOOLS.set(t.name, t);
  return t;
}

export function tool(name: string): ToolDef | undefined {
  return TOOLS.get(name);
}

export function allTools(): ToolDef[] {
  return [...TOOLS.values()];
}

/** JSON Schema of a tool's parameters (MCP `inputSchema`). */
export function schemaOf(t: ToolDef) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, p] of Object.entries(t.params)) {
    const s: Record<string, unknown> = { type: p.type, description: p.desc };
    if (p.enum) s.enum = p.enum;
    if (p.items) s.items = { type: p.items.type, ...(p.items.enum ? { enum: p.items.enum } : {}) };
    if (p.min !== undefined) s.minimum = p.min;
    if (p.max !== undefined) s.maximum = p.max;
    if (p.default !== undefined) s.default = p.default;
    properties[k] = s;
    if (p.required) required.push(k);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export function describeTools(group?: string) {
  return allTools()
    .filter((t) => !group || t.group === group)
    .map((t) => ({ name: t.name, group: t.group, desc: t.desc, needs: t.needs ?? 'none', params: schemaOf(t), example: t.example ?? null }));
}

const typeOk = (v: unknown, type: ParamType) =>
  type === 'array' ? Array.isArray(v) : type === 'integer' ? Number.isInteger(v) : type === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === type;

/** Validates and fills defaults; throws with a helpful message. */
export function validateArgs(t: ToolDef, raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const args: Record<string, unknown> = { ...(raw ?? {}) };
  const known = Object.keys(t.params);
  for (const k of Object.keys(args)) {
    if (!(k in t.params)) throw new Error(`unknown parameter "${k}" for ${t.name}. Parameters: ${known.join(', ') || '(none)'}`);
  }
  for (const [k, p] of Object.entries(t.params)) {
    let v = args[k];
    if (v === undefined || v === null) {
      if (p.required) throw new Error(`${t.name}: "${k}" is required (${p.desc})`);
      if (p.default !== undefined) args[k] = structuredClone(p.default);
      else delete args[k];
      continue;
    }
    // Friendly coercion for CLI strings.
    if ((p.type === 'number' || p.type === 'integer') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = args[k] = Number(v);
    if (p.type === 'boolean' && (v === 'true' || v === 'false')) v = args[k] = v === 'true';
    if (!typeOk(v, p.type)) throw new Error(`${t.name}: "${k}" must be ${p.type}, got ${JSON.stringify(v)}`);
    if (p.enum && !p.enum.includes(v as string | number)) throw new Error(`${t.name}: "${k}" must be one of ${p.enum.join(', ')}; got ${JSON.stringify(v)}`);
    if (typeof v === 'number' && ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max))) throw new Error(`${t.name}: "${k}" must be within [${p.min ?? '-inf'}, ${p.max ?? 'inf'}]`);
    if (p.type === 'array' && p.items) {
      for (const x of v as unknown[]) {
        if (!typeOk(x, p.items.type)) throw new Error(`${t.name}: every "${k}" entry must be ${p.items.type}`);
        if (p.items.enum && !p.items.enum.includes(x as string | number)) throw new Error(`${t.name}: "${k}" entries must be among ${p.items.enum.join(', ')}; got ${JSON.stringify(x)}`);
      }
    }
  }
  return args;
}

/** Encodes images as PNG data URLs when a DOM is available. */
export function encodeImage(img: Img, scale = 1): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if (scale === 1) return c.toDataURL('image/png');
  const s = document.createElement('canvas');
  s.width = img.width * scale;
  s.height = img.height * scale;
  const g = s.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, s.width, s.height);
  return s.toDataURL('image/png');
}

export async function callTool(name: string, raw: Record<string, unknown> | null | undefined, engine: PixelEngine | null): Promise<ToolResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const t = TOOLS.get(name);
  if (!t) {
    const near = allTools().map((x) => x.name).filter((n) => n.split('.')[0] === name.split('.')[0] || n.includes(name));
    return { ok: false, error: `unknown tool "${name}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Call "help" for the list.`, ms: ms() };
  }
  const images: ToolImage[] = [];
  const ctx: ToolContext = {
    engine,
    image(imgName, img, scale = 1) {
      const png = encodeImage(img, scale);
      images.push({ name: imgName, width: img.width * scale, height: img.height * scale, ...(png ? { png } : { img }) });
      return `image:${imgName}`;
    },
  };
  try {
    if (t.needs === 'engine' && !engine) throw new Error(`${name} needs the running engine (browser): call it through window.agent`);
    const args = validateArgs(t, raw);
    const data = await t.run(args, ctx);
    return { ok: true, data: data ?? null, images, ms: ms() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: ms() };
  }
}

defineTool({
  name: 'help', group: 'meta',
  desc: 'Lists every tool by group, or explains one tool (parameters, defaults, example). Start here.',
  params: { tool: { type: 'string', desc: 'Tool name for details (omit for the list).' } },
  run({ tool: name }) {
    if (name) {
      const t = tool(name);
      if (!t) throw new Error(`unknown tool "${name}"`);
      return { name: t.name, group: t.group, desc: t.desc, needs: t.needs ?? 'none', params: schemaOf(t), example: t.example ?? null };
    }
    const groups: Record<string, Array<{ name: string; desc: string }>> = {};
    for (const t of describeTools()) (groups[t.group] ??= []).push({ name: t.name, desc: t.desc });
    return { tools: allTools().length, groups, usage: 'agent.call(name, args) resolves to { ok, data, images } or { ok: false, error }. Images are PNG data URLs.' };
  },
});

defineTool({
  name: 'config.get', group: 'config',
  desc: 'Lists settings with their current value, default, range and description (render.*, anim.*, sim.timeScale).',
  params: { prefix: { type: 'string', default: '', desc: 'Only keys starting with this, e.g. "render."' } },
  run: ({ prefix }) => describeConfig().filter((c) => c.key.startsWith(prefix)),
});

defineTool({
  name: 'config.set', group: 'config',
  desc: 'Changes settings live, validated against their ranges. Returns each key with its previous value.',
  params: { values: { type: 'object', required: true, desc: 'Key -> value, e.g. {"render.palette":"pico8","render.outlines":false}.' } },
  example: { values: { 'render.palette': 'pico8' } },
  run: ({ values }) => Object.entries(values as Record<string, unknown>).map(([k, v]) => setConfig(k, v)),
});

defineTool({
  name: 'game.state', group: 'world', needs: 'engine',
  desc: 'The frame, state hash, input and every actor: position, facing, clip, sprite frame and direction, data, and feet position in capture pixels.',
  params: {},
  run: (_args, { engine }) => engine!.state(),
});

defineTool({
  name: 'game.input', group: 'world', needs: 'engine',
  desc: 'Sets the input the simulation reads (defaults + these keys; moveX/moveZ are a world XZ direction) for `frames` steps, then it resets. game.state lists the input keys.',
  params: {
    input: { type: 'object', required: true, desc: 'Input keys and values, e.g. {"moveX":1,"moveZ":0} or {"attack":true}.' },
    frames: { type: 'integer', default: -1, min: -1, max: 216000, desc: 'Steps before the input resets to defaults (-1: until changed).' },
  },
  example: { input: { moveX: 0.7, moveZ: -0.7 }, frames: 30 },
  run({ input, frames }, { engine }) {
    const w = engine!.world;
    w.setInput(input, frames);
    return { input: w.input, frames, inputKeys: w.inputKeys };
  },
});

defineTool({
  name: 'game.step', group: 'world', needs: 'engine',
  desc: 'Advances exactly N simulation frames (60 per second), then draws. Returns the frame, the state hash and the events that happened.',
  params: { frames: { type: 'integer', default: 1, min: 1, max: 216000, desc: 'Frames to advance.' } },
  example: { frames: 60 },
  run({ frames }, { engine }) {
    const w = engine!.world, seq = w.lastEventSeq;
    engine!.step(frames);
    return { frame: w.frame, hash: w.hash(), events: w.eventsSince(seq).slice(-50) };
  },
});

defineTool({
  name: 'scene.capture', group: 'render', needs: 'engine',
  desc: 'The current frame as exact low-res pixels (what the pipeline produced, not the upscaled canvas). Origin top-left, 1 unit = 1 art pixel: the coordinates of game.state screen positions.',
  params: {
    scale: { type: 'integer', default: 1, min: 1, max: 8, desc: 'Whole-number upscale of the returned PNG (pixels stay sharp).' },
    hud: { type: 'boolean', default: true, desc: 'Include the HUD overlay.' },
  },
  run({ scale, hud }, ctx) {
    const e = ctx.engine!, img = e.capture({ hud });
    return { image: ctx.image('frame', img, scale), width: img.width, height: img.height, frame: e.world.frame, pixelMode: config['render.pixelMode'], palette: config['render.palette'] };
  },
});

export interface AgentApi {
  ready: boolean;
  /** Advance exact frames, then draw. */
  step(frames?: number): void;
  state(): ReturnType<PixelEngine['state']>;
  /** PNG data URL of the current frame (exact pixels, upscaled by `scale`). */
  capture(scale?: number): string | undefined;
  tools(group?: string): ReturnType<typeof describeTools>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
}

/** Installs `window.agent` (and `window.engine`) for consoles, Playwright and MCP bridges. */
export function installAgent(engine: PixelEngine): AgentApi {
  const api: AgentApi = {
    ready: true,
    step: (frames = 1) => engine.step(frames),
    state: () => engine.state(),
    capture: (scale = 1) => encodeImage(engine.capture(), scale),
    tools: (group) => describeTools(group),
    call: (name, args) => callTool(name, args ?? {}, engine),
  };
  Object.assign(globalThis, { agent: api, engine });
  return api;
}
