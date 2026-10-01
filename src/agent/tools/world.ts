/**
 * Live-game tools: inspect and drive the running game (state, travel, stepping, hero input),
 * change the hero, spawn monsters, let the bot play or run the autopilot, capture frames and read
 * render stats and logs. Everything steps the sim in exact frames, so a sequence of calls is a
 * reproducible script.
 */
import { MECHANIC_IDS } from '../../content/mechanics';
import { ensureMonster, MONSTER_AFFIXES, PALETTES, type MonsterRarity } from '../../content/monsters';
import { DUNGEON_THEMES } from '../../content/themes';
import { ITEM_BASES, RARITY_COLOR, type ItemRarity, type SlotKind } from '../../content/items';
import type { Game } from '../../game';
import { autoHero, type BuildFocus } from '../../sim/autobuild';
import { runBot } from '../../sim/bot';
import { addToInventory } from '../../sim/hero';
import { rollItem } from '../../sim/items';
import { Rng } from '../../sim/rng';
import type { SimEvent } from '../../sim/sim';
import { annotate, captureFrame, entityBoxes, type Img } from '../capture';
import { logBuffer } from '../logs';
import { heroSheet } from '../probe';
import { defineTool } from '../registry';
import { buildStageLevel, levelSummary } from './content';

const g = (ctx: { game: Game | null }) => ctx.game!;
const r2 = (n: number) => Math.round(n * 100) / 100;
const FOCI = ['melee', 'spell', 'balanced'] as const;
const GEAR = ['starter', 'normal', 'magic', 'rare', 'unique'] as const;

/** The compact state every live tool returns after acting. */
export function brief(game: Game) {
  const sim = game.sim;
  const p = sim.player;
  const alive = [...sim.characters.values()].filter((c) => c.monster && c.state !== 'dead');
  const boss = alive.find((c) => c.monster!.boss);
  return {
    mode: game.mode, stage: game.stageNo, title: game.level.title ?? null, mechanics: game.level.mechanics ?? [], frame: sim.frame, busy: game.busy,
    hero: p && game.hero ? {
      level: game.hero.level, life: Math.round(p.life), maxLife: Math.round(p.maxLife), mana: Math.round(p.mana), gold: game.hero.gold, state: p.state,
      pos: [r2(p.pos.x), r2(p.pos.z)], action: p.action?.skill ?? null, flasks: game.hero.flasks, hotbar: game.hero.hotbar,
    } : null,
    monsters: { alive: alive.length, elites: alive.filter((c) => c.monster!.rarity !== 'normal').length, boss: boss ? { name: boss.name, life: Math.round(boss.life), maxLife: Math.round(boss.maxLife) } : null },
    stageStats: { ...sim.stage, time: r2(sim.stage.time / 60) },
    pickups: sim.pickups.length,
    autopilot: game.autopilot,
  };
}

function eventDigest(events: SimEvent[]) {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const notable = events.filter((e) => /death|levelup|boss|portal|exit|hero\.|pickup|mechanic|keg|shrine|launch|rift|totem|imp\./.test(e.type) && !(e.type === 'pickup' && e.kind === 'gold'))
    .slice(-12).map((e) => ({ frame: e.frame, type: e.type, ...Object.fromEntries(Object.entries(e).filter(([k, v]) => !['seq', 'frame', 'type', 'x', 'z'].includes(k) && v !== null && v !== undefined)) }));
  return { counts, notable };
}

defineTool({
  name: 'game.state', group: 'world', needs: 'game',
  desc: 'Where the game is: mode, depth, title, mechanics, the hero (life, mana, gold, position, hotbar), monsters alive, boss, stage stats, autopilot. detail=true adds every character, prop, zone and pickup.',
  params: { detail: { type: 'boolean', default: false, desc: 'Include the full sim snapshot.' } },
  run({ detail }, ctx) {
    const game = g(ctx);
    return detail ? { ...brief(game), snapshot: game.sim.snapshot() } : brief(game);
  },
});

