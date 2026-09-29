# Standard operating procedure for agent coding

## 1. Establish the task

Read `AGENTS.md`, inspect `git status --short --branch` and relevant files, and identify the requested outcome. Write concrete acceptance checks before implementation. Explain the next step briefly to the user. Resolve routine choices independently; ask when an answer is needed to avoid guessing at scope.

For a multi-step task, keep a short plan in the session. Track completed work and remaining checks. Use evidence from the current checkout, not assumptions about previous runs.

## 2. Prepare a safe workspace

Work on a focused branch such as `agent/<short-task>` for ongoing changes. Respect the current branch if the user explicitly requests it. Preserve unrelated edits and inspect changes before staging. Never use destructive Git operations to obtain a clean tree.

Install with `npm ci` from the repository root. The committed runtime assets allow normal development without downloading source packs. Run asset preparation only when assets need to change. Keep credentials and downloaded caches untracked.

## 3. Implement

Read the code path before editing it. Keep changes within the requested behavior and maintain the simulation/rendering/content boundaries. Preserve deterministic stepping and seeded randomness. Update documentation when commands or behavior change.

For reproducible browser observations, use `/?agent&seed=1`, wait for `window.agent.ready`, then step a known number of frames. Use `window.game` only through methods confirmed in source. Do not infer support for an agent CLI or MCP server.

## 4. Verify the outcome

Execute checks from the repository root:

```sh
npm run check
# Also required when runtime, HTML template or assets change:
npm run build:standalone
npm run verify:standalone
```

`check` validates TypeScript and builds the web app; it does not run unit tests. `verify:standalone` uses Python Playwright and installed browser engines to test offline loading, movement/release, jump, attack, pause/reset/resume, both rendering modes and all models. On a new machine install Python Playwright and compatible browsers before running it; the maintainer's WSL2 toolkit already supplies them.

For meaningful logic changes, add a targeted regression test that distinguishes the fixed behavior from the old behavior, and wire its execution into the normal check command. Avoid tests that merely restate the implementation.

For UI changes, start a local dev server and run the viewport matrix covering small phones, tablets, wide screens and WebKit. Inspect screenshots yourself. Fix horizontal overflow and JavaScript/console errors. Keep artifacts in `/tmp`, and report emulation limits. Follow the machine-specific instructions in `AGENTS.md`.

When a check fails, investigate and repair task-related failures, rerun the affected check, and record any pre-existing failures with evidence. Do not silently weaken a gate to make it pass.

## 5. Review and deliver

Inspect `git diff --check`, the full diff and staged file list. Confirm no secrets, dependency folders, cache files or unrelated edits are included. Ensure the standalone reflects runtime changes and asset notices remain present.

When committing is authorized, stage explicit paths and write a concise imperative commit message. When pushing is authorized, push the branch and verify the remote commit. Use the PR template for reviewable changes and report the actual CI result when available. Creating a PR does not authorize merging or deploying it.

The handoff must describe the resulting behavior, validation evidence and remaining risks. For this setup, CI covers the production build; cross-browser runtime checks run separately on a machine with Playwright browsers. Repository completion requires authoritative evidence for every requested deliverable.
