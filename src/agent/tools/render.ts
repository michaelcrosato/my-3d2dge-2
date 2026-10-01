/**
 * Asset rendering tools: procedural creatures as sprite sheets (any plan, seed, palette, genome
 * edit, pose and direction), lineups of many seeds for browsing a species space, monsters as they
 * appear in game (humanoid presets with palette tints, creatures with their genome) and item
 * icons. Everything is drawn through the game's own pixel pipeline, so it matches the game.
 */
import { animsOf } from '../../content/characters';
import { ITEM_BASES, RARITY_COLOR, type ItemRarity, type SlotKind } from '../../content/items';
import { ensureMonster, PALETTES, RARITY_SCALING, type MonsterRarity } from '../../content/monsters';
import { BODY_PLANS, CREATURE_PRESETS, generateGenome, planOf, speciesName, type GenomeEdits } from '../../content/procgen/creature';
import type { Game } from '../../game';
import { IconRenderer } from '../../render/icons';
import { rollItem } from '../../sim/items';
import { Rng } from '../../sim/rng';
import { renderSpriteSheet } from '../capture';
import { PREVIEW_POSES, renderCreatureSheet, type PreviewPose } from '../forge';
import { probeSim, spawnProbeMonster } from '../probe';
import { contactSheet } from '../raster';
import { defineTool } from '../registry';

const g = (ctx: { game: Game | null }) => ctx.game!;
let icons: IconRenderer | null = null;

defineTool({
  name: 'creature.render', group: 'render', needs: 'game',
  desc: 'Sprite sheet of a procedural creature (rows = pose x direction, columns = frames) rendered with the game camera, toon light and outlines, plus rig info (bones, limbs, height). Judge a genome before it reaches a dungeon.',
  params: {
    plan: { type: 'string', required: true, desc: `Body plan (${BODY_PLANS.join(', ')}) or preset (${CREATURE_PRESETS.join(', ')}).` },
    seed: { type: 'integer', default: 1, desc: 'Genome seed.' },
    palette: { type: 'string', default: 'moss', enum: Object.keys(PALETTES), desc: 'Palette.' },
    genome: { type: 'object', desc: 'Genome edits (see creature.genome).' },
    poses: { type: 'array', items: { type: 'string', enum: PREVIEW_POSES }, default: ['idle', 'walk', 'bite', 'dead'], desc: 'Poses (rows).' },
    directions: { type: 'integer', default: 2, min: 1, max: 8, desc: 'Facings per pose.' },
    frames: { type: 'integer', default: 6, min: 1, max: 16, desc: 'Frames per row.' },
    cell: { type: 'integer', default: 96, min: 32, max: 256, desc: 'Cell size, art px.' },
    size: { type: 'number', default: 1, min: 0.3, max: 4, desc: 'Creature scale.' },
    scale: { type: 'integer', default: 2, min: 1, max: 6, desc: 'Image upscale.' },
  },
  example: { plan: 'scorpion', seed: 9, palette: 'ember', poses: ['idle', 'walk', 'claw'] },
  run(a, ctx) {
    const r = renderCreatureSheet(g(ctx), { plan: a.plan, seed: a.seed, palette: a.palette, genome: a.genome as GenomeEdits, poses: a.poses as PreviewPose[], directions: a.directions, frames: a.frames, cell: a.cell, scale: a.size });
    return { name: speciesName(planOf(a.plan), a.seed), speciesId: `sp:${a.plan}:${a.seed}`, rows: r.rows, frames: r.frames, cell: r.cell, rig: r.info, image: ctx.image('sheet', r.sheet, a.scale) };
  },
});

defineTool({
  name: 'creature.lineup', group: 'render', needs: 'game',
  desc: 'Contact sheet of many creatures, one idle frame each with its species name: browse a body plan\'s seed space, or every preset, to pick good species quickly.',
  params: {
    plan: { type: 'string', desc: 'Plan or preset (omit: one of every preset).' },
    seeds: { type: 'array', items: { type: 'integer' }, desc: 'Seeds to show (default 1..count).' },
    count: { type: 'integer', default: 12, min: 1, max: 64, desc: 'How many when seeds are not given.' },
    palette: { type: 'string', default: 'moss', enum: Object.keys(PALETTES), desc: 'Palette.' },
    genome: { type: 'object', desc: 'Genome edits applied to all.' },
    columns: { type: 'integer', default: 6, min: 1, max: 16, desc: 'Columns.' },
    cell: { type: 'integer', default: 112, min: 32, max: 200, desc: 'Cell size, art px (long serpents need ~120).' },
    scale: { type: 'integer', default: 2, min: 1, max: 6, desc: 'Image upscale.' },
  },
  run(a, ctx) {
    const game = g(ctx);
    const items: Array<{ plan: string; seed: number }> = a.plan
      ? (a.seeds ?? Array.from({ length: a.count }, (_, i) => i + 1)).map((seed: number) => ({ plan: a.plan, seed }))
      : CREATURE_PRESETS.map((plan, i) => ({ plan, seed: a.seeds?.[i] ?? 1 }));
    const cells = items.map(({ plan, seed }) => {
      const r = renderCreatureSheet(game, { plan, seed, palette: a.palette, genome: a.genome as GenomeEdits, poses: ['idle'], directions: 1, frames: 1, cell: a.cell });
      return { img: r.sheet, label: a.plan ? `${seed} ${speciesName(planOf(plan), seed)}` : plan };
    });
    return {
      species: items.map(({ plan, seed }) => ({ id: `sp:${plan}:${seed}`, name: speciesName(planOf(plan), seed), legs: generateGenome(plan, seed).legs.pairs * 2 })),
      image: ctx.image('lineup', contactSheet(cells, a.columns), a.scale),
    };
  },
});