defineTool({
  name: 'game.goto', group: 'world', needs: 'game',
  desc: 'Travels: town, a campaign depth, a remixed depth (theme / layout / mechanics / seed) or the training room. Optionally swaps in an auto-built hero of a level first.',
  params: {
    to: { type: 'string', required: true, enum: ['town', 'stage', 'sandbox'], desc: 'Destination.' },
    stage: { type: 'integer', default: 1, min: 1, max: 10000, desc: 'Depth for to=stage.' },
    theme: { type: 'string', enum: DUNGEON_THEMES, desc: 'Remix: theme.' },
    layout: { type: 'string', enum: ['rooms', 'caves', 'halls'], desc: 'Remix: layout.' },
    mechanics: { type: 'array', items: { type: 'string', enum: MECHANIC_IDS }, desc: 'Remix: mechanics.' },
    seed: { type: 'integer', desc: 'Remix: layout seed salt.' },
    heroLevel: { type: 'integer', min: 1, max: 500, desc: 'Replace the hero with an auto-built one of this level.' },
    focus: { type: 'string', default: 'melee', enum: FOCI, desc: 'Auto-build focus.' },
    gear: { type: 'string', enum: GEAR, desc: 'Auto-build gear rarity.' },
  },
  example: { to: 'stage', stage: 14, heroLevel: 28 },
  async run(a, ctx) {
    const game = g(ctx);
    await game.idle();
    if (a.heroLevel) game.hero = autoHero({ level: a.heroLevel, focus: a.focus as BuildFocus, gear: a.gear, name: game.hero?.name ?? 'Ranger' });
    if (a.to === 'town') await game.enterTown();
    else if (a.to === 'sandbox') await game.startSandbox();
    else if (a.theme || a.layout || a.mechanics || a.seed) await game.enterStage(a.stage, buildStageLevel(a as never));
    else await game.enterStage(a.stage);
    return { ...brief(game), level: game.level.grid ? levelSummary(game.level) : null };
  },
});

defineTool({
  name: 'game.step', group: 'world', needs: 'game',
  desc: 'Advances the simulation exactly N frames (60 per second) and draws once. Returns event counts, notable events (deaths, loot, level-ups, mechanics) and the new state.',
  params: { frames: { type: 'integer', default: 60, min: 1, max: 60 * 600, desc: 'Frames to step.' } },
  async run({ frames }, ctx) {
    const game = g(ctx);
    const from = game.sim.lastEventSeq;
    const sim = game.sim;
    game.step(frames);
    const events = sim.eventsSince(from);
    await game.idle();
    return { stepped: frames, events: eventDigest(events), state: brief(game) };
  },
});

defineTool({
  name: 'game.input', group: 'world', needs: 'game',
  desc: 'Drives the hero like a controller for N frames, then steps: move direction, aim point (or the nearest monster), basic attack, a hotbar slot, dodge, interact, flask.',
  params: {
    move: { type: 'array', items: { type: 'number' }, desc: 'World direction [x, z] (normalized for you).' },
    aim: { type: 'array', items: { type: 'number' }, desc: 'World point [x, z] to aim at.' },
    aimNearest: { type: 'boolean', default: false, desc: 'Aim at the nearest living monster.' },
    attack: { type: 'boolean', default: false, desc: 'Hold the basic attack.' },
    skill: { type: 'integer', min: 0, max: 4, desc: 'Press hotbar slot 0-4 once.' },
    dodge: { type: 'boolean', default: false, desc: 'Dodge roll (in the move direction).' },
    interact: { type: 'boolean', default: false, desc: 'Interact (pick up, use, talk).' },
    flask: { type: 'integer', min: 0, max: 1, desc: 'Drink flask 0 (life) or 1 (mana).' },
    frames: { type: 'integer', default: 20, min: 1, max: 3600, desc: 'Frames to hold the input and step.' },
  },
  example: { move: [1, 0], attack: true, aimNearest: true, frames: 30 },
  async run(a, ctx) {
    const game = g(ctx);
    const sim = game.sim, p = sim.player;
    if (!p) throw new Error('no hero in this mode (sandbox uses the legacy player; try game.goto town or stage)');
    let aim = a.aim ? { x: a.aim[0], z: a.aim[1] } : null;
    if (a.aimNearest) {
      const m = [...sim.characters.values()].filter((c) => c.monster && c.state !== 'dead').sort((x, y) => Math.hypot(x.pos.x - p.pos.x, x.pos.z - p.pos.z) - Math.hypot(y.pos.x - p.pos.x, y.pos.z - p.pos.z))[0];
      if (m) aim = { x: m.pos.x, z: m.pos.z };
    }
    const len = a.move ? Math.hypot(a.move[0], a.move[1]) || 1 : 1;
    sim.setInput('player', {
      moveX: a.move ? a.move[0] / len : 0, moveZ: a.move ? a.move[1] / len : 0, aim, attackHeld: a.attack, skill: a.skill ?? -1,
      dodge: a.dodge, interact: a.interact, flask: a.flask ?? -1,
    }, a.frames);
    const from = sim.lastEventSeq;
    game.step(a.frames);
    const events = sim.eventsSince(from);
    await game.idle();
    return { events: eventDigest(events), state: brief(game) };
  },
});

