# Depthward: game design and the modular design language

Depthward is the engine's showcase: a fast pixel-art hack-and-slash rendered live from 3D. It is
also a worked example of how to build a game out of **small composable data vocabularies** that
humans, procedural generators and AI agents can all extend. This document is the map.

## The loop

Haven (town) → waypoint → depth N (generated dungeon) → kill the boss → portal deeper or home.
Progress is run-based: there is no story, only depth. Monsters drop gold, items, life/mana orbs
and flask charges; experience raises your level; each level and each first boss clear grants a
passive point. Everything scales on one curve (`src/sim/scaling.ts`), so depth 500 works as well
as depth 5.

## The vocabularies (all plain data, all in `src/content/`)

| Vocabulary | File | One entry is… | Read by |
| --- | --- | --- | --- |
| Stats & mods | `stats.ts` | `{ stat, kind: flat/inc/more/flag, value, tags? }` | everything |
| Skills | `skills.ts` | a timeline of effects (strike, projectile, zone, chain, sweep, buff, summon…) plus motion, i-frames, anim windows | hero, monsters, bosses, mechanics |
| Statuses | `statuses.ts` | ailment or buff: mods, DoT, slow, stun, stacking | combat |
| Monsters | `monsters.ts` | body × archetype × attack modules × palette × rarity × affixes | encounters, sim |
| Archetypes | `monsters.ts` | behaviour parameters (keep distance, kite, retreat, strafe, flee, think rate) | `sim/ai.ts` |
| Palettes | `monsters.ts` | element, colors, resistances, name word | monsters, VFX |
| Creature genomes | `procgen/creature.ts` | body plan + seed → spine, limbs, head, tail, spikes, wings, tentacles, pattern | renderer, sim footprint |
| Items | `items.ts`, `affixes.ts`, `uniques.ts` | base (slot, numbers, mesh recipe) + rolled affixes / unique mods | hero build, loot, UI |
| Passive tree | `tree.ts` | generated from tables: minors, notables, keystones, skill clusters, sockets, masteries | hero build, tree UI |
| Themes | `themes.ts` | floor/wall patterns and colors, light rig, torches, decor, breakables | dungeon generator, renderer |
| Levels | `level.ts`, `procgen/dungeon.ts`, `town.ts` | grid + walls + props + lights + spawns | sim, renderer, nav |
| Stages / campaign | `stages.ts`, `campaign.ts` | stage number → dungeon spec (+ mechanics) | game flow |

Rules of the language:

1. **One stat engine.** Item affixes, tree nodes, buffs, shrines, monster affixes and difficulty
   all become mods. A mod applies when its tags are all present in the context, so "+40% damage
   with Fireball" is `{ stat: 'damage', kind: 'inc', value: 40, tags: ['skill:fireball'] }` and no
   code knows about Fireball specifically.
2. **One skill language.** The hero's Fireball, a cultist's bolt and a boss's meteor rain are the
   same data shape. A new monster attack is a table entry; telegraphs come for free (`telegraph:
   true` on a strike, or a zone with a `delay`).
3. **Axes compose.** A monster is body + archetype + skills + palette + rarity + affixes, each
   chosen independently. The endless generator just picks along every axis.
4. **Seeds, not files.** Creature species (`sp:<plan>:<seed>`), dungeons, items and vendor stock
   are deterministic functions of seeds. Nothing generated needs to be stored to be reproduced.
5. **Everything visual is code.** Props, decor, items, weapons and creatures are built from the
   primitives in `src/render/geo.ts`; item icons are rendered by the engine itself
   (`src/render/icons.ts`). An agent can read, edit and re-render any asset.

## Spore-style creatures

`generateGenome(plan, seed)` builds a species from a body plan (quadruped, hexapod, arachnid,
biped, serpent, floater, centipede, blob) and named presets that bias it (wolf, drake, scorpion,
crab, brute, eye…). `render/creature/build.ts` turns the genome into one skinned mesh with a
procedural skeleton (identity rest rotations, joints blended between bones). `render/creature/
view.ts` animates it procedurally from sim state: gait phase from distance travelled, per-plan
leg phase patterns (trot, tripod, wave), spine waves, tail sway, and skill pose hints (bite,
claw, slam, spit, charge, roar, cast, leap, burst). `src/agent/forge.ts` renders sprite sheets
of any species in any pose, the tool used to tune them.

## Combat feel

- Every action is a timeline scrubbed through mocap clips, so attack speed literally speeds up
  the animation. Cancel windows (`cancelAfter`), input buffering (`next`), dodge-cancel from
  almost anything, i-frames on rolls and dashes, ghosting through crowds.
- Local hitstop (the attacker's swing bites for a few frames), global hitstop only on heavy hits,
  screen shake in whole art pixels, slash arcs, sparks colored by damage type, damage numbers in
  a pixel font, telegraph decals that fill before a boss slam lands.
- Stagger: small monsters flinch from every hit; brutes and bosses accumulate poise.

## Dynamic lighting

A fixed pool of 16 point lights (`render/lights.ts`) is reassigned every frame to the most
important requests near the camera: torches (flickering), braziers, fireballs, explosions,
loot beams, portals, elite auras and the hero's lantern (stronger in dark themes). Toon
materials quantize the falloff into crisp bands.

## Difficulty and tuning

`tune.*` config keys (pause menu → Difficulty & tuning): hero damage/life/speed, enemy
damage/life/speed, experience, loot quantity, monster density. They apply live (monster pools
are rescaled) and are saved with the game. Presets: Story, Normal, Hard, Nightmare.

## Extending

- **New skill:** add a `SkillDef` in `skills.ts`; for hero skills add a skill cluster in
  `tree.ts` and an icon recipe in `ui/skillIcons.ts`.
- **New monster:** add a `MonsterDef` (or just use `sp:<preset>:<seed>`); pick an archetype and
  attack modules. Humanoid bodies need a preset in `characters.ts` with palette `slots`.
- **New body plan:** add ranges in `generateGenome`, a gait pattern in `build.ts`, and a kit in
  `PLAN_KIT`.
- **New prop or mechanic:** `registerProp(kind, spec, behaviour)` in a sim module and a mesh
  recipe in `render/propMeshes.ts`.
- **New theme:** one entry in `themes.ts`.
