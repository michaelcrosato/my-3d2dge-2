# Depthward (my-3d2dge-2)

**Depthward** is a fast pixel-art hack-and-slash built on this engine: live-rendered 3D characters and procedural creatures that read as pixel-art sprites. The stack is TypeScript, Three.js r186, Rapier 0.20 physics and Vite. It is the engine's showcase game and a worked example of building a game from small, composable data vocabularies (see [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md)).

- **Combat:** a three-hit sword combo you can hold down, dodge rolls with i-frames, 17 active skills (melee, movement, spells, minions), telegraphed boss attacks, ailments (ignite, chill, freeze, shock, poison, bleed), stagger, knockback, hitstop and screen shake.
- **Progression:** XP and levels, gold, and loot with normal, magic, rare and unique rarities. Green ▲ arrows mark bag items that would make you stronger, judged on damage and survival together. First-steps hints teach the game as you go: the waypoint, attack and roll, passive points, upgrades, flasks, bosses and town services. Each shows once per hero, names the control for your device, and can be turned off. Settings → Gameplay also has a loot filter (hide labels below magic or rare), a damage-number toggle and screen-shake strength. Shake starts at 0 when the system asks for reduced motion. Gamepads rumble on heavy hits, crits, getting hurt and nearby explosions. Affixes keep scaling with item level, and flasks refill from kills. The merchant buys, sells and gambles, and the blacksmith upgrades, reforges, augments, tempers, hones and salvages.
- **Passive tree:** about 550 nodes in six attribute sectors. It has notables, 18 keystones, skill nodes with enhancements, jewel sockets and repeatable masteries for endless points.
- **Creature Workshop:** a Spore-style editor (Sela the Beastwright in town, or the title screen). Pick a body plan and reshape it: proportions, legs, arms and pincers, head, eyes, horns, tail and tip, spikes, plates, wings and tentacles. Then colour it and give it a behaviour and up to three attacks, with a live pixel-art preview. Life, damage and speed come from the parts under a threat budget. Save species to the bestiary, test-fight them in the Proving Grounds, and release them into the depths, where they join the encounter pools.
- **Monsters:**
  - Humanoid families with recolor palettes.
  - Spore-style procedural creatures: eight body plans, endless seeds and procedural animation.
  - Behaviour archetypes, elite affixes, champion and rare packs, and bosses with phases and enrage.
- **Level mechanics:** each depth is named after one trick (Blast Kegs, Spike Traps, Shrines, Launch Pads, Black Ice, Lightless, Rolling Boulders, Rift Gates, Fire Vents, Totems, Gravity Wells, Chrono Fields, Loot Imps). You can ignore them and fight, or exploit them for +50% XP trick kills and speedrun routes. Depths 14–24 combine them, and past that the endless generator mixes mechanics, themes, palettes and species forever.
- **World:** procedural dungeons with themes, iso-aware walls with a hero cutaway, torches and dynamic lights, breakables and chests. Haven is the town hub with animated NPCs, and there is no bottom to the depths.
- **Sound:** every sound is synthesized live from data (no audio files): swings, element-flavoured hits, crits, kills, loot chimes by rarity, level-ups, mechanic sounds, a drone per dungeon theme, and generative music: a calm town tune, dark phrases in the dungeons, and a driving pulse when a boss engages. Sounds are placed and panned relative to the hero, and volumes live in Settings → Graphics & audio.
- **Pinnacle bosses:** every tenth depth ends in a named three-phase boss (the Hollow King, Mother of Cinders, the Glass Choir, Vael Unbound, Grull the Mountain, the Brood Tyrant). Each mixes attack kits and calls adds at every phase change, and it always drops a unique plus rares.
- **Codex:** Character → Codex records every species you slay, with engine-rendered portraits, every unique found and every pinnacle defeated.
- **Daily Trial:** one seeded challenge per day at the waypoint. Everyone gets the same mechanics and pacts, at a depth set to their own progress. It keeps your best clear time for speedrunners and pays a hoard on the first clear of the day.
- **Pacts:** optional risk-for-reward modifiers at the waypoint, unlocked as you go deeper: Brutal, Stalwart, Teeming, Swift, Champions, Volatile, Bloodthirsty, Eclipse. Each makes the depths harder in one readable way and pays in experience, item rarity, quantity or gold. They stack for power-levellers, and casual players can ignore them.
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
| Full map (explored area, portals, chests, shrines) | Tab, or click the minimap | Menu → Map (or bind a button) | tap the minimap |
| Pause menu | Esc | Menu | ☰ |