defineTool({
  name: 'hero.set', group: 'world', needs: 'game',
  desc: 'Rebuilds the current hero as an auto-built character of a level (gear, tree, hotbar), keeping name and progress; or just sets gold.',
  params: {
    level: { type: 'integer', min: 1, max: 500, desc: 'New level (rebuilds gear and tree).' },
    focus: { type: 'string', default: 'melee', enum: FOCI, desc: 'Build focus.' },
    gear: { type: 'string', enum: GEAR, desc: 'Gear rarity.' },
    gold: { type: 'integer', min: 0, desc: 'Set gold.' },
    seed: { type: 'integer', default: 1, desc: 'Gear seed.' },
  },
  run(a, ctx) {
    const game = g(ctx);
    const hero = game.hero;
    if (!hero) throw new Error('no hero (go to town or a depth first)');
    if (a.level) {
      const fresh = autoHero({ level: a.level, focus: a.focus as BuildFocus, gear: a.gear, seed: a.seed, name: hero.name });
      Object.assign(hero, { level: fresh.level, xp: 0, equipment: fresh.equipment, tree: fresh.tree, hotbar: fresh.hotbar, jewels: {}, flasks: fresh.flasks });
    }
    if (a.gold !== undefined) hero.gold = a.gold;
    game.sim.refreshHero();
    const p = game.sim.player;
    if (p) {
      p.life = p.maxLife;
      p.mana = p.maxMana;
    }
    game.save();
    game.render(1);
    return heroSheet(game.sim);
  },
});

defineTool({
  name: 'hero.sheet', group: 'world', needs: 'game',
  desc: 'The current hero\'s character sheet: life, mana, defences, resistances, attributes, speeds, loot stats, equipment and damage of every hotbar skill.',
  params: {},
  run(_a, ctx) {
    return heroSheet(g(ctx).sim);
  },
});

defineTool({
  name: 'hero.give', group: 'world', needs: 'game',
  desc: 'Rolls items into the hero\'s inventory (same roller as drops).',
  params: {
    ilvl: { type: 'integer', default: 10, min: 1, max: 1000, desc: 'Item level.' },
    rarity: { type: 'string', enum: ['normal', 'magic', 'rare', 'unique'], desc: 'Rarity (default rolled).' },
    base: { type: 'string', enum: ITEM_BASES.map((b) => b.id), desc: 'Base id.' },
    slot: { type: 'string', desc: 'Slot kind.' },
    count: { type: 'integer', default: 1, min: 1, max: 40, desc: 'How many.' },
    seed: { type: 'integer', default: 1, desc: 'Roll seed.' },
  },
  run(a, ctx) {
    const game = g(ctx);
    const hero = game.hero;
    if (!hero) throw new Error('no hero');
    const rng = new Rng(a.seed * 31337 + hero.nextUid);
    const got = [];
    for (let i = 0; i < a.count; i++) {
      const item = rollItem(rng, { ilvl: a.ilvl, rarity: a.rarity as ItemRarity | undefined, base: a.base, slot: a.slot as SlotKind | undefined, uid: `g${hero.nextUid++}` });
      if (!addToInventory(hero, item)) break;
      got.push({ name: item.name, rarity: item.rarity, base: item.base, color: RARITY_COLOR[item.rarity] });
    }
    game.save();
    return { added: got, freeSlots: hero.inventory.filter((x) => !x).length };
  },
});

