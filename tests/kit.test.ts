/**
 * The single-file agent kit (kit/3dpixel2d.ts): the parts it shares with the engine must stay
 * identical to their sources, and its own simulation, config and tool contracts must hold.
 * The browser half (pipeline, engine, demo) is exercised by `npm run verify:kit`.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kit from '../kit/3dpixel2d';
import kitSource from '../kit/3dpixel2d.ts?raw';
import pipelineSource from '../src/render/pixelPipeline.ts?raw';
import { schemaOf as engineSchemaOf, validateArgs as engineValidateArgs, type ToolDef as EngineToolDef } from '../src/agent/registry';
import { CONFIG_SPEC as ENGINE_CONFIG } from '../src/config';
import * as engineGeo from '../src/render/geo';
import { LightPool as EngineLightPool } from '../src/render/lights';
import { glowMaterial as engineGlow, toonGradient as engineGradient, toonize as engineToonize, writesNormals as engineWritesNormals } from '../src/render/materials';
import { glyphBits as engineGlyphBits, textWidth as engineTextWidth } from '../src/render/pixelFont';
import * as engineGrid from '../src/render/pixelGrid';
import { hexToOklab as engineOklab, MAX_PALETTE as ENGINE_MAX_PALETTE, PALETTES as ENGINE_PALETTES } from '../src/render/palettes';
import { hashSeed as engineHashSeed, Rng as EngineRng } from '../src/sim/rng';

const KIT_URL = new URL('../kit/3dpixel2d.ts', import.meta.url).href;

afterEach(() => kit.resetConfig());

describe('agent kit: a single self-contained file', () => {
  it('imports nothing but three', () => {
    const specifiers = [...kitSource.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(['three', 'three/addons/postprocessing/Pass.js', 'three/addons/utils/BufferGeometryUtils.js']);
    expect(kitSource).not.toMatch(/(import|require)\(\s*['"]\.\.?\//);
  });

  it('stays compact enough to hand to an agent in one read', () => {
    // Budget for the hand-off file; raise it deliberately, not by accident.
    expect(kitSource.length).toBeLessThan(115_000);
    // The header and the example come first: an agent can stop reading after them.
    expect(kitSource.indexOf('// == EXAMPLE')).toBeLessThan(kitSource.indexOf('// == 1. CONFIG'));
  });
});

describe('agent kit: parity with the engine sources', () => {
  it('Rng and hashSeed produce the same streams', () => {
    for (const seed of [0, 1, 7, 42, 0xdeadbeef, 2 ** 31 + 5]) {
      const a = new kit.Rng(seed), b = new EngineRng(seed);
      for (let i = 0; i < 64; i++) expect(a.next()).toBe(b.next());
      expect([a.range(-3, 9), a.int(1, 6), a.chance(0.3), a.pick(['x', 'y', 'z'])]).toEqual([b.range(-3, 9), b.int(1, 6), b.chance(0.3), b.pick(['x', 'y', 'z'])]);
      expect(a.weighted([1, 2, 3, 0], (n) => n)).toBe(b.weighted([1, 2, 3, 0], (n) => n));
      expect(a.shuffle([1, 2, 3, 4, 5, 6, 7])).toEqual(b.shuffle([1, 2, 3, 4, 5, 6, 7]));
      expect(a.state).toBe(b.state);
    }
    for (const parts of [[], ['level', 7], ['creature', 42, 'x'], [0], ['']] as Array<Array<string | number>>) expect(kit.hashSeed(...parts)).toBe(engineHashSeed(...parts));
  });

  it('pixel-grid math is the same', () => {
    const r = new kit.Rng(3);
    for (const [yaw, pitch] of [[45, 30], [30, 35], [0, 60], [-120, 20]]) {
      const a = kit.isoBasis(yaw, pitch), b = engineGrid.isoBasis(yaw, pitch);
      expect(a).toEqual(b);
      for (let i = 0; i < 40; i++) {
        const p = { x: r.range(-50, 50), y: r.range(0, 5), z: r.range(-50, 50) }, ppm = r.range(8, 64);
        expect(kit.snapToGrid(p, a, ppm)).toEqual(engineGrid.snapToGrid(p, b, ppm));
        expect(kit.subPixel(p, a, ppm)).toEqual(engineGrid.subPixel(p, b, ppm));
        expect(kit.screenPx(p, a, ppm)).toEqual(engineGrid.screenPx(p, b, ppm));
        const yawR = r.range(-10, 10);
        expect(kit.dir8(yawR)).toEqual(engineGrid.dir8(yawR));
      }
    }
    for (const [w, h, lines] of [[1920, 1080, 270], [390, 844, 270], [1366, 768, 300], [2560, 1440, 120]]) expect(kit.chooseScale(w, h, lines)).toEqual(engineGrid.chooseScale(w, h, lines));
    expect(kit.DIR8_SCREEN_NAMES).toEqual(engineGrid.DIR8_SCREEN_NAMES);
  });

  it('palettes and OKLab conversion are the same', () => {
    expect(kit.PALETTES).toEqual(ENGINE_PALETTES);
    expect(kit.MAX_PALETTE).toBe(ENGINE_MAX_PALETTE);
    for (const hex of Object.values(kit.PALETTES).flat()) expect(kit.hexToOklab(hex)).toEqual(engineOklab(hex));
    expect(kit.CONFIG_SPEC['render.palette'].options).toEqual(kit.PALETTE_NAMES);
  });

  it('every config key matches the engine key of the same name exactly', () => {
    const keys = Object.keys(kit.CONFIG_SPEC) as kit.ConfigKey[];
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) {
      const engineSpec = (ENGINE_CONFIG as Record<string, kit.ConfigSpec>)[key];
      expect(engineSpec, key).toBeDefined();
      expect({ ...kit.CONFIG_SPEC[key] }, key).toEqual({ ...engineSpec });
    }
  });

  it('the GLSL is the pipeline source text', () => {
    const glsl = (name: string) => {
      const m = new RegExp(`const ${name} = /\\* glsl \\*/ \`([\\s\\S]*?)\`;`).exec(pipelineSource);
      if (!m) throw new Error(`${name} not found in src/render/pixelPipeline.ts`);
      return m[1].replaceAll('${MAX_PALETTE}', String(ENGINE_MAX_PALETTE));
    };
    for (const name of ['quadVertex', 'postFragment', 'upscaleFragment', 'copyFragment'] as const) expect(kit.GLSL[name], name).toBe(glsl(name));
  });

  it('material patches compile to the same shaders', () => {
    const compile = (m: THREE.Material, lib: { vertexShader: string; fragmentShader: string }) => {
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(shader, null as never);
      return { vertex: shader.vertexShader, fragment: shader.fragmentShader, key: m.customProgramCacheKey(), patches: m.userData.patches };
    };
    const cases: Array<[() => THREE.Material, 'surface' | 'fx', { vertexShader: string; fragmentShader: string }]> = [
      [() => new THREE.MeshToonMaterial(), 'surface', THREE.ShaderLib.toon],
      [() => new THREE.MeshBasicMaterial(), 'surface', THREE.ShaderLib.basic],
      [() => new THREE.MeshBasicMaterial({ transparent: true }), 'fx', THREE.ShaderLib.basic],
    ];
    for (const [make, kind, lib] of cases) {
      const a = compile(kit.writesNormals(make(), kind), lib), b = compile(engineWritesNormals(make(), kind), lib);
      expect(a).toEqual(b);
      expect(a.fragment).toContain('pc_fragNormal');
    }
    expect(compile(kit.glowMaterial(0xff0000), THREE.ShaderLib.basic)).toEqual(compile(engineGlow(0xff0000), THREE.ShaderLib.basic));
    expect([...kit.toonGradient().image.data!]).toEqual([...engineGradient().image.data!]);
    const src = () => new THREE.MeshStandardMaterial({ name: 'Hair', color: 0x884422, transparent: true, side: THREE.DoubleSide });
    const ta = kit.toonize(src()), tb = engineToonize(src());
    for (const k of ['name', 'transparent', 'alphaTest', 'side', 'type'] as const) expect(ta[k], k).toEqual(tb[k]);
    expect(ta.color.getHex()).toBe(tb.color.getHex());
    expect(ta.userData.patches).toEqual(tb.userData.patches);
  });

  it('ensureNormals patches stray materials once, as surface or fx', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new THREE.Scene();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true }));
    const made = new THREE.Mesh(new THREE.BoxGeometry(), kit.toonMaterial(0xffffff));
    scene.add(solid, glass, made, kit.blobShadow());
    expect(kit.ensureNormals(scene)).toBe(2);
    expect(kit.ensureNormals(scene)).toBe(0);
    expect(solid.material.userData.patches).toEqual(['normals-surface']);
    expect(glass.material.userData.patches).toEqual(['normals-fx']);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('the light pool assigns the same lights', () => {
    const a = new kit.LightPool(), b = new EngineLightPool();
    const r = new kit.Rng(9);
    for (const pool of [a, b]) pool.begin();
    for (let i = 0; i < 30; i++) {
      const req = { x: r.range(-20, 20), y: 1.5, z: r.range(-20, 20), color: '#ffb066', intensity: r.range(0, 3), range: r.range(2, 8), priority: r.int(0, 4) };
      a.add(req);
      b.add(req);
    }
    a.commit(1, -2, 12);
    b.commit(1, -2, 12);
    const state = (p: { lights: THREE.PointLight[] }) => p.lights.map((l) => [l.position.toArray(), l.color.getHex(), l.intensity, l.distance]);
    expect(state(a)).toEqual(state(b));
    expect(a.active).toBe(b.active);
  });

  it('the geometry kit builds the same geometry', () => {
    const attrs = (g: THREE.BufferGeometry) => ({
      index: g.index ? [...g.index.array] : null,
      ...Object.fromEntries(Object.entries(g.attributes).map(([k, v]) => [k, [...(v as THREE.BufferAttribute).array]])),
    });
    const place = { at: [1, 2, 3], rot: [0.1, 0.2, 0.3], scale: [1, 2, 0.5] } as kit.Place;
    const pairs: Array<[THREE.BufferGeometry, THREE.BufferGeometry]> = [
      [kit.box(1, 2, 3, '#ff8800', place), engineGeo.box(1, 2, 3, '#ff8800', place)],
      [kit.cyl(0.2, 0.3, 1, '#123456', { scale: 2 }), engineGeo.cyl(0.2, 0.3, 1, '#123456', { scale: 2 })],
      [kit.cone(0.4, 1, 'red'), engineGeo.cone(0.4, 1, 'red')],
      [kit.sphere(0.5, 0x00ff00, place, 10, 8), engineGeo.sphere(0.5, 0x00ff00, place, 10, 8)],
      [kit.torus(0.5, 0.1, '#fff'), engineGeo.torus(0.5, 0.1, '#fff')],
      [kit.ico(0.3, '#abc', undefined, 1), engineGeo.ico(0.3, '#abc', undefined, 1)],
      [kit.octa(0.3, '#cba'), engineGeo.octa(0.3, '#cba')],
      [kit.lathe([[0, 0], [0.3, 0.5], [0, 1]], '#777'), engineGeo.lathe([[0, 0], [0.3, 0.5], [0, 1]], '#777')],
    ];
    for (const [a, b] of pairs) expect(attrs(a)).toEqual(attrs(b));
    expect(attrs(kit.merge([kit.box(1, 1, 1, '#f00'), kit.cone(0.5, 1, '#0f0')]))).toEqual(attrs(engineGeo.merge([engineGeo.box(1, 1, 1, '#f00'), engineGeo.cone(0.5, 1, '#0f0')])));
    expect(kit.tone('#808080', 0.5).getHex()).toBe(engineGeo.tone('#808080', 0.5).getHex());
  });

  it('the pixel font draws the same glyphs', () => {
    for (let c = 32; c < 127; c++) expect(kit.glyphBits(String.fromCharCode(c))).toBe(engineGlyphBits(String.fromCharCode(c)));
    for (const t of ['', 'A', 'FRAME 120', 'hello, world!']) for (const s of [1, 2]) expect(kit.textWidth(t, s)).toBe(engineTextWidth(t, s));
  });

  it('the tool registry has the same contract', () => {
    const def = {
      name: 'demo.tool', group: 'demo', desc: 'A tool used to compare registries.',
      params: {
        count: { type: 'integer', default: 3, min: 1, max: 9, desc: 'How many.' },
        kind: { type: 'string', enum: ['a', 'b'], required: true, desc: 'Which.' },
        tags: { type: 'array', items: { type: 'string', enum: ['x', 'y'] }, desc: 'Tags.' },
        on: { type: 'boolean', desc: 'Flag.' },
      },
      run: () => null,
    } satisfies kit.ToolDef;
    expect(kit.schemaOf(def)).toEqual(engineSchemaOf(def as EngineToolDef));
    const inputs: Array<Record<string, unknown>> = [
      { kind: 'a' }, { kind: 'b', count: '5', on: 'true' }, {}, { kind: 'c' }, { kind: 'a', count: 0 }, { kind: 'a', tags: ['x', 'z'] }, { kind: 'a', extra: 1 }, { kind: 'a', count: 2.5 },
    ];
    for (const input of inputs) {
      const run = (f: () => unknown) => {
        try {
          return { ok: f() };
        } catch (e) {
          return { error: (e as Error).message };
        }
      };
      expect(run(() => kit.validateArgs(def, input))).toEqual(run(() => engineValidateArgs(def as EngineToolDef, input)));
    }
  });
});