The right stick aims on gamepads. Engine debug toggles have moved to function keys: F2 switches pixel and plain 3D, F3 shows stats, F6 toggles outlines, F7 cycles palettes, F8 shows colliders. Every binding is rebindable in Settings (⚙). Settings also holds the profiles, graphics, gamepad options and the touch layout editors (portrait and landscape are separate).

## Settings and controls

The ⚙ button opens Settings. Everything is stored per **profile**; Standard, Left-handed, Performance and Smooth 3D profiles are built in, and profiles can be created, duplicated, renamed, deleted, exported to JSON and imported. Changes apply immediately and are saved in local storage when available. `?agent` mode ignores saved settings, saves and human input so automated runs start from the documented defaults.

## Commands

| Command (from the repository root) | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript validation |
| `npm run test` | Vitest unit tests (stats, items, tree, dungeon generation, combat and rewards, determinism, species, saves, mechanics, agent tools and the bot, Rapier queries, input profiles) |
| `npm run check` | TypeScript validation, production build and unit tests; also runs in CI |
| `npm run build` | Build the web app into `dist/` |
| `npm run build:standalone` | Rebuild the committed single-file game |
| `npm run verify:standalone` | Play the offline game in Chromium, WebKit and Firefox on a touch phone (title → town → combat → settings rebind → panels → depth 1); requires Python Playwright and installed browsers |
| `npm run agent -- <tool> [args]` | Call an agent tool from the terminal (`help` lists them) |
| `npm run mcp` | Stdio MCP server exposing the agent tools |
| `npm run assets` | Download source packs and rebuild runtime assets (requires network) |
| `node tools/pack-assets.mjs` | Pack the committed GLBs losslessly in place (meshopt buffers, WebP textures; decoded bit-identical by `GLTFLoader`) |

## Layout

- `src/sim/`: deterministic simulation (Rapier physics, character state machine, skills, combat, AI, monster affixes, loot, props, hero build and operations, navigation and flow fields, seeded RNG, scaling curves).
- `src/content/`: data vocabularies (stats, skills, statuses, monsters, items, affixes, uniques, passive tree, themes, town, stages) and procedural generators (dungeons, encounters, creature genomes).
- `src/render/`: stage, pixel pipeline, overlay (pixel font, damage numbers, labels, minimap and full map), light pool, VFX, procedural props/items/creatures, engine-rendered icons.
- `src/ui/`: HUD, panels, passive tree view, menus, settings, touch overlay.
- `src/input/`: actions, settings profiles and storage, input math and the keyboard/mouse/gamepad/touch controller.
- `src/agent/`: the agent tool registry and tools, capture helpers, the asset forge (creature sprite sheets, rig inspection), software-drawn maps.
- `src/game.ts`, `src/main.ts`, `src/save.ts`, `src/config.ts`: run flow, boot, saves and configuration.
- `tests/`, `public/assets/`, `tools/`, `standalone/`: unit tests, runtime assets, build tools, the shareable HTML game.

## Agent tools

The engine ships its own tools for AI agents: 42 typed, documented tools for building, generating, rendering and inspecting the game's assets and systems. They live in `src/agent/` and run in three places:

