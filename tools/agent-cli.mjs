#!/usr/bin/env node
/**
 * Depthward agent CLI: call the game's built-in agent tools from a terminal.
 *
 *   npm run agent -- help                                   list every tool
 *   npm run agent -- help tool=creature.render              one tool's parameters
 *   npm run agent -- creature.render plan=spider seed=9     key=value arguments
 *   npm run agent -- level.generate '{"stage":30,"mechanics":["kegs","ice"]}'
 *   npm run agent -- --script steps.json                     [["game.goto",{...}], ["game.step",{...}], ...] in one session
 *   npm run agent -- repl                                    interactive: `tool {json}` or `tool k=v` per line
 *
 * Options: --url URL (running server) | --standalone (single-file build) | default: Vite in-process
 *          --seed N, --out DIR (images; default .agent/out), --headed, --full (no output truncation)
 * Output: one JSON result per call on stdout; images are written as PNG files and their paths are
 * put where the image reference was.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { AgentSession, parseArgs } from './lib/agent-session.mjs';

const argv = process.argv.slice(2);
const opts = { seed: 1 };
const rest = [];
let script = null, full = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') opts.url = argv[++i];
  else if (a === '--standalone') opts.standalone = true;
  else if (a === '--seed') opts.seed = Number(argv[++i]);
  else if (a === '--out') opts.out = argv[++i];
  else if (a === '--headed') opts.headed = true;
  else if (a === '--script') script = argv[++i];
  else if (a === '--full') full = true;
  else rest.push(a);
}
if (!rest.length && !script) rest.push('help');
opts.log = (m) => process.stderr.write(`[agent] ${m}\n`);

const session = new AgentSession(opts);
const show = (r) => {
  const text = JSON.stringify({ ok: r.ok, ms: r.ms, ...(r.ok ? { data: r.data } : { error: r.error }), images: r.images.map((i) => i.path) }, null, 2);
  process.stdout.write(`${full || text.length < 60000 ? text : `${text.slice(0, 60000)}\n... (truncated; --full for everything)`}\n`);
};

let failed = false;
try {
  if (script) {
    const steps = JSON.parse(fs.readFileSync(script, 'utf8'));
    for (const [name, args] of steps) {
      const r = await session.call(name, args ?? {});
      show(r);
      if (!r.ok) failed = true;
    }
  } else if (rest[0] === 'repl') {
    await session.start();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'agent> ' });
    rl.prompt();
    for await (const line of rl) {
      const [name, ...parts] = line.trim().split(/\s+/);
      if (!name) {
        rl.prompt();
        continue;
      }
      if (name === 'exit' || name === 'quit') break;
      try {
        const joined = line.trim().slice(name.length).trim();
        show(await session.call(name, joined.startsWith('{') ? JSON.parse(joined) : parseArgs(parts)));
      } catch (e) {
        process.stdout.write(`error: ${e.message}\n`);
      }
      rl.prompt();
    }
  } else {
    const [name, ...parts] = rest;
    const r = await session.call(name, parseArgs(parts));
    show(r);
    failed = !r.ok;
  }
} catch (e) {
  process.stderr.write(`[agent] ${e.stack ?? e}\n`);
  failed = true;
} finally {
  await session.close();
}
process.exit(failed ? 1 : 0);
