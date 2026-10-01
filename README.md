# Emberdeep · my-3D2dge

An agent-operated 3D pixel hack-and-slash engine and its complete run-based showcase game. The ranger returns with responsive three-hit melee, invulnerable rolls, eight abilities, a deep skill tree, XP, gold, loot, town services, phased bosses, and endless seeded encounters. No story gates: clear a room, gather the spoils, shape a build, and descend again.

Three.js **0.186.1 (r186)** renders through **WebGPU first**, with WebGL2 fallback. Rapier **0.20.0** supplies the fixed-step world, character controllers, shape queries, collisions, and line-of-sight checks. The custom TSL pipeline combines integer pixel blocks, depth/normal edges, color quantization, and vignette. New game characters use primitive geometry and mathematical animation; they require no external character meshes or clips.

## Run

```sh
npm ci
npm run dev
```

Open the local URL for Cinderhaven. Use `?agent&seed=32` for agent operation, `?depth=4` for a boss room, `?auto` for an automated showcase run, `?plain` for full-resolution 3D, and `?demo` for the preserved original character/animation demo. The tracked `standalone/3dpixel2d.html` runs offline and retains the original attributed demo assets.

## Game systems

- Six modular body rigs: ranger, husk/duelist, brute, crawler, wisp, and slime. Joint pivots support idle breathing, alternating locomotion, weapon strikes, hit reactions, falls, rolling, cape motion, and NPC work cycles.
- Eight abilities: Cleave, Whirlwind, Frost Nova, Sundering Lunge, Chain Storm, Starfall, Soul Siphon, and Blade Ward. Timed enemy warnings reward dodge timing. Damage, mana, stamina, armor, critical hits, life steal, cooldowns, and repeatable skill mastery form the combat build.
- 54 skill nodes across Blade, Ward, and Arcane. Nodes have five ranks and path prerequisites. Three keystones change build tradeoffs. Assign four active abilities; gain two points per level; refund in town for free.
- Three item slots and four rarity tiers. Seeded affixes improve stats; legendary items add echo, frost, or siphon powers. Equip, salvage, and temper weapons. Persistent XP, gold, inventory, skills, deepest depth, and potions survive failed runs.
- Cinderhaven has Orin’s forge, Vela’s skill sanctuary, and Mara’s potion supplies. Geometry, rigs, lighting, and work animations are procedural.
- Twelve levels introduce Powder Kegs, Gale Lanes, Frost Sigils, Ember Forges, Time Wells, Storm Pylons, Brood Nests, Blood Altars, Echo Mirrors, Gravity Runes, Launch Plates, and Gilded Seals. Mechanics help skilled play without acting as mandatory puzzles.
- Later rooms combine mechanics, behavior archetypes, elites, themes, layouts, and recurring bosses with health phases, slams, summons, and radial attacks. Content registries and bounded generation allow repeatable extension to depth 1,000,000 without storing millions of levels.
- Isometric, side, and top-down cameras can be chosen or assigned per depth. The pause menu has a difficulty slider and seven individual tuning controls, autoplay, invulnerability, pixel mode, and single-frame stepping.

Optional showcase controls: WASD/arrows move, mouse/J strikes, Space/Shift rolls, 1–4 abilities, Q potion, E interact, K skills, I inventory, V camera, T town, Escape pause. Touch controls and common gamepad controls are included. Agents do not need these controls.

## Agent operation

```js
await new Promise(resolve => {
  const poll = () => window.agent?.ready ? resolve() : requestAnimationFrame(poll);
  poll();
});
agent.act({ type: 'enter', depth: 1 });
agent.act({ type: 'input', value: { x: 0, z: -1, attack: true } });
agent.step(60);
agent.observe();
```

The [agent contract](docs/EMBERDEEP-AGENT-CONTRACT.md) specifies commands, observations, saves, complete JSON checkpoints, replay baselines, limits, and module extension points. The [validation report](docs/EMBERDEEP-VALIDATION.md) records actual checks and platform limits. `tools/agent.mjs` is a JSON batch client for browser agents. `Run` also operates headlessly in Node after `initPhysics()`.

## Verify

```sh
npm run check
npm run build:standalone
npm run verify:standalone
npm run test:game
```

The fixed-step suite checks physics, input profiles, skill prerequisites, encounter generation, combat rewards, rolls, and exact mid-combat restore. Browser tests check replay, autonomous progression, loot, all perspectives, deep procedural rooms, five viewport sizes, visible scene pixels, pause tuning, and browser errors. Offline checks block external requests and load all 14 preserved demo models. See the contract for browser executable/driver environment variables.

Retained asset attribution is in [public/assets/LICENSE-quaternius.txt](public/assets/LICENSE-quaternius.txt). Agent working instructions are in [AGENTS.md](AGENTS.md).