- **Browser console:** `await agent.call('help')`, `await agent.call('creature.render', { plan: 'spider', seed: 9 })`, `agent.tools()` (names, descriptions, JSON Schemas). Present in every mode.
- **Terminal:** `npm run agent -- help`, `npm run agent -- level.generate stage=30 'mechanics=["kegs","ice"]'`, `npm run agent -- --script steps.json`, `npm run agent -- repl`. Images are written to `.agent/out/` (git-ignored) and their paths are printed.
- **MCP:** `npm run mcp` is a stdio MCP server (no extra dependencies); `.mcp.json` registers it for Claude Code in this repository. Tool names use underscores (`creature_render`), and images come back as image content.
- **WebMCP:** in browsers that offer `navigator.modelContext`, the page registers 40 of the tools for the browser's own AI agent (feature-detected; nothing changes elsewhere). Agents discover the project through `/llms.txt` and `/.well-known/ai-catalog.json`, and Lighthouse's agentic-browsing audit scores 100.

The CLI and the MCP server start Vite in-process and drive headless Chromium (`--url URL` targets a running server, `--standalone` the single-file build).

| Group | Tools |
| --- | --- |
| meta, catalog | `help`, `catalog.list` (skills, monsters, archetypes, palettes, affixes, body plans, bases, uniques, mechanics, themes, statuses, stats, presets) |
| creature | `creature.genome`, `species.design` (Workshop rules: stats from parts, threat budget; save and release into the depths), `species.create` (free-form monster from parts), `bestiary.list`, `monster.inspect`, `encounter.roll` |
| item | `item.roll`, `loot.simulate` (thousands of kills through the real drop code) |
| level | `campaign.list`, `level.generate` (any depth or a remix of theme / layout / mechanics, with a map image and critical path) |
| tree, hero | `tree.inspect`, `tree.path`, `tree.render`, `hero.build` (auto-built hero of any level), `skill.inspect` |
| balance | `balance.curve` (power curves by level), `balance.run` (the autoplayer bot plays a depth headless at ~60x speed: clear rate, time, deaths), `balance.campaign` (one hero plays depth after depth, equipping drops and spending points: the progression curve) |
| config, audio | `config.get`, `config.set`, `difficulty.set`, `audio.list`, `audio.inspect` (renders a sound or bars of music offline: waveform + spectrogram image, loudness, brightness) |
| render (live) | `creature.render`, `creature.lineup`, `monster.render`, `item.icon`, `scene.capture` (exact pixels, HUD, labelled boxes, full map), `scene.stats`, `logs.read` |
| world (live) | `game.state`, `game.goto`, `game.step`, `game.input`, `hero.set`, `hero.sheet`, `hero.give`, `monster.spawn`, `bot.play`, `bot.autopilot` |

Content tools also run under Vitest without a browser (`tests/agent-tools.test.ts`). The autoplayer (`src/sim/bot.ts`) is deterministic and doubles as the pause menu's **Autopilot** (watch the bot play).

Lower level: open `/?agent&seed=1` (training room), `/?agent&town` or `/?agent&stage=N`, wait for `window.agent.ready`, and call `window.agent.step(frames)`; after steps that may change level, `await window.agent.idle()`. `window.game` exposes the game (`game.sim`, `game.hero`, `game.enterStage(n)`, `game.enterTown()`). Agent mode starts paused with human input disabled. See [AGENTS.md](AGENTS.md).

The standalone HTML embeds runtime libraries and assets; see [standalone instructions](standalone/README.md). Keep it in sync after runtime or asset changes.

## Contributing with agents

Read [AGENTS.md](AGENTS.md) first and follow the [agent coding SOP](docs/AGENTIC-CODING-SOP.md) and the [design language](docs/GAME-DESIGN.md). CI checks pushes and pull requests on `main`.

Quaternius models and animations carry the included [CC0 asset notice](public/assets/LICENSE-quaternius.txt). All other assets (creatures, props, items, icons, textures, effects) are generated by code in this repository. This repository does not declare a separate license for its application source.