defineTool({
  name: 'monster.spawn', group: 'world', needs: 'game',
  desc: 'Spawns monsters into the live level near the hero (or at a point): any built-in, sp:<plan>:<seed> species or custom: id, at a level, rarity, affixes and palette. They wake up and fight.',
  params: {
    id: { type: 'string', required: true, desc: 'Monster id.' },
    count: { type: 'integer', default: 1, min: 1, max: 30, desc: 'How many.' },
    level: { type: 'integer', min: 1, max: 500, desc: 'Monster level (default: the level\'s, or the hero\'s).' },
    rarity: { type: 'string', default: 'normal', enum: ['normal', 'magic', 'rare', 'unique'], desc: 'Rarity.' },
    affixes: { type: 'array', items: { type: 'string', enum: Object.keys(MONSTER_AFFIXES) }, default: [], desc: 'Affixes.' },
    palette: { type: 'string', enum: Object.keys(PALETTES), desc: 'Palette.' },
    at: { type: 'array', items: { type: 'number' }, desc: 'World point [x, z] (default: 4 m from the hero).' },
    awake: { type: 'boolean', default: true, desc: 'Start awake and hunting.' },
  },
  example: { id: 'sp:drake:11', rarity: 'rare', affixes: ['hasted'] },
  run(a, ctx) {
    const game = g(ctx);
    const sim = game.sim;
    ensureMonster(a.id);
    const p = sim.player ?? [...sim.characters.values()][0];
    const level = a.level ?? game.level.monsterLevel ?? game.hero?.level ?? 1;
    const ids: string[] = [];
    for (let i = 0; i < a.count; i++) {
      const ang = (i / a.count) * Math.PI * 2;
      const cx = a.at ? a.at[0] : p.pos.x + Math.cos(ang) * 4, cz = a.at ? a.at[1] : p.pos.z + Math.sin(ang) * 4;
      const q = sim.nav.nearestFree({ x: cx + (a.at ? Math.cos(ang) * 0.8 * (a.count > 1 ? 1 : 0) : 0), z: cz + (a.at ? Math.sin(ang) * 0.8 * (a.count > 1 ? 1 : 0) : 0) });
      const id = `agent_${a.id.replace(/[^a-z0-9]/gi, '')}_${sim.frame}_${i}`;
      const ch = sim.spawn({ id, preset: 'ranger', x: q.x, z: q.z, brain: 'monster', monster: { def: a.id, level, rarity: a.rarity as MonsterRarity, affixes: a.affixes, palette: a.palette, pack: `agent${sim.frame}` } });
      ch.ai.awake = a.awake;
      ids.push(ch.id);
    }
    game.stage.syncRoster(sim);
    game.render(1);
    return { spawned: ids, level, names: ids.map((id) => sim.get(id).name) };
  },
});

defineTool({
  name: 'bot.play', group: 'world', needs: 'game',
  desc: 'The bot plays the live game for up to N seconds (or until it leaves through the exit): explores, fights, dodges, loots, uses mechanics. Returns its report and the final frame.',
  params: {
    seconds: { type: 'integer', default: 30, min: 1, max: 1200, desc: 'Game seconds to play.' },
    strategy: { type: 'string', default: 'clear', enum: ['clear', 'rush'], desc: 'clear = every room, rush = straight to the boss.' },
    mechanics: { type: 'boolean', default: true, desc: 'Use level mechanics.' },
    exit: { type: 'boolean', default: true, desc: 'Take the exit when the boss is down.' },
    capture: { type: 'boolean', default: true, desc: 'Return the final frame.' },
  },
  async run(a, ctx) {
    const game = g(ctx);
    await game.idle();
    if (!game.sim.player || !game.hero) throw new Error('no hero here (game.goto a depth first)');
    const wasAuto = game.autopilot.on;
    game.setAutopilot(null);
    const sim = game.sim;
    const report = runBot(sim, { strategy: a.strategy, mechanics: a.mechanics, exit: a.exit, maxFrames: a.seconds * 60 }, () => game.sim === sim && !game.busy, () => game.step(1, false));
    await game.idle();
    if (wasAuto) game.setAutopilot({});
    game.render(1);
    return { report, state: brief(game), frame: a.capture ? ctx.image('frame', captureFrame(game), 2) : undefined };
  },
});

