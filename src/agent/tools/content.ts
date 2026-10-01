/**
 * Content and simulation tools: everything an agent needs to generate and judge assets without
 * rendering. Catalogs, creature genomes and custom species, monster stat sheets, encounter and
 * item rolls, drop-table simulation, level generation with a map image, the passive tree, hero
 * builds, balance curves, bot playtests and difficulty. All deterministic for given arguments.
 */
import { applyDifficulty, config, CONFIG_SPEC, DIFFICULTY_PRESETS, describeConfig, setConfig, type ConfigKey } from '../../config';
import { AFFIXES } from '../../content/affixes';
import { DESIGN_ARCHETYPES, DESIGN_BODIES, DESIGN_SKILLS, designProblems, designStats, monsterId, registerDesign, releasedSpecies, setReleased, type SpeciesDesign } from '../../content/bestiary';
import { AUTHORED, campaignStage, stageMechanics, stageTitle } from '../../content/campaign';
import { PRESETS } from '../../content/characters';
import { BASES, ITEM_BASES, type ItemRarity, type SlotKind } from '../../content/items';
import type { Level } from '../../content/level';
import { MECHANIC_IDS, MECHANICS, placeMechanics } from '../../content/mechanics';
import { applyPactsToSpec, PACT_BY_ID, PACTS, stampPacts } from '../../content/pacts';
import { ARCHETYPES, ensureMonster, MONSTER_AFFIXES, MONSTERS, PALETTES, registerMonster, type MonsterDef, type MonsterRarity } from '../../content/monsters';
import { BODY_PLANS, CREATURE_PRESETS, generateGenome, PLAN_KIT, planOf, speciesName, type GenomeEdits } from '../../content/procgen/creature';
import { generateDungeon } from '../../content/procgen/dungeon';
import { rollPack } from '../../content/procgen/encounters';
import { HERO_SKILLS, HOTBAR_SKILLS, SKILL_NAMES, SKILLS, skill as skillDef } from '../../content/skills';
import { stageMonsterLevel, stageSpec } from '../../content/stages';
import { describeMod, STATS } from '../../content/stats';
import { STATUSES } from '../../content/statuses';
import { THEMES, DUNGEON_THEMES } from '../../content/themes';
import { pathTo, SECTOR_NAME, TREE } from '../../content/tree';
import { UNIQUES } from '../../content/uniques';
import { autoEquip, autoHero, heroPower, spendPoints, type BuildFocus } from '../../sim/autobuild';
import { runBot, type BotReport } from '../../sim/bot';
import { dropLoot } from '../../sim/loot';
import { NavGrid } from '../../sim/nav';
import { Rng } from '../../sim/rng';
import { monsterDamage, monsterLife, monsterXp, xpToNext } from '../../sim/scaling';
import { newHero, treePoints } from '../../sim/hero';
import { describeItem, itemValue, rollItem } from '../../sim/items';
import { Sim } from '../../sim/sim';
import { levelMap, treeImage } from '../maps';
import { heroSheet, monsterSheet, probeSim, spawnProbeMonster } from '../probe';
import { allTools, defineTool, describeTools, schemaOf, tool } from '../registry';

