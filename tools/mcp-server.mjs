#!/usr/bin/env node
/**
 * Depthward MCP server (stdio, JSON-RPC 2.0, newline-delimited): exposes the game's built-in
 * agent tools to any MCP client (Claude Code picks it up from .mcp.json in this repository).
 *
 * The game runs headless in Chromium (`?agent` mode); the session persists across calls, so an
 * agent can travel to a depth, step, spawn, capture, change the hero and so on in sequence. Tool
 * names use underscores (`creature_render` for `creature.render`). Images are returned as MCP
 * image content and also written to .agent/out/.
 *
 *   node tools/mcp-server.mjs [--url URL | --standalone] [--seed N] [--out DIR]
 *
 * No dependencies beyond the repository's (playwright-core, vite).
 */
import { AgentSession } from './lib/agent-session.mjs';

const argv = process.argv.slice(2);
const opts = { seed: 1 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--url') opts.url = argv[++i];
  else if (argv[i] === '--standalone') opts.standalone = true;
  else if (argv[i] === '--seed') opts.seed = Number(argv[++i]);
  else if (argv[i] === '--out') opts.out = argv[++i];
}
const log = (m) => process.stderr.write(`[depthward-mcp] ${m}\n`);
opts.log = log;
const session = new AgentSession(opts);
// Boot right away so the first tools/list does not wait for the whole page load.
session.start().catch((e) => log(`boot failed: ${e.message}`));

const toMcp = (n) => n.replace(/\./g, '_');
let nameMap = new Map();

const INSTRUCTIONS = [
  'Depthward is a 3D-rendered pixel-art ARPG (hack and slash) with a deterministic 60 Hz simulation.',
  'These tools build, generate, render and inspect its assets and systems: procedural creatures (genomes, custom species, sprite sheets),',
  'monsters (stat sheets, spawning), items (rolls, icons, drop simulation), levels (campaign, remixes with mechanics, maps),',
  'the passive tree, hero builds, balance (curves, bot playtests) and the live game (travel, step, input, capture, logs).',
  'Start with `help`. Live-game tools act on one persistent session; game_step advances exact frames.',
].join(' ');

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function listTools() {
  const tools = await session.tools();
  nameMap = new Map(tools.map((t) => [toMcp(t.name), t.name]));
  return tools.map((t) => ({
    name: toMcp(t.name),
    title: t.name,
    description: `[${t.group}${t.needs === 'game' ? ', live game' : ''}] ${t.desc}${t.example ? ` Example: ${JSON.stringify(t.example)}` : ''}`,
    inputSchema: t.params,
  }));
}

async function callTool(name, args) {
  if (!nameMap.size) await listTools();
  const real = nameMap.get(name) ?? name;
  const r = await session.call(real, args ?? {});
  if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
  let text = JSON.stringify(r.data, null, 1);
  if (text.length > 120000) text = `${text.slice(0, 120000)}\n... (truncated)`;
  const content = [{ type: 'text', text }];
  for (const im of r.images) {
    content.push({ type: 'image', data: im.base64, mimeType: 'image/png' });
    content.push({ type: 'text', text: `${im.name}: ${im.width}x${im.height} saved to ${im.path}` });
  }
  return { content };
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'depthward', title: 'Depthward agent tools', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: await listTools() });
      case 'tools/call':
        return reply(await callTool(params?.name, params?.arguments));
      case 'resources/list':
        return reply({ resources: [] });
      case 'prompts/list':
        return reply({ prompts: [] });
      default:
        return fail(-32601, `method not found: ${method}`);
    }
  } catch (e) {
    if (method === 'tools/call') return reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    return fail(-32603, e.message);
  }
}

let buffer = '';
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      continue;
    }
    // Calls run one at a time so live-game steps never interleave.
    queue = queue.then(() => handle(msg));
  }
});
const shutdown = async () => {
  await session.close();
  process.exit(0);
};
process.stdin.on('end', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
