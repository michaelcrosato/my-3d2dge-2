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

## Level mechanics and the campaign

Every depth is named after its trick (`src/content/mechanics.ts` for placement and tips,
`src/sim/mechanics.ts` for behaviour, `src/render/propMeshes.ts` for visuals). Each can be
ignored by a player who just fights, and each rewards exploitation: kills by mechanics give +50%
experience and count as "trick kills" in the stage summary, and several open speedrun routes.

| Depth | Mechanic | Exploit |
| --- | --- | --- |
| 1 | Blast Kegs | chain-detonate kegs into packs |
| 2 | Spike Traps | knock monsters onto rising plates |
| 3 | Shrines | chain 20 s buffs (frenzy, power, haste, fortune, conduit, fortify) |
| 4 | Launch Pads | fly over walls toward the boss; landings are shockwaves |
| 5 | Black Ice | knockback sends monsters sliding; keep momentum |
| 6 | Lightless | light beacons to strip monsters' shroud |
| 7 | Rolling Boulders | hit boulders to bowl them through packs |
| 8 | Rift Gates | a gate pair always leads from the entrance to near the boss |
| 9 | Fire Vents | pull monsters over vents before they erupt |
| 10 | Totems | break totems first; their power flows to you |
| 11 | Gravity Wells | let wells bunch packs, then AoE |
| 12 | Chrono Fields | fight from the edge while monsters wade through slowed |
| 13 | Loot Imps | catch the fleeing imps before they escape for a hoard |

Depths 14–24 combine them (Kegs on Ice, Spikes in the Dark, Boulder Pads, Vented Wells, Totems
of Time, Shrine Rush, Powder and Gravity, The Gauntlet, Dark Rifts, Frozen Time, Imp Gauntlet).
From depth 25 the endless generator draws two or three mechanics, a theme biased toward them,
monster palettes and procedural species from the stage seed, and names the level from the
mechanics' words ("Frozen Kegs & Wells"). A new mechanic is one `MechanicDef` plus prop kinds.

## Spore-style creatures

`generateGenome(plan, seed)` builds a species from a body plan (quadruped, hexapod, arachnid,
biped, serpent, floater, centipede, blob) and named presets that bias it (wolf, drake, scorpion,
crab, brute, eye…). `render/creature/build.ts` turns the genome into one skinned mesh with a
procedural skeleton (identity rest rotations, joints blended between bones). `render/creature/
view.ts` animates it procedurally from sim state: gait phase from distance travelled, per-plan
leg phase patterns (trot, tripod, wave), spine waves, tail sway, and skill pose hints (bite,
claw, slam, spit, charge, roar, cast, leap, burst). `src/agent/forge.ts` renders sprite sheets
of any species in any pose, the tool used to tune them. `GenomeEdits` layer hand edits over a
generated genome (three leg pairs, four horns, no wings, longer tail; counts and sizes clamped to
what the rig supports), carried by `MonsterBody.genome` into the sim's `Look` and the renderer,
so a custom species (`species.create`) is a few lines of data.

## The Workshop and the bestiary

