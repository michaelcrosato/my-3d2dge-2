# my-3d2dge-2

A browser game demo that renders 3D characters as pixel art, built with TypeScript, Three.js, Rapier physics and Vite. Includes keyboard and touch controls, a plain 3D view, deterministic simulation stepping, and a self-contained HTML build.

The application lives in `3dpixel2d/`. Run application commands from that directory. Node.js 22.12+ (Node 22 recommended) and npm are required.

```sh
cd 3dpixel2d
npm ci
npm run dev -- --host 127.0.0.1
```

Open http://localhost:5173. Use WASD or arrow keys to move, Shift to sprint, Space to jump, and J or click to attack. P switches pixel/3D rendering; Esc pauses; R resets. On phones use the direction pad and action buttons.

## Commands

| Command (inside `3dpixel2d/`) | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript validation |
| `npm run check` | TypeScript validation and production build; also runs in CI |
| `npm run build` | Build the web app into `dist/` |
| `npm run build:standalone` | Rebuild the committed single-file game |
| `npm run verify:standalone` | Exercise the offline game in Chromium, WebKit and Firefox; requires Python Playwright and installed browsers |
| `npm run assets` | Download source packs and rebuild runtime assets (requires network) |

There is currently no unit test suite. The production build and existing browser interaction verifier provide the available checks. The browser verifier is separate from CI's build check.

## Layout

- `3dpixel2d/src/sim/`: simulation, navigation and seeded RNG.
- `3dpixel2d/src/render/`: assets, character animation, stage and pixel rendering.
- `3dpixel2d/src/content/`: character presets and level data.
- `3dpixel2d/src/main.ts`, `game.ts`, `input.ts`, `config.ts`: boot, game coordination, controls and configuration.
- `3dpixel2d/public/assets/`: committed runtime models, animations and manifest.
- `3dpixel2d/tools/`: asset preparation, standalone bundling and browser verification.
- `3dpixel2d/standalone/`: shareable HTML game and usage notes.

For browser automation, open `/?agent&seed=1`, wait for `window.agent.ready`, and call `window.agent.step(frames)`. This mode starts paused with human input disabled. `window.game` exposes the game object; inspect the source for supported methods. A broader agent CLI or MCP server is not implemented.

The standalone HTML embeds runtime libraries and assets; see [standalone instructions](3dpixel2d/standalone/README.md). Keep it in sync after runtime or asset changes.

## Contributing with agents

Read [AGENTS.md](AGENTS.md) first and follow the [agent coding SOP](docs/AGENTIC-CODING-SOP.md). CI checks pushes and pull requests on `main`.

Quaternius models and animations carry the included [CC0 asset notice](3dpixel2d/public/assets/LICENSE-quaternius.txt). This repository does not declare a separate license for its application source.