describe('agent kit: World (deterministic simulation)', () => {
  const CLIPS: kit.ClipTable = { idle: { duration: 1, loop: true }, walk: { duration: 0.5, loop: true }, swing: { duration: 0.4, loop: false } };

  /** A tiny game: the hero follows the input, a wanderer moves on world.rng. */
  function game(seed: number) {
    const w = new kit.World({ seed, clips: CLIPS, input: { attack: false } });
    const hero = w.spawn('hero', { yawDeg: 90 });
    const wanderer = w.spawn('wanderer', { x: 3, data: { steps: 0 } });
    w.onStep((w) => {
      const mx = Number(w.input.moveX), mz = Number(w.input.moveZ);
      hero.pos.x += mx * 4 * w.dt;
      hero.pos.z += mz * 4 * w.dt;
      if (mx || mz) w.turnToward(hero, kit.yawOf(mx, mz));
      w.play(hero, mx || mz ? 'walk' : 'idle');
      if (w.input.attack) {
        w.input.attack = false;
        w.play(hero, 'swing', { restart: true });
        w.emit('swing', { by: 'hero' });
      }
      wanderer.pos.x += w.rng.range(-1, 1) * w.dt;
      (wanderer.data as { steps: number }).steps++;
    });
    return w;
  }
  const script = (w: kit.World) => {
    for (let f = 0; f < 300; f++) {
      if (f % 60 === 0) w.setInput({ moveX: Math.sin(f), moveZ: Math.cos(f) }, 45);
      if (f === 100) w.setInput({ attack: true }, 1);
      w.step();
    }
  };

  it('replays identically for the same seed and inputs, and differs for another seed', () => {
    const a = game(7), b = game(7), c = game(8);
    script(a);
    script(b);
    script(c);
    expect(a.hash()).toBe(b.hash());
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(c.hash()).not.toBe(a.hash());
    expect(JSON.parse(JSON.stringify(a.snapshot()))).toEqual(a.snapshot());
  });

  it('holds timed input for exactly its frames, then resets to the defaults', () => {
    const w = new kit.World({ input: { attack: false } });
    const seen: number[] = [];
    w.onStep((w) => void seen.push(Number(w.input.moveX)));
    w.setInput({ moveX: 1 }, 3);
    for (let i = 0; i < 5; i++) w.step();
    expect(seen).toEqual([1, 1, 1, 0, 0]);
    expect(w.input).toEqual({ moveX: 0, moveZ: 0, attack: false });
    expect(w.inputKeys).toEqual(['moveX', 'moveZ', 'attack']);
    w.setInput({ moveZ: -1 });
    for (let i = 0; i < 100; i++) w.step();
    expect(w.input.moveZ).toBe(-1);
  });

  it('samples poses and facing only on sprite ticks, snapped to 8 directions', () => {
    const w = new kit.World({ clips: CLIPS });
    const a = w.spawn('a', { clip: 'walk' });
    w.onStep(() => void (a.yaw += 0.05));
    w.step(); // the first step always samples (like the engine's Sim, lastTick starts at -1)
    const ticks: number[] = [];
    for (let f = 2; f <= 30; f++) {
      const before = a.sprite;
      w.step();
      ticks.push(a.sprite.tick);
      // 12 sprite ticks per second at 60 Hz: the pose changes on every 5th frame only.
      if (f % 5 !== 0) expect(a.sprite).toBe(before);
      else {
        expect(a.sprite.tick).toBe(f / 5);
        // Displayed facing is the actor's facing snapped to the nearest of 8 directions.
        expect(a.sprite.dir).toBe(kit.dir8(a.yaw).index);
        expect(a.sprite.yaw).toBeCloseTo(a.sprite.dir * (Math.PI / 4), 12);
      }
    }
    expect(new Set(ticks).size).toBe(7);
    kit.setConfig('anim.stepped', false);
    kit.setConfig('anim.dir8', false);
    const t0 = a.sprite.time;
    w.step();
    expect(a.sprite.time).not.toBe(t0);
    expect(a.sprite.yaw).toBe(a.yaw);
  });

  it('advances, loops, clamps and blends clips like the engine', () => {
    const w = new kit.World({ clips: CLIPS });
    const a = w.spawn('a');
    for (let i = 0; i < 70; i++) w.step();
    expect(a.anim.time).toBeCloseTo((70 / 60) % 1, 9);
    w.play(a, 'swing');
    expect(a.anim).toMatchObject({ clip: 'swing', time: 0, prevClip: 'idle', blend: 0 });
    for (let i = 0; i < 3; i++) w.step();
    expect(a.anim.blend).toBeCloseTo(0.5, 9);
    // anim.blend = 0.1 s: the fade finishes within 7 steps (6 x 1/60 s lands a hair under 1).
    for (let i = 0; i < 4; i++) w.step();
    expect(a.anim.blend).toBe(1);
    expect(a.anim.prevClip).toBeNull();
    expect(w.clipDone(a)).toBe(false);
    for (let i = 0; i < 60; i++) w.step();
    expect(a.anim.time).toBe(0.4); // non-looping clips clamp at their end
    expect(w.clipDone(a)).toBe(true);
    w.play(a, 'swing');
    expect(a.anim.time).toBe(0.4);
    w.play(a, 'swing', { restart: true, blend: 0 });
    expect(a.anim).toMatchObject({ time: 0, prevClip: null, blend: 1 });
  });

  it('turns at a bounded rate and records events', () => {
    const w = new kit.World();
    const a = w.spawn('a');
    w.turnToward(a, Math.PI / 2, 6);
    expect(a.yaw).toBeCloseTo(0.1, 9);
    for (let i = 0; i < 300; i++) w.emit('tick', { i });
    expect(w.events.length).toBe(256);
    expect(w.lastEventSeq).toBe(300);
    expect(w.eventsSince(298).map((e) => e.i)).toEqual([298, 299]);
    expect(() => w.get('nobody')).toThrow(/no actor "nobody". Actors: a/);
    expect(() => w.spawn('a')).toThrow(/already exists/);
  });

  it('maps screen directions onto the ground', () => {
    const b = kit.isoBasis(45, 30);
    const up = kit.screenToGround(b, 0, 1), right = kit.screenToGround(b, 1, 0), diag = kit.screenToGround(b, 1, 1);
    expect(up).toEqual({ x: b.groundUp.x, z: b.groundUp.z });
    expect(right).toEqual({ x: b.groundRight.x, z: b.groundRight.z });
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1, 12);
    expect(kit.screenToGround(b, 0, 0)).toEqual({ x: 0, z: 0 });
    // Walking "up" the screen moves away from the camera (into the screen).
    expect(up.x * b.forward.x + up.z * b.forward.z).toBeGreaterThan(0);
  });
});