Spore's lesson is that players care about creatures they made. The Workshop (`src/ui/workshop.ts`)
edits a `SpeciesDesign` (`src/content/bestiary.ts`): body plan or preset, seed, `GenomeEdits`,
palette, archetype and up to three attack modules, previewed live by `CreatureStudio` through the
game's own rig and pixel pipeline. Numbers come from the parts: bulk gives life and costs speed,
horns, spikes, tail weapons and pincers give damage, legs and wings give speed, and a threat budget
scales life and damage back so no design breaks the game. A design registers `custom:<id>` and a
boss variant (`custom:<id>-boss`, larger, with the plan's boss modules). Saved designs live in the
save file's `bestiary`. The Proving Grounds (`Game.enterArena`) is a small dungeon of one species
and its matriarch at the hero's level. Released designs join the encounter pools from depth 2,
chosen deterministically per depth, so the endless dungeon fills with the player's creations.

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

## Pinnacle bosses

`src/content/pinnacles.ts` assembles six named bosses from the usual parts (humanoid presets or
creature genomes with edits, palettes, attack kits, add types). Every tenth depth ends in one,
cycling past the list. Boss phases are general: `phases` splits the life bar evenly, each phase
change resets cooldowns and calls `adds` minions (magic in the final phase), and pinnacles drop
a guaranteed unique plus rares (`dropPinnacle`). Bot fights run 22-60 s at depths 10-30.

## Pacts (endgame risk for reward)

`src/content/pacts.ts` defines modifiers chosen at the waypoint, in the spirit of Nightmare Sigils
and map mods. Each pairs one readable risk (more damage, life, speed, packs or elites, an affix on
every monster, darkness) with rewards (experience, rarity, quantity, gold). They act at three
layers: the dungeon spec before generation (`applyPactsToSpec`), the generated level
(`stampPacts`, which can add the Lightless mechanic), and the sim via `level.pacts` (monster mods
and damage, hero loot stats). Bot check at depth 10: three pacts gave +26% experience and +34% items
with no deaths; all eight gave 2.4x experience and 2.3x items at real risk.

## Sound

Sounds are data too (`src/content/sounds.ts`): each is a few synthesized layers (oscillator or
noise, pitch sweep, filter sweep, percussive envelope) with pitch variation, voice limits and a
minimum gap, so a whirlwind through a pack stays crisp. `soundFor` maps game events to cues:
swings, element-flavoured hits, crits, kills, loot chimes that rise with rarity, level-ups and one
sound per mechanic. `THEME_AMBIENCE` gives each theme a drone. `src/audio/engine.ts` plays them
with WebAudio, quieter with distance and panned along the screen axis, behind a soft compressor.
Music is generative (`src/content/music.ts`): a mood is a tempo, a mode, a root, a chord
progression and voices (bass, pad, melody, optional pulse). `composeBar` draws each bar's notes
from a seeded RNG, so the score stays in key but never loops audibly. The engine follows the game
(town, one mood per theme family, boss when a boss is engaged nearby) and crossfades. Agents
inspect sounds and music as images with `audio.inspect` (waveform + spectrogram).

## Difficulty and tuning

`tune.*` config keys (pause menu → Difficulty & tuning): hero damage/life/speed, enemy
damage/life/speed, experience, loot quantity, monster density. They apply live (monster pools
are rescaled) and are saved with the game. Presets: Story, Normal, Hard, Nightmare.

The curves (`src/sim/scaling.ts`) are tuned with the agent tools, not by feel. `balance.campaign`
lets one bot hero play depth after depth (equipping upgrades and spending points between depths)
and reports level gap, deaths, clear time and boss-fight length; `balance.curve` and
`balance.run` probe single levels and depths. What the measurements led to:

- **Monster life ramp** (`lifeRamp`): weapons and monster life share the power curve, but the
  hero also stacks percentage increases (tree, strength, gear, speed, crit) that grow about
  linearly with level. Without the ramp, hero damage outgrew monster life ~30x by level 85.
- **Early bosses** (`bossEase`, `bossLifeEase`): the first bosses start at 60% damage and 45%
  life, reaching full strength by levels 13 and 5.
- **Experience catch-up** (`xpCatchUp`): monsters above the hero give up to +96% experience,
  so a hero who falls behind (or pushes deeper) closes the gap.
- **Mechanics never trap**: field pulls are capped at 60% of a character's run speed, bosses
  are too heavy for launch pads, and totems mend bosses only slowly.

Baseline (bot, Normal, 40 depths): both melee and spell builds clear every depth; boss fights
have a median of 12-34 s; the hero stays within -2..+4 levels of the monsters; melee dies about
once per depth past depth 20, ranged rarely. `tests/agent-tools.test.ts` guards the opening.

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
- **New agent tool:** `defineTool({ name, group, desc, params, example, run })` in
  `src/agent/tools/`; it appears in `window.agent`, the CLI and the MCP server at once.

## Agent tools: building and judging assets

The engine treats AI agents as first-class developers. `src/agent/registry.ts` holds typed tools
(validated parameters, defaults, examples, JSON Schema) and every tool is reachable from the
browser console (`agent.call`), the terminal (`npm run agent`) and MCP (`npm run mcp`).

- **See what you made.** Creatures, monsters (palette-tinted humanoids or genome creatures) and
  item icons render through the game's own pixel pipeline as sprite sheets and contact sheets;
  levels and the passive tree are drawn as software maps; `scene.capture` returns exact low-res
  pixels with the HUD or labelled boxes for vision models.
- **Make new things from parts.** `species.create` assembles a monster from a body plan plus
  genome edits (legs, horns, wings, spikes, proportions), an archetype, attack modules and a
  palette; `level.generate` remixes any depth with any mechanics; `item.roll` rolls any base.
- **Measure, don't guess.** `monster.inspect` and `hero.build` produce stat sheets with damage
  per skill, `balance.curve` tabulates hits-to-kill and hits-to-die by level, `loot.simulate`
  runs thousands of kills through the drop code, and `balance.run` lets the deterministic
  autoplayer (`src/sim/bot.ts`) play a depth with an auto-built hero (`src/sim/autobuild.ts`):
  clear rate, time, deaths, xp and gold, per strategy (`clear` for power-levelling, `rush` for
  speedrunning) and per difficulty.
- **Drive the live game.** Travel, step exact frames, press inputs, spawn monsters, rebuild the
  hero, let the bot play, read logs. Live calls mutate the session deliberately; inspection
  tools use throwaway probe simulations and never touch the game's RNG.