const RARITIES = ['normal', 'magic', 'rare', 'unique'] as const;
const FOCI = ['melee', 'spell', 'balanced'] as const;
const GEAR = ['starter', 'normal', 'magic', 'rare', 'unique'] as const;
const SLOTS: SlotKind[] = ['weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'jewel', 'flask'];
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- help + catalogs

defineTool({
  name: 'help', group: 'meta',
  desc: 'Lists every tool by group, or explains one tool (parameters, defaults, example). Start here.',
  params: { tool: { type: 'string', desc: 'Tool name for details (omit for the list).' }, group: { type: 'string', desc: 'Only this group.' } },
  run({ tool: name, group }) {
    if (name) {
      const t = tool(name);
      if (!t) throw new Error(`unknown tool "${name}"`);
      return { name: t.name, group: t.group, desc: t.desc, needs: t.needs ?? 'none', params: schemaOf(t), example: t.example ?? null };
    }
    const groups: Record<string, Array<{ name: string; desc: string; needs: string }>> = {};
    for (const t of describeTools(group)) (groups[t.group] ??= []).push({ name: t.name, desc: t.desc, needs: t.needs });
    return { tools: allTools().length, groups, usage: 'call(name, args). Images come back as PNGs (files from the CLI, image content over MCP). "needs: game" tools require the running game.' };
  },
});

defineTool({
  name: 'catalog.list', group: 'catalog',
  desc: 'Lists the building blocks: skills, monsters, archetypes, palettes, monster affixes, body plans, item bases, item affixes, uniques, mechanics, pacts (risk-for-reward depth modifiers), themes, statuses, stats, character presets, difficulty presets.',
  params: {
    kind: { type: 'string', required: true, desc: 'What to list.', enum: ['skills', 'monsters', 'archetypes', 'palettes', 'monsterAffixes', 'plans', 'bases', 'itemAffixes', 'uniques', 'mechanics', 'pacts', 'themes', 'statuses', 'stats', 'presets', 'difficulty'] },
    filter: { type: 'string', desc: 'Case-insensitive substring filter on id/name.' },
  },
  example: { kind: 'monsters', filter: 'boss' },
  run({ kind, filter }) {
    const f = (filter as string | undefined)?.toLowerCase();
    const keep = (...xs: Array<string | undefined>) => !f || xs.some((x) => x?.toLowerCase().includes(f));
    switch (kind) {
      case 'skills': return Object.values(SKILLS).filter((s) => keep(s.id, s.name)).map((s) => ({
        id: s.id, name: s.name, user: s.id.startsWith('m_') || s.id.startsWith('b_') ? 'monster' : HOTBAR_SKILLS.includes(s.id) ? 'hero hotbar' : 'internal', kind: s.kind, tags: s.tags,
        cost: s.cost ?? 0, cooldown: s.cooldown ?? 0, range: s.range, desc: s.desc,
      }));
      case 'monsters': return Object.values(MONSTERS).filter((m) => keep(m.id, m.name, m.family)).map((m) => ({
        id: m.id, name: m.name, family: m.family, archetype: m.archetype, body: m.body, skills: m.skills, palette: m.palette, life: m.life, damage: m.damage, speed: m.speed, size: m.size, boss: m.boss?.title ?? null,
      }));
      case 'archetypes': return Object.values(ARCHETYPES).filter((a) => keep(a.id, a.label)).map((a) => ({ ...a }));
      case 'palettes': return Object.values(PALETTES).filter((p) => keep(p.id, p.name)).map((p) => ({ id: p.id, name: p.name, element: p.element, word: p.word, resist: p.resist, colors: [p.primary, p.secondary, p.accent, p.glow] }));
      case 'monsterAffixes': return Object.values(MONSTER_AFFIXES).filter((a) => keep(a.id, a.name)).map((a) => ({ id: a.id, name: a.name, behaviour: a.behaviour ?? null, mods: a.mods.map((m) => describeMod(m)) }));
      case 'plans': return {
        plans: BODY_PLANS.map((p) => ({ plan: p, kit: PLAN_KIT[p] })),
        presets: CREATURE_PRESETS.map((p) => ({ preset: p, plan: planOf(p) })),
        speciesIds: 'sp:<plan or preset>:<seed>[:boss] resolves to a species anywhere a monster id is accepted',
      };
      case 'bases': return ITEM_BASES.filter((b) => keep(b.id, b.name, b.slot)).map((b) => ({ id: b.id, name: b.name, slot: b.slot, level: b.level, weapon: b.weapon ?? null, armour: b.armour ?? null, implicit: (b.implicit ?? []).map((m) => describeMod(m)) }));
      case 'itemAffixes': return AFFIXES.filter((a) => keep(a.id, a.word, a.stat)).map((a) => ({ id: a.id, kind: a.kind, word: a.word, slots: a.slots, stat: a.stat, mod: a.mod, range: a.range, scale: a.scale, group: a.group, minLevel: a.minLevel ?? 1 }));
      case 'uniques': return UNIQUES.filter((u) => keep(u.id, u.name, u.base)).map((u) => ({ id: u.id, name: u.name, base: u.base, level: u.level, flavour: u.flavour, mods: u.mods.map(([m, sc]) => `${describeMod(m, SKILL_NAMES)}${sc === 'fixed' ? '' : ` (scales: ${sc})`}`) }));
      case 'mechanics': return MECHANIC_IDS.filter((id) => keep(id, MECHANICS[id].name)).map((id) => {
        const m = MECHANICS[id];
        return { id, name: m.name, tip: m.tip, themes: m.themes, introducedAt: AUTHORED.findIndex((a) => a.mechanics.length === 1 && a.mechanics[0] === id) + 1 };
      });
      case 'themes': return Object.values(THEMES).filter((t) => keep(t.id, t.name)).map((t) => ({ id: t.id, name: t.name, palettes: t.palettes, particles: t.particles, ambient: t.ambient, breakables: t.breakables, decor: t.decor }));
      case 'statuses': return Object.values(STATUSES).filter((s) => keep(s.id, s.name)).map((s) => ({ id: s.id, name: s.name, kind: s.kind, stacking: s.stacking }));
      case 'stats': return Object.entries(STATS).filter(([id, s]) => keep(id, s.label)).map(([id, s]) => ({ id, label: s.label, group: s.group }));
      case 'presets': return Object.entries(PRESETS).filter(([id, p]) => keep(id, p.label)).map(([id, p]) => ({ id, label: p.label, base: p.base, parts: p.parts }));
      case 'difficulty': return DIFFICULTY_PRESETS;
      case 'pacts': return PACTS.filter((p) => keep(p.id, p.name));
    }
    return null;
  },
});

// ---------------------------------------------------------------- creatures and monsters

defineTool({
  name: 'creature.genome', group: 'creature',
  desc: 'The procedural genome for a body plan or preset and seed (with optional hand edits): body proportions, limbs, head, tail, wings, pattern, species id and name. Pair with creature.render to see it.',
  params: {
    plan: { type: 'string', required: true, desc: `Body plan (${BODY_PLANS.join(', ')}) or preset (${CREATURE_PRESETS.join(', ')}).` },
    seed: { type: 'integer', default: 1, desc: 'Genome seed.' },
    genome: { type: 'object', desc: 'Edits merged over the generated genome, e.g. {"legs":{"pairs":3},"wings":{"span":2},"horns":{"count":2}}. null removes wings/arms/tentacles.' },
    full: { type: 'boolean', default: true, desc: 'Include the whole genome (false: summary only).' },
  },
  example: { plan: 'drake', seed: 42, genome: { horns: { count: 4 } } },
  run({ plan, seed, genome, full }) {
    const g = generateGenome(plan, seed, genome as GenomeEdits | undefined);
    const summary = {
      plan: g.plan, legs: g.legs.pairs * 2, arms: g.arms ? 2 : 0, wings: !!g.wings, tentacles: g.tentacles?.count ?? 0, tailSegments: g.tail.segments, tailTip: g.tail.tip,
      head: g.head.shape, eyes: g.head.eyes, horns: g.horns.count, spikes: g.spikes.count, plates: g.plates, pattern: g.pattern, length: r1(g.length), height: r1(g.height),
    };
    return { speciesId: `sp:${plan}:${seed}`, name: speciesName(g.plan, seed), kit: PLAN_KIT[g.plan], summary, genome: full ? g : undefined };
  },
});

defineTool({
  name: 'species.create', group: 'creature',
  desc: 'Assembles a new monster from parts (body plan or humanoid preset + genome edits, archetype behaviour, attack modules, palette, stat multipliers) and registers it as custom:<id>. It can then be inspected, rendered, spawned (monster.spawn) or used in levels.',
  params: {
    id: { type: 'string', required: true, desc: 'Short id (letters, digits, _ -); stored as custom:<id>.' },
    name: { type: 'string', desc: 'Display name (default: generated species name).' },
    body: { type: 'string', required: true, desc: `Creature plan/preset (${[...BODY_PLANS, ...CREATURE_PRESETS].join(', ')}) or "humanoid:<preset>" (see catalog.list presets).` },
    seed: { type: 'integer', default: 1, desc: 'Genome seed for creature bodies.' },
    genome: { type: 'object', desc: 'Genome edits (see creature.genome).' },
    archetype: { type: 'string', desc: 'Behaviour (catalog.list archetypes). Default: from the body plan kit.', enum: Object.keys(ARCHETYPES) },
    skills: { type: 'array', items: { type: 'string' }, desc: 'Attack modules (m_*/b_* skills). Default: the body plan kit.' },
    palette: { type: 'string', default: 'moss', desc: 'Color palette / element.', enum: Object.keys(PALETTES) },
    life: { type: 'number', default: 1, min: 0.1, max: 20, desc: 'Life multiplier on the level curve.' },
    damage: { type: 'number', default: 1, min: 0, max: 10, desc: 'Damage multiplier.' },
    speed: { type: 'number', desc: 'Run speed m/s (default by plan).', min: 0.5, max: 12 },
    size: { type: 'number', default: 1, min: 0.3, max: 4, desc: 'Visual and collider scale.' },
    boss: { type: 'string', desc: 'Boss title; makes it a two-phase boss.' },
    minion: { type: 'string', desc: 'Monster id it summons (summoner skills).' },
  },
  example: { id: 'thornback', body: 'boar', seed: 7, genome: { spikes: { count: 10 } }, archetype: 'charger', skills: ['m_charge', 'm_bite'], palette: 'venom' },
  run(a) {
    const humanoid = String(a.body).startsWith('humanoid:');
    const plan = humanoid ? null : planOf(a.body);
    if (!humanoid && !CREATURE_PRESETS.includes(a.body) && !BODY_PLANS.includes(a.body)) throw new Error(`unknown body "${a.body}"`);
    const kit = plan ? PLAN_KIT[plan] : { skills: ['m_slash'], archetypes: ['skirmisher'] };
    const def: MonsterDef = {
      id: a.id, name: a.name ?? (plan ? speciesName(plan, a.seed) : 'Custom'), family: 'custom',
      body: humanoid ? { kind: 'humanoid', preset: String(a.body).slice(9) } : { kind: 'creature', plan: a.body, seed: a.seed, genome: a.genome },
      archetype: a.archetype ?? (a.boss ? 'boss' : kit.archetypes[0]), skills: a.skills ?? kit.skills.slice(0, 2), life: a.life, damage: a.damage,
      speed: a.speed ?? 4, size: a.size, xp: 1.2, palette: a.palette,
      boss: a.boss ? { title: a.boss, phases: 2, enrageAt: 0.35 } : undefined, minion: a.minion,
    };
    const stored = registerMonster(def);
    return { id: stored.id, def: stored, next: [`monster.inspect {"id":"${stored.id}","level":10}`, `monster.render {"id":"${stored.id}"}`, `monster.spawn {"id":"${stored.id}"}`] };
  },
});

defineTool({
  name: 'species.design', group: 'creature',
  desc: 'Designs a species the way the in-game Workshop does: body + genome edits + palette + archetype + up to three attacks, with life, damage and speed derived from the parts under a threat budget. Registers custom:<id> (and custom:<id>-boss). In the live game, save=true adds it to the player\'s bestiary and release=true sends it into the depths.',
  params: {
    id: { type: 'string', required: true, desc: 'Short id (lowercase letters, digits, _ -).' },
    name: { type: 'string', desc: 'Display name (default: generated).' },
    body: { type: 'string', required: true, enum: DESIGN_BODIES, desc: 'Body plan or preset.' },
    seed: { type: 'integer', default: 1, desc: 'Genome seed.' },
    genome: { type: 'object', desc: 'Genome edits (see creature.genome).' },
    archetype: { type: 'string', enum: DESIGN_ARCHETYPES, desc: 'Behaviour (default: from the body kit).' },
    skills: { type: 'array', items: { type: 'string', enum: DESIGN_SKILLS }, desc: 'Up to three attacks (default: from the body kit).' },
    palette: { type: 'string', default: 'moss', enum: Object.keys(PALETTES), desc: 'Palette.' },
    size: { type: 'number', default: 1, min: 0.6, max: 1.8, desc: 'Overall scale.' },
    save: { type: 'boolean', default: false, desc: 'Save to the bestiary (live game with saves).' },
    release: { type: 'boolean', default: false, desc: 'Release into the depths (implies save).' },
  },
  example: { id: 'thornback', body: 'boar', seed: 7, genome: { spikes: { count: 10 }, horns: { count: 2 } }, archetype: 'charger', skills: ['m_charge', 'm_bite'], palette: 'venom' },
  run(a, ctx) {
    const plan = planOf(a.body);
    const d: SpeciesDesign = {
      id: a.id, name: a.name ?? speciesName(plan, a.seed), body: a.body, seed: a.seed, genome: a.genome as GenomeEdits | undefined,
      archetype: a.archetype ?? PLAN_KIT[plan].archetypes.find((x) => DESIGN_ARCHETYPES.includes(x)) ?? 'skirmisher',
      skills: a.skills ?? PLAN_KIT[plan].skills.slice(0, 2), palette: a.palette, size: a.size, released: a.release || undefined,
    };
    const problems = designProblems(d);
    if (problems.length) throw new Error(problems.join('; '));
    const def = registerDesign(d);
    let saved: string | null = null;
    const saves = ctx.game?.saves;
    if ((a.save || a.release) && saves) {
      const err = saves.saveDesign(d);
      if (err) throw new Error(err);
      setReleased(saves.file.bestiary);
      saved = a.release ? 'saved and released into the depths' : 'saved to the bestiary';
    }
    return { id: def.id, bossId: monsterId(d, true), stats: designStats(d), design: d, saved, next: [`monster.render {"id":"${def.id}"}`, `monster.inspect {"id":"${def.id}","level":20}`] };
  },
});

defineTool({
  name: 'bestiary.list', group: 'creature',
  desc: 'Species in the player\'s Workshop bestiary (live game) and which of them roam the depths.',
  params: {},
  run(_a, ctx) {
    const list = ctx.game?.saves?.file.bestiary ?? [];
    return { released: releasedSpecies(), species: list.map((d) => ({ id: monsterId(d), name: d.name, body: d.body, palette: d.palette, archetype: d.archetype, skills: d.skills, released: !!d.released, stats: designStats(d) })) };
  },
});

defineTool({
  name: 'monster.inspect', group: 'creature',
  desc: 'Stat sheet of a monster at a level, rarity and affixes: life, armour, resistances, speed, xp and the damage of each attack module. Accepts built-in ids, sp:<plan>:<seed> species and custom: ids.',
  params: {
    id: { type: 'string', required: true, desc: 'Monster id (catalog.list monsters), sp:<plan>:<seed>[:boss], or custom:<id>.' },
    level: { type: 'integer', default: 1, min: 1, max: 500, desc: 'Monster level.' },
    rarity: { type: 'string', default: 'normal', enum: RARITIES, desc: 'Rarity tier.' },
    affixes: { type: 'array', items: { type: 'string', enum: Object.keys(MONSTER_AFFIXES) }, default: [], desc: 'Monster affixes.' },
    palette: { type: 'string', enum: Object.keys(PALETTES), desc: 'Palette override (element and resistances).' },
  },
  example: { id: 'sp:scorpion:77:boss', level: 20, rarity: 'unique' },
  async run(a, ctx) {
    const def = ensureMonster(a.id);
    const sim = await probeSim(ctx.clips);
    try {
      const ch = spawnProbeMonster(sim, a.id, a.level, a.rarity as MonsterRarity, a.affixes, a.palette);
      return { ...monsterSheet(sim, ch), archetype: ARCHETYPES[def.archetype], body: def.body, family: def.family };
    } finally {
      sim.dispose();
    }
  },
});

defineTool({
  name: 'encounter.roll', group: 'creature',
  desc: 'Rolls monster packs from a depth\'s encounter pool (species, palettes, magic/rare packs with affixes), as the dungeon generator would.',
  params: {
    stage: { type: 'integer', default: 1, min: 1, max: 10000, desc: 'Campaign depth.' },
    packs: { type: 'integer', default: 6, min: 1, max: 100, desc: 'How many packs.' },
    seed: { type: 'integer', default: 1, desc: 'Roll seed.' },
  },
  run({ stage, packs, seed }) {
    const spec = campaignStage(stage).dungeon;
    const rng = new Rng(seed * 4099 + stage);
    const out = [];
    for (let i = 0; i < packs; i++) {
      const pack = rollPack(rng, spec.pool, spec.monsterLevel, `p${i}`);
      const def = ensureMonster(pack[0].def);
      out.push({ monster: def.name, def: pack[0].def, archetype: def.archetype, palette: pack[0].palette, size: pack.length, rarity: pack.map((m) => m.rarity), affixes: pack.find((m) => m.affixes?.length)?.affixes ?? [] });
    }
    return { stage, monsterLevel: spec.monsterLevel, pool: spec.pool.entries.map((e) => ({ def: e.def, name: ensureMonster(e.def).name, weight: e.weight })), boss: spec.boss, packs: out };
  },
});

// ---------------------------------------------------------------- items and loot

defineTool({
  name: 'item.roll', group: 'item',
  desc: 'Rolls items exactly as drops do (base, rarity, affixes, uniques) and describes them with their value. Use item.icon to see them.',
  params: {
    ilvl: { type: 'integer', default: 10, min: 1, max: 1000, desc: 'Item level (affix tiers and base availability).' },
    rarity: { type: 'string', enum: RARITIES, desc: 'Force a rarity (default: rolled like a drop).' },
    base: { type: 'string', enum: ITEM_BASES.map((b) => b.id), desc: 'Force a base (catalog.list bases).' },
    slot: { type: 'string', enum: SLOTS, desc: 'Force a slot.' },
    count: { type: 'integer', default: 1, min: 1, max: 200, desc: 'How many.' },
    seed: { type: 'integer', default: 1, desc: 'Roll seed.' },
  },
  example: { ilvl: 30, rarity: 'rare', slot: 'weapon', count: 3 },
  run(a) {
    const rng = new Rng(a.seed * 7333 + a.ilvl);
    return Array.from({ length: a.count }, (_, i) => {
      const item = rollItem(rng, { ilvl: a.ilvl, rarity: a.rarity as ItemRarity | undefined, base: a.base, slot: a.slot as SlotKind | undefined, uid: `roll${i}` });
      return { name: item.name, base: item.base, rarity: item.rarity, ilvl: item.ilvl, unique: item.unique ?? null, value: itemValue(item), lines: describeItem(item, SKILL_NAMES).map((l) => l.text), item };
    });
  },
});

defineTool({
  name: 'loot.simulate', group: 'item',
  desc: 'Simulates drops from N monster kills through the real drop code: items by rarity and slot, uniques found, gold, orbs, best items. For tuning drop rates and the loot loop.',
  params: {
    monsterLevel: { type: 'integer', default: 10, min: 1, max: 1000, desc: 'Level of the killed monsters (item level).' },
    kills: { type: 'integer', default: 1000, min: 1, max: 200000, desc: 'How many kills.' },
    rarity: { type: 'string', default: 'mix', enum: [...RARITIES, 'mix'], desc: 'Rarity of every kill; "mix" = 85% normal, 12% magic, 3% rare.' },
    itemRarity: { type: 'number', default: 0, desc: 'Hero increased item rarity, %.' },
    itemQuantity: { type: 'number', default: 0, desc: 'Hero increased item quantity, %.' },
    seed: { type: 'integer', default: 1, desc: 'Seed.' },
  },
  async run(a, ctx) {
    const sim = await probeSim(ctx.clips, autoHero({ level: 1 }), a.seed);
    try {
      const p = sim.player!;
      p.baseMods = [...p.baseMods, { stat: 'itemRarity', kind: 'flat', value: a.itemRarity }, { stat: 'itemQuantity', kind: 'flat', value: a.itemQuantity }];
      p.statsVersion++;
      const target = spawnProbeMonster(sim, 'brigand', a.monsterLevel, 'normal');
      const out = { items: 0, byRarity: { normal: 0, magic: 0, rare: 0, unique: 0 } as Record<string, number>, bySlot: {} as Record<string, number>, uniques: {} as Record<string, number>, gold: 0, lifeOrbs: 0, manaOrbs: 0 };
      const best: Array<{ name: string; rarity: string; value: number }> = [];
      const rng = new Rng(a.seed);
      for (let i = 0; i < a.kills; i++) {
        const r = a.rarity === 'mix' ? (rng.next() < 0.03 ? 'rare' : rng.next() < 0.12 ? 'magic' : 'normal') : a.rarity;
        target.monster!.rarity = r as MonsterRarity;
        target.monster!.xp = 1;
        dropLoot(sim, target);
        for (const q of sim.pickups) {
          if (q.kind === 'gold') out.gold += q.amount;
          else if (q.kind === 'orb') q.orb === 'mana' ? out.manaOrbs++ : out.lifeOrbs++;
          else if (q.item) {
            const it = q.item;
            out.items++;
            out.byRarity[it.rarity]++;
            const slot = BASES[it.base]?.slot ?? '?';
            out.bySlot[slot] = (out.bySlot[slot] ?? 0) + 1;
            if (it.unique) out.uniques[it.name] = (out.uniques[it.name] ?? 0) + 1;
            const v = itemValue(it);
            if (best.length < 5 || v > best[best.length - 1].value) {
              best.push({ name: it.name, rarity: it.rarity, value: v });
              best.sort((x, y) => y.value - x.value);
              best.length = Math.min(best.length, 5);
            }
          }
        }
        sim.pickups = [];
        if (sim.events.length > 1000) sim.events.length = 0;
      }
      return { ...out, perKill: { items: Math.round((out.items / a.kills) * 1000) / 1000, gold: r1(out.gold / a.kills) }, best };
    } finally {
      sim.dispose();
    }
  },
});

// ---------------------------------------------------------------- levels

defineTool({
  name: 'campaign.list', group: 'level',
  desc: 'The campaign depth by depth: title (named after its mechanic), mechanics, theme, layout, monster level and boss. Authored for 1-24, procedural and endless after.',
  params: { from: { type: 'integer', default: 1, min: 1, desc: 'First depth.' }, to: { type: 'integer', default: 30, min: 1, desc: 'Last depth (max 200 per call).' } },
  run({ from, to }) {
    const out = [];
    for (let n = from; n <= Math.min(to, from + 199); n++) {
      const c = campaignStage(n);
      out.push({ depth: n, title: stageTitle(n), authored: n <= AUTHORED.length, mechanics: stageMechanics(n), theme: c.dungeon.theme, layout: c.dungeon.layout, monsterLevel: c.dungeon.monsterLevel, boss: c.dungeon.boss ? ensureMonster(c.dungeon.boss.def).name : null });
    }
    return out;
  },
});

/** Builds a level for a depth, optionally overriding theme / layout / mechanics / seed. */
export function buildStageLevel(a: { stage: number; theme?: string; layout?: string; mechanics?: string[]; seed?: number; intensity?: number; pacts?: string[] }): Level {
  for (const id of a.pacts ?? []) if (!PACT_BY_ID[id]) throw new Error(`unknown pact "${id}". Pacts: ${PACTS.map((p) => p.id).join(', ')}`);
  const c = campaignStage(a.stage);
  const custom = a.theme || a.layout || a.mechanics || a.seed;
  if (!custom) {
    const level = generateDungeon(applyPactsToSpec(c.dungeon, a.pacts));
    c.place?.(level);
    stampPacts(level, a.pacts);
    return level;
  }
  const mechanics = a.mechanics ?? c.mechanics;
  for (const m of mechanics) if (!MECHANICS[m]) throw new Error(`unknown mechanic "${m}". Known: ${MECHANIC_IDS.join(', ')}`);
  const spec = stageSpec(a.stage, {
    theme: a.theme ?? c.dungeon.theme, layout: (a.layout ?? c.dungeon.layout) as 'rooms', mechanics, seedSalt: a.seed ?? 0, boss: c.dungeon.boss,
    title: a.mechanics ? mechanics.map((m) => MECHANICS[m].name).join(' + ') : c.dungeon.title,
  });
  const level = generateDungeon(applyPactsToSpec(spec, a.pacts));
  placeMechanics(level, mechanics, a.intensity ?? 1);
  stampPacts(level, a.pacts);
  return level;
}

export function levelSummary(level: Level) {
  const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
  const monsters = level.characters.filter((c) => c.monster);
  const props = (level.props ?? []).filter((p) => p.kind !== 'torch' && !p.kind.startsWith('decor:'));
  const nav = new NavGrid(level, 0.5);
  let critical = null as number | null;
  if (level.start && level.exit) {
    const path = nav.path(level.start, level.exit);
    if (path.length) {
      let d = 0, prev = { x: level.start.x, z: level.start.z };
      for (const q of path) {
        d += Math.hypot(q.x - prev.x, q.z - prev.z);
        prev = q;
      }
      critical = Math.round(d);
    }
  }
  const boss = monsters.find((c) => ensureMonster(c.monster!.def).boss);
  return {
    title: level.title, subtitle: level.subtitle, theme: level.theme, stage: level.stage ?? null, seed: level.seed ?? null, monsterLevel: level.monsterLevel ?? null,
    mechanics: level.mechanics ?? [], dark: !!level.dark,
    size: level.grid ? [level.grid.cols, level.grid.rows] : [level.width, level.depth],
    floorTiles: level.grid ? [...level.grid.cells].filter((c) => c === '.').length : null,
    rooms: count(level.rooms ?? [], (r) => r.kind),
    monsters: { total: monsters.length, byRarity: count(monsters, (c) => c.monster!.rarity), bySpecies: count(monsters, (c) => ensureMonster(c.monster!.def).name) },
    boss: boss ? { def: boss.monster!.def, name: boss.monster!.name ?? ensureMonster(boss.monster!.def).name } : null,
    props: count(props, (p) => p.kind), lights: level.lights?.length ?? 0, decor: (level.props ?? []).length - props.length,
    start: level.start ?? null, exit: level.exit ?? null, criticalPathMeters: critical,
  };
}

defineTool({
  name: 'level.generate', group: 'level',
  desc: 'Generates a dungeon (a campaign depth, or a custom remix of theme / layout / mechanics / seed) and returns its summary plus a top-down map image: rooms, monsters by rarity, mechanic props, start, exit and the critical path length.',
  params: {
    stage: { type: 'integer', default: 1, min: 1, max: 10000, desc: 'Depth (sets monster level, size, species, boss).' },
    theme: { type: 'string', enum: DUNGEON_THEMES, desc: 'Theme override.' },
    layout: { type: 'string', enum: ['rooms', 'caves', 'halls'], desc: 'Layout override.' },
    mechanics: { type: 'array', items: { type: 'string', enum: MECHANIC_IDS }, desc: 'Mechanics override (combine any).' },
    seed: { type: 'integer', desc: 'Seed salt for a different layout of the same depth.' },
    intensity: { type: 'number', default: 1, min: 0.2, max: 3, desc: 'Mechanic prop density (custom levels).' },
    pacts: { type: 'array', items: { type: 'string', enum: PACTS.map((p) => p.id) }, desc: 'Risk-for-reward pacts (catalog.list pacts).' },
    map: { type: 'boolean', default: true, desc: 'Return the map image.' },
    px: { type: 'integer', default: 4, min: 1, max: 12, desc: 'Map pixels per tile.' },
  },
  example: { stage: 30, mechanics: ['kegs', 'wells', 'lightless'], theme: 'foundry' },
  run(a, ctx) {
    const level = buildStageLevel(a as never);
    const summary = levelSummary(level);
    if (!a.map) return summary;
    const { img, legend } = levelMap(level, a.px);
    return { ...summary, map: ctx.image('map', img), legend };
  },
});

// ---------------------------------------------------------------- passive tree, skills, heroes

defineTool({
  name: 'tree.inspect', group: 'tree',
  desc: 'Explores the passive tree: overall shape (no arguments), one node in detail, or a search over node names and effects.',
  params: {
    node: { type: 'string', desc: 'Node id for details.' },
    search: { type: 'string', desc: 'Case-insensitive text search over names, effects and unlocked skills.' },
    kind: { type: 'string', enum: ['minor', 'notable', 'keystone', 'skill', 'skillmod', 'socket', 'mastery'], desc: 'Only this node kind.' },
    sector: { type: 'string', enum: Object.keys(SECTOR_NAME), desc: 'Only this sector.' },
    limit: { type: 'integer', default: 40, min: 1, max: 600, desc: 'Max nodes returned.' },
  },
  example: { search: 'whirlwind' },
  run(a) {
    const describe = (id: string) => {
      const n = TREE.byId.get(id)!;
      return { id: n.id, name: n.name, kind: n.kind, sector: SECTOR_NAME[n.sector], mods: n.mods.map((m) => describeMod(m, SKILL_NAMES)), skill: n.skill ?? null, desc: n.desc ?? null, repeatable: !!n.repeatable };
    };
    if (a.node) {
      const n = TREE.byId.get(a.node);
      if (!n) throw new Error(`unknown node "${a.node}"`);
      return { ...describe(n.id), links: n.links.map((l) => ({ id: l, name: TREE.byId.get(l)!.name })), costFromStart: pathTo(new Set(), n.id).length, position: { x: r1(n.x), y: r1(n.y) } };
    }
    const f = (a.search as string | undefined)?.toLowerCase();
    let nodes = TREE.nodes.filter((n) => (!a.kind || n.kind === a.kind) && (!a.sector || n.sector === a.sector));
    if (f) nodes = nodes.filter((n) => [n.name, n.desc ?? '', n.skill ?? '', ...n.mods.map((m) => describeMod(m, SKILL_NAMES))].some((t) => t.toLowerCase().includes(f)));
    if (!f && !a.kind && !a.sector) {
      const byKind: Record<string, number> = {}, bySector: Record<string, number> = {};
      for (const n of TREE.nodes) {
        byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
        bySector[SECTOR_NAME[n.sector]] = (bySector[SECTOR_NAME[n.sector]] ?? 0) + 1;
      }
      return {
        nodes: TREE.nodes.length, start: TREE.start, byKind, bySector,
        keystones: TREE.nodes.filter((n) => n.kind === 'keystone').map((n) => describe(n.id)),
        skillUnlocks: TREE.nodes.filter((n) => n.kind === 'skill').map((n) => ({ id: n.id, skill: n.skill, sector: SECTOR_NAME[n.sector], cost: pathTo(new Set(), n.id).length })),
      };
    }
    return { matches: nodes.length, nodes: nodes.slice(0, a.limit).map((n) => describe(n.id)) };
  },
});

defineTool({
  name: 'tree.path', group: 'tree',
  desc: 'Shortest allocation path to a node from an allocated set (default: nothing allocated), with its cost in points.',
  params: { to: { type: 'string', required: true, desc: 'Target node id.' }, allocated: { type: 'array', items: { type: 'string' }, default: [], desc: 'Already allocated node ids.' } },
  run({ to, allocated }) {
    if (!TREE.byId.has(to)) throw new Error(`unknown node "${to}"`);
    const path = pathTo(new Set(allocated as string[]), to);
    return { cost: path.length, path: path.map((id) => ({ id, name: TREE.byId.get(id)!.name, kind: TREE.byId.get(id)!.kind })) };
  },
});

defineTool({
  name: 'tree.render', group: 'tree',
  desc: 'Image of the whole passive tree with an allocation lit up (explicit node ids, or an auto-built hero of a level and focus) and optional highlighted nodes.',
  params: {
    allocated: { type: 'array', items: { type: 'string' }, desc: 'Allocated node ids.' },
    heroLevel: { type: 'integer', min: 1, max: 500, desc: 'Instead of ids: allocate like an auto-built hero of this level.' },
    focus: { type: 'string', default: 'melee', enum: FOCI, desc: 'Auto-build focus.' },
    highlight: { type: 'array', items: { type: 'string' }, default: [], desc: 'Node ids to ring in white.' },
    size: { type: 'integer', default: 512, min: 128, max: 2048, desc: 'Image size, px.' },
  },
  run(a, ctx) {
    const allocated = a.allocated ?? (a.heroLevel ? autoHero({ level: a.heroLevel, focus: a.focus as BuildFocus, gear: 'starter' }).tree : []);
    return { allocated: allocated.length, image: ctx.image('tree', treeImage(allocated, a.highlight, a.size)) };
  },
});

defineTool({
  name: 'hero.build', group: 'hero',
  desc: 'Builds a plausible hero for a level (gear of that item level and rarity, passive points spent toward a focus, hotbar from unlocked skills) and returns its full character sheet with per-skill damage.',
  params: {
    level: { type: 'integer', default: 10, min: 1, max: 500, desc: 'Hero level.' },
    gear: { type: 'string', enum: GEAR, desc: 'Gear rarity (default: starter <4, magic <12, rare after).' },
    focus: { type: 'string', default: 'melee', enum: FOCI, desc: 'Build focus for the tree and weapon.' },
    tree: { type: 'boolean', default: true, desc: 'Spend passive points.' },
    seed: { type: 'integer', default: 1, desc: 'Gear roll seed.' },
  },
  async run(a, ctx) {
    const hero = autoHero({ level: a.level, gear: a.gear, focus: a.focus as BuildFocus, tree: a.tree, seed: a.seed });
    const sim = await probeSim(ctx.clips, hero);
    try {
      return { ...heroSheet(sim), tree: hero.tree };
    } finally {
      sim.dispose();
    }
  },
});

defineTool({
  name: 'skill.inspect', group: 'hero',
  desc: 'A skill\'s definition (timeline effects, motion, cost, cooldown, tags) and its damage for an auto-built hero of a level; without an id, a damage table of every hotbar skill.',
  params: {
    id: { type: 'string', desc: 'Skill id (catalog.list skills).' },
    heroLevel: { type: 'integer', default: 10, min: 1, max: 500, desc: 'Level of the hero used for the estimate.' },
    focus: { type: 'string', default: 'balanced', enum: FOCI, desc: 'Auto-build focus.' },
  },
  async run(a, ctx) {
    const hero = autoHero({ level: a.heroLevel, focus: a.focus as BuildFocus });
    const ids = a.id ? [a.id] : HERO_SKILLS.filter((s) => HOTBAR_SKILLS.includes(s.id) || s.id === 'slash1').map((s) => s.id);
    for (const id of ids) skillDef(id);
    const sim = await probeSim(ctx.clips, hero);
    try {
      const sheet = (id: string) => {
        hero.hotbar = [id, null, null, null, null];
        const row = heroSheet(sim).skills.find((s) => s.id === id)!;
        return row;
      };
      if (!a.id) return { heroLevel: a.heroLevel, focus: a.focus, skills: ids.map((id) => sheet(id)) };
      const s = skillDef(a.id);
      return {
        id: s.id, name: s.name, desc: s.desc, kind: s.kind, tags: s.tags, cost: s.cost ?? 0, cooldown: s.cooldown ?? 0, time: s.time, range: s.range, aim: s.aim,
        base: s.base ?? null, weaponEffectiveness: s.weapon ?? null, motion: s.motion ?? null, iframes: s.iframes ?? null, channel: s.channel ?? null, next: s.next ?? null,
        effects: s.effects.map((e) => ({ at: e.at, type: e.type })), estimate: sheet(s.id),
        unlockedBy: TREE.nodes.filter((n) => n.skill === s.id).map((n) => n.id),
      };
    } finally {
      sim.dispose();
    }
  },
});

// ---------------------------------------------------------------- balance

defineTool({
  name: 'balance.curve', group: 'balance',
  desc: 'Power curves by level: monster life and hit, an auto-built hero\'s life and damage, hits-to-kill and hits-to-die, experience to level and kills per level. Spot where the curve breaks.',
  params: {
    levels: { type: 'array', items: { type: 'integer' }, default: [1, 3, 5, 10, 15, 20, 30, 40, 60, 80, 100], desc: 'Levels to tabulate.' },
    focus: { type: 'string', default: 'melee', enum: FOCI, desc: 'Hero build focus.' },
    monster: { type: 'string', default: 'brigand', desc: 'Reference monster id.' },
  },
  async run(a, ctx) {
    const rows = [];
    for (const L of a.levels as number[]) {
      const hero = autoHero({ level: L, focus: a.focus as BuildFocus });
      const sim = await probeSim(ctx.clips, hero);
      try {
        const sheet = heroSheet(sim);
        const m = spawnProbeMonster(sim, a.monster, L, 'normal');
        const ms = monsterSheet(sim, m);
        const best = sheet.skills.reduce((x, y) => (y.perSecond > x.perSecond ? y : x));
        const monsterHit = Math.max(...ms.skills.map((s) => s.hit));
        rows.push({
          level: L, monsterLife: ms.life, monsterHit: r1(monsterHit), heroLife: sheet.life, heroSlash: sheet.skills[0].hit, heroBestSkill: `${best.name} ${best.perSecond}/s`,
          hitsToKill: Math.ceil(ms.life / Math.max(1, sheet.skills[0].hit)), secondsToKill: r1(ms.life / Math.max(1, best.perSecond)), hitsToDie: Math.ceil(sheet.life / Math.max(1, monsterHit)),
          xpToNext: xpToNext(L), monsterXp: Math.round(monsterXp(L)), killsPerLevel: Math.ceil(xpToNext(L) / Math.max(1, monsterXp(L))),
          curve: { monsterLife: Math.round(monsterLife(L)), monsterDamage: r1(monsterDamage(L)) },
        });
      } finally {
        sim.dispose();
      }
    }
    return { focus: a.focus, monster: a.monster, note: 'Hits ignore armour/resistances/evasion (raw numbers).', rows };
  },
});

/** Runs `fn` with temporary difficulty/tune overrides, restoring afterwards. */
function withTune<T>(difficulty: string | undefined, tune: Record<string, number> | undefined, fn: () => T): T {
  const keys = Object.keys(CONFIG_SPEC).filter((k) => k.startsWith('tune.')) as ConfigKey[];
  const prev = keys.map((k) => [k, config[k]] as const);
  try {
    if (difficulty) applyDifficulty(difficulty);
    for (const [k, v] of Object.entries(tune ?? {})) setConfig(k.startsWith('tune.') ? k : `tune.${k}`, v);
    return fn();
  } finally {
    for (const [k, v] of prev) setConfig(k, v);
  }
}

defineTool({
  name: 'balance.run', group: 'balance',
  desc: 'Bot playtest: an auto-built hero plays a depth headlessly (explores, fights with skills, dodges telegraphs, drinks flasks, loots, uses mechanics, exits). Returns clear rate, time, deaths, kills, xp, gold and damage per run. Runs ~60x faster than real time.',
  params: {
    stage: { type: 'integer', default: 1, min: 1, max: 10000, desc: 'Depth to play.' },
    heroLevel: { type: 'integer', min: 1, max: 500, desc: 'Hero level (default: the depth\'s monster level).' },
    gear: { type: 'string', enum: GEAR, desc: 'Gear rarity (default by level).' },
    focus: { type: 'string', default: 'melee', enum: FOCI, desc: 'Build focus.' },
    strategy: { type: 'string', default: 'clear', enum: ['clear', 'rush'], desc: 'clear = every room (power-levelling), rush = straight to the boss (speedrun).' },
    mechanics: { type: 'boolean', default: true, desc: 'Let the bot exploit level mechanics.' },
    seeds: { type: 'array', items: { type: 'integer' }, default: [1, 2, 3], desc: 'One run per seed (combat RNG and gear rolls).' },
    maxSeconds: { type: 'integer', default: 300, min: 10, max: 3600, desc: 'Give up after this much game time.' },
    difficulty: { type: 'string', enum: Object.keys(DIFFICULTY_PRESETS), desc: 'Difficulty preset for the runs.' },
    tune: { type: 'object', desc: 'tune.* overrides for the runs, e.g. {"enemyDamage":1.5}.' },
    layoutSeed: { type: 'integer', desc: 'Remix the depth\'s layout (default: the campaign layout).' },
    pacts: { type: 'array', items: { type: 'string', enum: PACTS.map((p) => p.id) }, desc: 'Risk-for-reward pacts (catalog.list pacts).' },
  },
  example: { stage: 6, seeds: [1, 2], strategy: 'rush' },
  async run(a, ctx) {
    await probeSim(ctx.clips).then((s) => s.dispose());
    const heroLevel = a.heroLevel ?? stageMonsterLevel(a.stage);
    const runs: Array<BotReport & { seed: number }> = withTune(a.difficulty, a.tune, () => (a.seeds as number[]).map((seed) => {
      const level = buildStageLevel({ stage: a.stage, seed: a.layoutSeed, pacts: a.pacts });
      const hero = autoHero({ level: heroLevel, gear: a.gear, focus: a.focus as BuildFocus, seed });
      const sim = new Sim(level, ctx.clips, seed * 977 + a.stage, { hero });
      try {
        return { seed, ...runBot(sim, { strategy: a.strategy, mechanics: a.mechanics, maxFrames: a.maxSeconds * 60 }) };
      } finally {
        sim.dispose();
      }
    }));
    const avg = (f: (r: BotReport) => number) => r1(runs.reduce((s, r) => s + f(r), 0) / runs.length);
    return {
      stage: a.stage, title: stageTitle(a.stage), heroLevel, focus: a.focus, strategy: a.strategy, difficulty: a.difficulty ?? 'current',
      summary: {
        runs: runs.length, clearRate: avg((r) => (r.cleared ? 1 : 0)), exitRate: avg((r) => (r.exited ? 1 : 0)), seconds: avg((r) => r.seconds), deaths: avg((r) => r.deaths),
        kills: avg((r) => r.kills), mechanicKills: avg((r) => r.mechanicKills), levelsGained: avg((r) => r.heroLevel.end - r.heroLevel.start), lowestLife: avg((r) => r.lowestLife), gold: avg((r) => r.gold),
      },
      runs,
    };
  },
});

defineTool({
  name: 'balance.campaign', group: 'balance',
  desc: 'Plays the campaign with ONE hero from a fresh start (or a given level): the bot clears depth after depth, and between depths the hero equips upgrades it found and spends passive points, like a player. Shows whether progression keeps pace with the monsters: hero level vs monster level, deaths, time, power per depth.',
  params: {
    from: { type: 'integer', default: 1, min: 1, max: 10000, desc: 'First depth.' },
    to: { type: 'integer', default: 8, min: 1, max: 10000, desc: 'Last depth (max 40 per call).' },
    focus: { type: 'string', default: 'melee', enum: FOCI, desc: 'Passive tree focus.' },
    heroLevel: { type: 'integer', min: 1, max: 500, desc: 'Start from an auto-built hero of this level instead of a fresh one.' },
    strategy: { type: 'string', default: 'clear', enum: ['clear', 'rush'], desc: 'Bot strategy.' },
    retries: { type: 'integer', default: 1, min: 0, max: 5, desc: 'Replays of a depth the bot failed to clear (players retry).' },
    maxSeconds: { type: 'integer', default: 480, min: 30, max: 1800, desc: 'Time limit per attempt (a full clear with loot takes 1-5 min).' },
    difficulty: { type: 'string', enum: Object.keys(DIFFICULTY_PRESETS), desc: 'Difficulty preset.' },
    tune: { type: 'object', desc: 'tune.* overrides.' },
    seed: { type: 'integer', default: 1, desc: 'Seed.' },
    pacts: { type: 'array', items: { type: 'string', enum: PACTS.map((p) => p.id) }, desc: 'Risk-for-reward pacts (catalog.list pacts).' },
  },
  example: { from: 1, to: 3 },
  async run(a, ctx) {
    await probeSim(ctx.clips).then((s) => s.dispose());
    const hero = a.heroLevel ? autoHero({ level: a.heroLevel, focus: a.focus as BuildFocus, seed: a.seed }) : newHero('Bot');
    if (!a.heroLevel && a.focus === 'spell') hero.hotbar = ['fireball', 'cleave', null, null, null];
    const rows: Array<Record<string, unknown>> = [];
    withTune(a.difficulty, a.tune, () => {
      for (let n = a.from; n <= Math.min(a.to, a.from + 39); n++) {
        let cleared = false, attempts = 0, seconds = 0, deaths = 0, kills = 0, picked = 0, mk = 0, boss: number | null = null, lowest = 1;
        const startLevel = hero.level;
        while (!cleared && attempts <= a.retries) {
          attempts++;
          const level = buildStageLevel({ stage: n, pacts: a.pacts });
          hero.flasks = [30, 30];
          const sim = new Sim(level, ctx.clips, a.seed * 7919 + n * 31 + attempts, { hero });
          try {
            const r = runBot(sim, { strategy: a.strategy, maxFrames: a.maxSeconds * 60 });
            cleared = r.bossDead;
            seconds += r.seconds;
            deaths += r.deaths;
            kills += r.kills;
            picked += r.itemsPicked;
            mk += r.mechanicKills;
            boss = r.bossSeconds;
            lowest = Math.min(lowest, r.lowestLife);
            if (cleared) {
              const key = String(n);
              if (!(key in hero.progress.cleared)) hero.progress.cleared[key] = r.frames;
              hero.progress.unlocked = Math.max(hero.progress.unlocked, n + 1);
            }
            // Between depths: equip upgrades, spend points (a player in town).
            spendPoints(hero, Math.max(0, treePoints(hero)), a.focus as BuildFocus);
            sim.refreshHero();
            const upgrades = autoEquip(sim);
            sim.refreshHero();
            const sheet = heroSheet(sim);
            if (cleared || attempts > a.retries) {
              const best = sheet.skills.reduce((x, y) => (y.perSecond > x.perSecond ? y : x));
              rows.push({
                depth: n, title: stageTitle(n), monsterLevel: level.monsterLevel, heroLevel: `${startLevel}->${hero.level}`, gap: hero.level - (level.monsterLevel ?? 1),
                cleared, attempts, seconds: r1(seconds), bossSeconds: boss, deaths, lowestLife: lowest, kills, mechanicKills: mk, itemsPicked: picked, upgrades: upgrades.length,
                life: sheet.life, best: `${best.name} ${best.perSecond}/s`, power: Math.round(heroPower(sim)), gold: hero.gold,
              });
            }
          } finally {
            sim.dispose();
          }
          // Sell everything left (gold for the merchant loop), keep inventory clear.
          for (let i = 0; i < hero.inventory.length; i++) {
            const it = hero.inventory[i];
            if (it) {
              hero.gold += Math.max(1, Math.round(itemValue(it) * 0.25));
              hero.inventory[i] = null;
            }
          }
        }
      }
    });
    const failed = rows.filter((r) => !r.cleared).map((r) => r.depth);
    return { focus: a.focus, difficulty: a.difficulty ?? 'current', failedDepths: failed, totalDeaths: rows.reduce((s, r) => s + (r.deaths as number), 0), rows };
  },
});

// ---------------------------------------------------------------- config and difficulty

defineTool({
  name: 'config.get', group: 'config',
  desc: 'Engine and game settings with descriptions and ranges (render.*, anim.*, sim.*, tune.* difficulty).',
  params: { prefix: { type: 'string', desc: 'Only keys starting with this, e.g. "tune."' } },
  run({ prefix }) {
    return describeConfig().filter((c) => !prefix || c.key.startsWith(prefix));
  },
});

defineTool({
  name: 'config.set', group: 'config',
  desc: 'Changes settings live (validated against their ranges). Difficulty keys: tune.playerDamage/Life/Speed, tune.enemyDamage/Life/Speed, tune.xp, tune.loot, tune.density.',
  params: { values: { type: 'object', required: true, desc: 'Key -> value, e.g. {"tune.enemyLife":1.5,"render.outlines":false}.' } },
  run({ values }) {
    return Object.entries(values as Record<string, unknown>).map(([k, v]) => setConfig(k, v));
  },
});

defineTool({
  name: 'difficulty.set', group: 'config',
  desc: 'Applies a difficulty preset (sets every tune.* key), same as the pause-menu buttons.',
  params: { preset: { type: 'string', required: true, enum: Object.keys(DIFFICULTY_PRESETS), desc: 'Preset name.' } },
  run({ preset }) {
    return { preset, values: applyDifficulty(preset) };
  },
});
