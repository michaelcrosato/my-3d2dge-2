# Depthward (my-3d2dge-2)

**Depthward** is a fast pixel-art hack-and-slash built on this engine: live-rendered 3D characters and procedural creatures that read as pixel-art sprites. The stack is TypeScript, Three.js r186, Rapier 0.20 physics and Vite. It is the engine's showcase game and a worked example of building a game from small, composable data vocabularies (see [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md)).

- **Combat:** a three-hit sword combo you can hold down, dodge rolls with i-frames, 17 active skills (melee, movement, spells, minions), telegraphed boss attacks, ailments (ignite, chill, freeze, shock, poison, bleed), stagger, knockback, hitstop and screen shake.
- **Progression:** XP and levels, gold, and loot with normal, magic, rare and unique rarities. Affixes keep scaling with item level, and flasks refill from kills. The merchant buys, sells and gambles, and the blacksmith upgrades, reforges, augments, tempers, hones and salvages.
- **Passive tree:** about 550 nodes in six attribute sectors. It has notables, 18 keystones, skill nodes with enhancements, jewel sockets and repeatable masteries for endless points.
- **Monsters:**
  - Humanoid families with recolor palettes.
  - Spore-style procedural creatures: eight body plans, endless seeds and procedural animation.
  - Behaviour archetypes, elite affixes, champion and rare packs, and bosses with phases and enrage.
- **Level mechanics:** each depth is named after one trick (Blast Kegs, Spike Traps, Shrines, Launch Pads, Black Ice, Lightless, Rolling Boulders, Rift Gates, Fire Vents, Totems, Gravity Wells, Chrono Fields, Loot Imps). You can ignore them and fight, or exploit them for +50% XP trick kills and speedrun routes. Depths 14–24 combine them, and past that the endless generator mixes mechanics, themes, palettes and species forever.
- **World:** procedural dungeons with themes, iso-aware walls with a hero cutaway, torches and dynamic lights, breakables and chests. Haven is the town hub with animated NPCs, and there is no bottom to the depths.
- **Difficulty:** pause menu → Difficulty & tuning has hero and enemy damage, life and speed, plus XP, loot and density multipliers.

The application lives at the repository root. Run application commands from the root. Node.js 22.12+ (Node 22 recommended) and npm are required.

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open http://localhost:5173. On the title screen pick a save slot (three slots, saved in the browser).

## Controls

| | Keyboard & mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrows (Shift sprints) | left stick | stick |
| Attack (hold to keep swinging, aims at the cursor) | left click / J | X | Attack |
| Skills 1–5 | right click, Q, R, F, X (or 1–5) | Y, RB, RT, LB, LT | skill buttons |
| Dodge roll | Space | B | Roll |
| Interact, pick up, talk | E, or click a loot label or NPC | A | Use, or tap |
| Life / mana flask | Z / V | D-pad ↓ / ↑ | flask buttons |
| Inventory, passive tree, character | I, P, C | View, D-pad →, D-pad ← | Bag, Tree, Char |
| Town portal | T | R3 | — |
| Pause menu | Esc | Menu | ☰ |

The right stick aims on gamepads. Engine debug toggles have moved to function keys: F2 switches pixel and plain 3D, F3 shows stats, F6 toggles outlines, F7 cycles palettes, F8 shows colliders. Every binding is rebindable in Settings (⚙). Settings also holds the profiles, graphics, gamepad options and the touch layout editors (portrait and landscape are separate).

## Settings and controls

The ⚙ button opens Settings. Everything is stored per **profile**; Standard, Left-handed, Performance and Smooth 3D profiles are built in, and profiles can be created, duplicated, renamed, deleted, exported to JSON and imported. Changes apply immediately and are saved in local storage when available. `?agent` mode ignores saved settings, saves and human input so automated runs start from the documented defaults.

## Commands

| Command (from the repository root) | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript validation |
| `npm run test` | Vitest unit tests (stats, items, tree, dungeon generation, combat and rewards, determinism, species, saves, Rapier queries, input profiles) |
| `npm run check` | TypeScript validation, production build and unit tests; also runs in CI |
| `npm run build` | Build the web app into `dist/` |
| `npm run build:standalone` | Rebuild the committed single-file game |
| `npm run verify:standalone` | Play the offline game in Chromium, WebKit and Firefox on a touch phone (title → town → combat → settings rebind → panels → depth 1); requires Python Playwright and installed browsers |
| `npm run assets` | Download source packs and rebuild runtime assets (requires network) |

## Layout

- `src/sim/`: deterministic simulation (Rapier physics, character state machine, skills, combat, AI, monster affixes, loot, props, hero build and operations, navigation and flow fields, seeded RNG, scaling curves).
- `src/content/`: data vocabularies (stats, skills, statuses, monsters, items, affixes, uniques, passive tree, themes, town, stages) and procedural generators (dungeons, encounters, creature genomes).
- `src/render/`: stage, pixel pipeline, overlay (pixel font, damage numbers, labels, minimap), light pool, VFX, procedural props/items/creatures, engine-rendered icons.
- `src/ui/`: HUD, panels, passive tree view, menus, settings, touch overlay.
- `src/input/`: actions, settings profiles and storage, input math and the keyboard/mouse/gamepad/touch controller.
- `src/agent/`: capture helpers and the asset forge (creature sprite sheets, rig inspection).
- `src/game.ts`, `src/main.ts`, `src/save.ts`, `src/config.ts`: run flow, boot, saves and configuration.
- `tests/`, `public/assets/`, `tools/`, `standalone/`: unit tests, runtime assets, build tools, the shareable HTML game.

## Agents

Open `/?agent&seed=1` (training room), `/?agent&town` or `/?agent&stage=N` (a fresh hero in town or at depth N), wait for `window.agent.ready`, and call `window.agent.step(frames)`; after steps that may change level (portals), `await window.agent.idle()`. `window.game` exposes the game: `game.sim` (characters, events, `setInput`, `snapshot()`), `game.hero`, `game.enterStage(n)`, `game.enterTown()`. Agent mode starts paused with human input disabled. `src/agent/forge.ts` renders creature sprite sheets for any plan/seed/palette. See [AGENTS.md](AGENTS.md).

The standalone HTML embeds runtime libraries and assets; see [standalone instructions](standalone/README.md). Keep it in sync after runtime or asset changes.

## Contributing with agents

Read [AGENTS.md](AGENTS.md) first and follow the [agent coding SOP](docs/AGENTIC-CODING-SOP.md) and the [design language](docs/GAME-DESIGN.md). CI checks pushes and pull requests on `main`.

Quaternius models and animations carry the included [CC0 asset notice](public/assets/LICENSE-quaternius.txt). All other assets (creatures, props, items, icons, textures, effects) are generated by code in this repository. This repository does not declare a separate license for its application source.