defineTool({
  name: 'bot.autopilot', group: 'world', needs: 'game',
  desc: 'Turns the autopilot on or off: the bot plays the hero in real time (watch it in the browser) and during game.step.',
  params: {
    on: { type: 'boolean', required: true, desc: 'On or off.' },
    strategy: { type: 'string', default: 'clear', enum: ['clear', 'rush'], desc: 'Strategy.' },
  },
  run(a, ctx) {
    const game = g(ctx);
    game.setAutopilot(a.on ? { strategy: a.strategy } : null);
    return game.autopilot;
  },
});

/** Composites the HUD overlay (the low-res canvas the pipeline upscales with the frame) over a capture. */
function withOverlay(game: Game, img: Img): Img {
  const p = game.pipeline, rect = p.visibleRect();
  const top = p.height - rect.y - rect.h;
  const o = game.overlay.canvas;
  if (o.width < rect.x + rect.w || o.height < top + rect.h) return img;
  const d = o.getContext('2d')!.getImageData(rect.x, top, rect.w, rect.h).data;
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    const a = d[i + 3] / 255;
    if (!a) continue;
    out.data[i] = out.data[i] * (1 - a) + d[i] * a;
    out.data[i + 1] = out.data[i + 1] * (1 - a) + d[i + 1] * a;
    out.data[i + 2] = out.data[i + 2] * (1 - a) + d[i + 2] * a;
    out.data[i + 3] = 255;
  }
  return out;
}

defineTool({
  name: 'scene.capture', group: 'render', needs: 'game',
  desc: 'Captures the current frame as exact low-res art pixels (upscaled losslessly), optionally with the in-world HUD overlay and labelled boxes around characters and crates for vision models.',
  params: {
    scale: { type: 'integer', default: 2, min: 1, max: 8, desc: 'Integer upscale.' },
    hud: { type: 'boolean', default: true, desc: 'Include the overlay (life bars, labels, numbers, minimap).' },
    annotate: { type: 'boolean', default: false, desc: 'Draw labelled entity boxes.' },
  },
  run(a, ctx) {
    const game = g(ctx);
    let img = captureFrame(game);
    if (a.hud && game.mode !== 'sandbox') img = withOverlay(game, img);
    const out: Record<string, unknown> = { width: img.width, height: img.height, stats: { ...game.frameStats } };
    if (a.annotate) {
      const boxes = entityBoxes(game).filter((b) => b.x + b.w > 0 && b.y + b.h > 0 && b.x < img.width && b.y < img.height);
      const labels: Record<string, string> = {};
      for (const b of boxes) {
        const c = game.sim.characters.get(b.id);
        if (c) labels[b.id] = `${c.name}${c.monster && c.monster.rarity !== 'normal' ? ` (${c.monster.rarity})` : ''}`;
      }
      const canvas = annotate(img, boxes, a.scale, labels);
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      out.image = ctx.image('frame', { width: d.width, height: d.height, data: d.data });
      out.boxes = boxes.map((b) => ({ ...b, label: labels[b.id] ?? b.id }));
    } else out.image = ctx.image('frame', img, a.scale);
    return out;
  },
});

defineTool({
  name: 'scene.stats', group: 'render', needs: 'game',
  desc: 'Renderer and scene numbers: draw calls, triangles, frame ms, fps, low-res size and upscale, views, sim population.',
  params: {},
  run(_a, ctx) {
    const game = g(ctx);
    const p = game.pipeline, sim = game.sim;
    game.render(1);
    let objects = 0;
    game.stage.scene.traverse(() => objects++);
    return {
      frame: { ...game.frameStats, ms: r2(game.frameStats.ms) }, fps: game.fps, renderFrames: game.renderFrames,
      lowRes: { width: p.width, height: p.height, scale: p.scale, device: [p.deviceW, p.deviceH] },
      scene: { objects, views: game.stage.views.size },
      sim: { characters: sim.characters.size, props: sim.props.size, projectiles: sim.projectiles.length, zones: sim.zones.length, pickups: sim.pickups.length, frame: sim.frame },
    };
  },
});

defineTool({
  name: 'logs.read', group: 'render', needs: 'game',
  desc: 'Console errors, warnings and uncaught exceptions captured since boot (check after every change).',
  params: { since: { type: 'integer', default: 0, desc: 'Only entries after this sequence number.' }, level: { type: 'string', enum: ['error', 'warn', 'info'], desc: 'Only this level.' } },
  run({ since, level }) {
    return logBuffer.filter((e) => e.t > since && (!level || e.level === level));
  },
});