describe('agent kit: config and tools', () => {
  it('validates config changes with actionable errors', () => {
    expect(kit.setConfig('render.palette', 'pico8')).toEqual({ key: 'render.palette', value: 'pico8', previous: 'none' });
    expect(() => kit.setConfig('render.nope', 1)).toThrow(/unknown config key "render.nope"/);
    expect(() => kit.setConfig('render.outlineStrength', 2)).toThrow(/within \[0, 1\]/);
    expect(() => kit.setConfig('render.outlines', 'yes')).toThrow(/expects a boolean/);
    expect(() => kit.setConfig('render.palette', 'gameboy')).toThrow(/one of: none, endesga32, sweetie16, pico8/);
    const seen: string[] = [];
    const listen = (k: kit.ConfigKey) => void seen.push(k);
    kit.configListeners.add(listen);
    kit.setConfig('anim.fps', 8);
    kit.resetConfig();
    kit.configListeners.delete(listen);
    expect(seen).toEqual(['anim.fps', 'render.palette', 'anim.fps']);
    expect(kit.describeConfig().find((c) => c.key === 'anim.fps')).toMatchObject({ value: 12, default: 12, min: 1, max: 60 });
  });

  it('documents every built-in tool and runs the pure ones', async () => {
    const names = kit.allTools().map((t) => t.name);
    expect(names).toEqual(['help', 'config.get', 'config.set', 'game.state', 'game.input', 'game.step', 'scene.capture']);
    for (const t of kit.allTools()) {
      expect(t.desc.length, t.name).toBeGreaterThan(20);
      if (Object.values(t.params).some((p) => p.required)) expect(t.example, t.name).toBeTruthy();
      if (t.example) expect(() => kit.validateArgs(t, t.example)).not.toThrow();
    }
    const help = await kit.callTool('help', {}, null);
    expect(help.ok && (help.data as { tools: number }).tools).toBe(7);
    const set = await kit.callTool('config.set', { values: { 'render.outlines': false } }, null);
    expect(set.ok).toBe(true);
    expect(kit.config['render.outlines']).toBe(false);
    const get = await kit.callTool('config.get', { prefix: 'anim.' }, null);
    expect(get.ok && (get.data as Array<{ key: string }>).map((c) => c.key)).toEqual(['anim.stepped', 'anim.fps', 'anim.dir8', 'anim.blend']);
    const step = await kit.callTool('game.step', { frames: 1 }, null);
    expect(step).toMatchObject({ ok: false, error: expect.stringMatching(/needs the running engine/) });
    const typo = await kit.callTool('game.stepp', {}, null);
    expect(typo).toMatchObject({ ok: false, error: expect.stringMatching(/Did you mean: .*game\.step/) });
  });
});

describe('agent kit: runs as-is in Node', () => {
  // Node 22.18+ strips TypeScript types natively (older versions skip this). The repo has no Node
  // typings, hence the loose types.
  const proc = (globalThis as unknown as { process: { execPath: string; features: { typescript?: string | false } } }).process;
  it.runIf(!!proc.features.typescript)('loads without a build step and simulates identically', async () => {
    const childProcess = 'node:child_process';
    const { execFileSync } = (await import(/* @vite-ignore */ childProcess)) as { execFileSync: (file: string, args: string[], o: object) => string };
    const code = `const k = await import(${JSON.stringify(KIT_URL)});
      const w = new k.World({ seed: 11 });
      const a = w.spawn('a');
      w.onStep((w) => { a.pos.x += w.rng.range(-1, 1); a.yaw += 0.01; });
      for (let i = 0; i < 240; i++) w.step();
      console.log(w.hash());`;
    const out = execFileSync(proc.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const w = new kit.World({ seed: 11 });
    const a = w.spawn('a');
    w.onStep((w) => {
      a.pos.x += w.rng.range(-1, 1);
      a.yaw += 0.01;
    });
    for (let i = 0; i < 240; i++) w.step();
    expect(out).toBe(w.hash());
  });
});
