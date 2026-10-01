# Emberdeep agent contract · Version 1

The game is a headless deterministic combat kernel with a replaceable 3D view. Agents use data and commands. UI selectors, keystrokes, screenshots, and mesh coordinates are not required to play or extend it.

## Start and drive the game

Use `npm ci`, then `npm run dev`. Open `/?agent&seed=32`. Wait for `window.agent.ready`. This mode ignores local saves, attaches no human input, starts no audio, and advances only when an agent requests frames. Three.js is pinned to 0.186.1 (r186); Rapier is pinned to 0.20.0.

```js
agent.schema();
agent.content();
agent.act({ type: 'enter', depth: 1 });
agent.act({ type: 'input', value: { x: 0, z: -1, attack: true, dash: true } });
agent.step(60);
const state = agent.observe();
const events = agent.events(state.eventSeq - 20);
```

Positions use meters. X points east, Y points up, and Z points south. Input uses world X/Z axes. Each step is 1/60 second. Inputs persist until replaced. Attack is held. Dash, potion, interact, and skill are consumed once on the next frame. Aim is an optional world point `{x,z}`. Both movement axes are required and must be finite. Movement is normalized to length 1.

`act` returns `{ok,tick,hash}` or `{ok:false,error,tick}`. A command does not advance time. `step` returns a complete observation and renders the final state. `observe` and `events` return copies. The renderer reads the kernel; rendering never changes combat outcomes.

| Command | Fields | Behavior |
| --- | --- | --- |
| `input` | `value: {x,z,aim?,attack?,dash?,potion?,interact?,skill?}` | Set held movement and combat triggers |
| `enter` | `depth` | Enter a chosen depth, retaining progression |
| `town` | — | Return to Cinderhaven |
| `interact` | — | Use a nearby NPC or a cleared exit |
| `learn` | `id` | Spend a point on a valid skill node |
| `keystone` | `id` | Select a keystone after 10 points in its path |
| `master` | `skill` | Spend a point on repeatable skill damage mastery |
| `slot` | `index: 0..3, skill` | Assign an unlocked ability |
| `equip` / `salvage` | `id` | Equip or sell an inventory item |
| `service` | `id: smith, merchant, mystic` | Use a town service |
| `refund` | — | Refund tree and mastery points in town |
| `camera` | `mode: iso, side, top` | Select a camera |
| `tune` | `values` | Set one or more tuning values from 0.2 to 4 |
| `auto` / `invulnerable` | `value: boolean` | Enable playtest automation or protection |

Tuning keys are `playerDamage`, `playerHealth`, `playerSpeed`, `enemyDamage`, `enemyHealth`, `enemySpeed`, and `density`. Health changes preserve current health fractions. Density applies on the next level load. Tuning validation is atomic.

## Checkpoints, saves, and replays

`checkpoint()` returns JSON-compatible kernel state, a Rapier snapshot as a byte array, RNG state, actor timers, queued attacks, projectiles, drops, cooldowns, buffs, inputs, and events. `restore(cp)` restores it without losing progress. It also starts a new replay recording with that checkpoint as its baseline.

`save()` exports the progression profile only. `load(profile)` validates and loads the profile, returns to town, and starts a new replay baseline. Normal showcase mode saves the profile in local storage. Agent mode never reads or writes local storage.

```js
const checkpoint = JSON.parse(JSON.stringify(agent.checkpoint()));
agent.step(120);
const expected = agent.observe().hash;
agent.restore(checkpoint);
agent.step(120);
if (agent.observe().hash !== expected) throw new Error('Restore diverged');
const tape = JSON.parse(JSON.stringify(agent.exportReplay()));
const result = agent.replay(tape);
if (!result.matches) throw new Error('Replay diverged');
```

Replay runs a separate kernel and frees it when done. The current game does not change. Use the command API for recorded mutations. Direct changes through `window.game.run` and human controls are debug access and are not recorded.

Replay hashes are exact within the tested browser engine and dependency build. JavaScript trigonometry can yield small cross-browser differences; the engine does not claim identical whole-game hashes between browser engines. Keep the browser version, dependency lockfile, seed, baseline, and command tape together for exact comparison.

## Limits and extension points

The procedural generator is stateless for each seed/depth. Twelve authored depths introduce one named mechanic each. Later depths combine mechanics, archetypes, bosses, elites, layouts, and palettes. It accepts depths 0 through 1,000,000. Active actors are capped at 80, initial enemies at 64, effects and projectiles at 160, event history at 512, and inventory at 80. Excess items convert to gold. `step` accepts 0 through 100,000 frames per call.

| Module | Contract |
| --- | --- |
| `src/content/emberdeep.ts` | Monster, theme, skill, tree, boss, NPC and mechanic registries; encounter generator |
| `src/sim/progression.ts` | Profile validation, XP, skill allocation, stat composition, loot rolls |
| `src/sim/run.ts` | Fixed-step combat, Rapier queries, AI, mechanic handlers, drops and checkpoints |
| `src/render/proceduralRig.ts` | Primitive geometry and joint animation; six body archetypes |
| `src/render/emberStage.ts` | WebGPU-first TSL pixel pipeline, lighting, views and disposable visual effects |
| `src/emberGame.ts` | Commands, replay recording, persistence boundary and renderer recovery |
| `src/ui/emberUI.ts` | Optional showcase and debug controls |
| `src/demo.ts` | Preserved original engine demo at `?demo` |

To add a mechanic, define its label/color/tip, a simulation handler, a renderer prop, and a seeded encounter placement. To add a monster, select an existing rig and behavior or add one to the rig/AI handlers. Give a new ability data, an impact rule if needed, and a tree unlock. Keep simulation free of DOM, rendering, real time, and unseeded randomness.

## Agent CLI and checks

`node tools/agent.mjs --url http://localhost:5173/ --seed 32 --commands '[{"op":"act","command":{"type":"enter","depth":1}},{"op":"step","frames":120},{"op":"replayCheck"}]'`

Use `--file commands.json` for long batches. Stdout contains one JSON result per operation. `--screenshot /tmp/game.png` is optional. Supported operations: `schema`, `content`, `observe`, `act`, `step`, `events`, `save`, `load`, `replay`, and `replayCheck`.

Run `npm run check`, `npm run build:standalone`, `npm run verify:standalone`, and `npm run test:game`. The game browser check starts its own local server unless `GAME_URL` is set. Set `GAME_ENGINES=chromium,webkit,firefox` for all engines. Install matching Playwright browser builds for the driver in use. `GAME_PLAYWRIGHT_MODULE` selects a driver; `CHROMIUM_PATH`, `WEBKIT_PATH`, and `FIREFOX_PATH` select executables. Use `FIREFOX_HEADLESS=0` with a virtual display if native headless Firefox cannot create a GL context. `GAME_OFFLINE=1` plus a file URL verifies the standalone with every HTTP request blocked. Test images and reports go to `/tmp`, never into Git.
