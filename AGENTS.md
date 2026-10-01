# Agent instructions

## Scope and project

These instructions apply to the entire repository. Follow the user's task and [docs/AGENTIC-CODING-SOP.md](docs/AGENTIC-CODING-SOP.md). The app is at the repository root; execute npm commands from the root. Use Node 22.12+ and the committed npm lockfile.

## Working rules

- Inspect `git status`, relevant source and existing checks before changing files. Preserve unrelated user changes.
- Define the requested behavior and acceptance checks, then make focused changes. Ask only when missing information blocks progress or materially affects scope.
- Keep simulation in `src/sim/`, rendering in `src/render/`, and level/preset data in `src/content/`. Preserve seeded RNG and exact simulation frame stepping. UI and tools must never consume the sim RNG (use estimates such as `estimateSkill`).
- Extend the game through its data vocabularies (stats/mods, skills, statuses, monsters, archetypes, palettes, creature genomes, items/affixes/uniques, passive tree tables, themes, props); read [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) first.
- Use `npm ci` for reproducible installs. Do not upgrade dependencies or replace the lockfile without a task-related reason.
- Never commit credentials, `.env` files, dependencies, build caches, `.agent/` output, test screenshots or Windows `:Zone.Identifier` files. Preserve asset attribution.
- `public/assets/` and `standalone/3dpixel2d.html` are intentional tracked deliverables. Rebuild the standalone after changing runtime code, the HTML template or assets.
- Agent tools: `await window.agent.call(name, args)` runs a tool from the registry in `src/agent/` (`help` lists all 37: catalogs, creature genomes and custom species, monster/item/level/tree inspection, loot simulation, hero builds, balance curves, bot playtests, rendering, live-game control and capture). From a terminal use `npm run agent -- <tool> key=value` (images go to `.agent/out/`); over MCP use `npm run mcp` (registered in `.mcp.json`). Lower level: `window.agent.step(frames)`, `window.agent.idle()` and `window.game` (`?agent`, `?agent&town`, `?agent&stage=N`). `?agent` mode does not load saved settings profiles, saves or attach human input.
- Add a tool with `defineTool` in `src/agent/tools/` (pure tools in `content.ts` also run under Vitest; tools that draw set `needs: 'game'`). Give it a clear description, typed params with defaults and an example; `tests/agent-tools.test.ts` runs every example.
- Do not reset, discard or overwrite unrelated work. Commit/push when requested by the user; do not merge, deploy or send messages to others without authorization.

## Validation

Run `npm run check` for code/configuration changes; it typechecks, builds and runs the Vitest suite in `tests/`. Add focused regression tests there for meaningful logic changes. Do not claim typechecking proves runtime behavior.

For runtime/input/asset/standalone changes, run `npm run build:standalone` and `npm run verify:standalone`. Record actual results and failures.

When changing UI, verify small phones, tablets, wide screens and WebKit. On the maintainer's WSL2 machine, read `~/dev/TESTING-TOOLKIT.md`; `viewport-matrix <url> -o /tmp/<task>-matrix` checks phone/foldable/tablet/desktop layouts and browser errors. Inspect the PNGs yourself and fix overflow or console errors. Keep screenshots and reports outside the repo. Playwright browsers are already installed; keep `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` and do not run `playwright install-deps` on Ubuntu 26.04. Only run `phone-preview` when the user requests a public tunnel. WebKit emulation is the closest automated check available here; real iOS Safari is not available.

## Handoff

State what changed, why, which checks passed, and any remaining limitations. Link relevant files or the PR. Distinguish checks actually executed from proposed checks; never describe incomplete work as complete.
