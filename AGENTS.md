# Agent instructions

## Scope and project

These instructions apply to the entire repository. Follow the user's task and [docs/AGENTIC-CODING-SOP.md](docs/AGENTIC-CODING-SOP.md). The app is in `3dpixel2d/`; execute npm commands there. Use Node 22.12+ and the committed npm lockfile.

## Working rules

- Inspect `git status`, relevant source and existing checks before changing files. Preserve unrelated user changes.
- Define the requested behavior and acceptance checks, then make focused changes. Ask only when missing information blocks progress or materially affects scope.
- Keep simulation in `src/sim/`, rendering in `src/render/`, and level/preset data in `src/content/`. Preserve seeded RNG and exact simulation frame stepping.
- Use `npm ci` for reproducible installs. Do not upgrade dependencies or replace the lockfile without a task-related reason.
- Never commit credentials, `.env` files, dependencies, build caches, test screenshots or Windows `:Zone.Identifier` files. Preserve asset attribution.
- `public/assets/` and `standalone/3dpixel2d.html` are intentional tracked deliverables. Rebuild the standalone after changing runtime code, the HTML template or assets.
- Current automation is `window.agent.ready`, `window.agent.step(frames)` and `window.game`; do not assume missing CLI/MCP tools exist.
- Do not reset, discard or overwrite unrelated work. Commit/push when requested by the user; do not merge, deploy or send messages to others without authorization.

## Validation

Run `npm run check` for code/configuration changes. There is no unit test suite yet; add focused regression tests for meaningful logic changes when appropriate, and include them in the checks. Do not claim typechecking proves runtime behavior.

For runtime/input/asset/standalone changes, run `npm run build:standalone` and `npm run verify:standalone`. Record actual results and failures.

When changing UI, verify small phones, tablets, wide screens and WebKit. On the maintainer's WSL2 machine, read `~/dev/TESTING-TOOLKIT.md`; `viewport-matrix <url> -o /tmp/<task>-matrix` checks phone/foldable/tablet/desktop layouts and browser errors. Inspect the PNGs yourself and fix overflow or console errors. Keep screenshots and reports outside the repo. Playwright browsers are already installed; keep `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` and do not run `playwright install-deps` on Ubuntu 26.04. Only run `phone-preview` when the user requests a public tunnel. WebKit emulation is the closest automated check available here; real iOS Safari is not available.

## Handoff

State what changed, why, which checks passed, and any remaining limitations. Link relevant files or the PR. Distinguish checks actually executed from proposed checks; never describe incomplete work as complete.