defineTool({
  name: 'monster.render', group: 'render', needs: 'game',
  desc: 'Renders a monster as it appears in game: humanoid families with their palette tint (idle, run, attack, hit, death clips), creatures and species with genome, palette and rarity size.',
  params: {
    id: { type: 'string', required: true, desc: 'Monster id (built-in, sp:..., custom:...).' },
    palette: { type: 'string', enum: Object.keys(PALETTES), desc: 'Palette override.' },
    rarity: { type: 'string', default: 'normal', enum: ['normal', 'magic', 'rare', 'unique'], desc: 'Rarity (size).' },
    directions: { type: 'integer', default: 2, min: 1, max: 8, desc: 'Facings.' },
    frames: { type: 'integer', default: 6, min: 1, max: 12, desc: 'Frames per row.' },
    scale: { type: 'integer', default: 2, min: 1, max: 6, desc: 'Image upscale.' },
  },
  example: { id: 'boss_reaver' },
  async run(a, ctx) {
    const game = g(ctx);
    const def = ensureMonster(a.id);
    const size = def.size * RARITY_SCALING[a.rarity as MonsterRarity].size;
    const cell = Math.round(96 * Math.max(1, size * 0.8));
    if (def.body.kind === 'creature') {
      const r = renderCreatureSheet(game, { plan: def.body.plan, seed: def.body.seed ?? 1, genome: def.body.genome, palette: a.palette ?? def.palette, poses: ['idle', 'walk', 'bite', 'dead'], directions: a.directions, frames: a.frames, cell, scale: size });
      return { name: def.name, body: def.body, rows: r.rows, rig: r.info, image: ctx.image('sheet', r.sheet, a.scale) };
    }
    // Same tint the sim gives this monster: spawn it in a probe sim and borrow its look.
    const sim = await probeSim(game.sim.clips);
    try {
      const ch = spawnProbeMonster(sim, a.id, 1, a.rarity as MonsterRarity, [], a.palette);
      const anims = animsOf(def.body.preset);
      const clips = [anims.idle, anims.run, anims.attack[0], anims.death].filter((c, i, xs) => c && xs.indexOf(c) === i && game.lib.manifest.clips.some((m) => m.name === c));
      const r = renderSpriteSheet(game, { preset: def.body.preset, clips, directions: a.directions, fps: 8, cell, maxFrames: a.frames, look: ch.look, scale: size });
      return { name: def.name, body: def.body, palette: ch.look.palette, rows: r.rows, image: ctx.image('sheet', r.sheet, a.scale) };
    } finally {
      sim.dispose();
    }
  },
});

defineTool({
  name: 'item.icon', group: 'render', needs: 'game',
  desc: 'Engine-rendered inventory icons for rolled items (the same procedural meshes that drop on the floor and appear in hand), as a labelled contact sheet.',
  params: {
    ilvl: { type: 'integer', default: 10, min: 1, max: 1000, desc: 'Item level.' },
    rarity: { type: 'string', enum: ['normal', 'magic', 'rare', 'unique'], desc: 'Rarity (default rolled).' },
    base: { type: 'string', enum: ITEM_BASES.map((b) => b.id), desc: 'Base id.' },
    slot: { type: 'string', desc: 'Slot kind.' },
    all: { type: 'boolean', default: false, desc: 'One icon for every base instead of rolling.' },
    count: { type: 'integer', default: 12, min: 1, max: 80, desc: 'How many to roll.' },
    seed: { type: 'integer', default: 1, desc: 'Seed.' },
    columns: { type: 'integer', default: 6, min: 1, max: 16, desc: 'Columns.' },
    scale: { type: 'integer', default: 3, min: 1, max: 8, desc: 'Image upscale.' },
  },
  run(a, ctx) {
    const game = g(ctx);
    icons ??= new IconRenderer(game.renderer, game.pipeline, 40);
    const rng = new Rng(a.seed * 1543 + a.ilvl);
    const items = a.all
      ? ITEM_BASES.map((b, i) => rollItem(rng, { ilvl: Math.max(a.ilvl, b.level), base: b.id, rarity: (a.rarity ?? 'normal') as ItemRarity, uid: `i${i}` }))
      : Array.from({ length: a.count }, (_, i) => rollItem(rng, { ilvl: a.ilvl, rarity: a.rarity as ItemRarity | undefined, base: a.base, slot: a.slot as SlotKind | undefined, uid: `i${i}` }));
    const cells = items.map((it) => ({ img: icons!.image({ base: it.base, rarity: it.rarity, seed: it.seed, unique: it.unique }), label: it.name, color: RARITY_COLOR[it.rarity] }));
    return { items: items.map((it) => ({ name: it.name, base: it.base, rarity: it.rarity })), image: ctx.image('icons', contactSheet(cells, a.columns), a.scale) };
  },
});
