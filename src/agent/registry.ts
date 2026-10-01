/**
 * The agent tool registry: every tool an AI agent can call to build, generate, render and
 * inspect the game's assets and systems, with typed parameters, validation and help text.
 *
 *   window.agent.tools()            list tools (name, group, description, JSON Schema)
 *   window.agent.call(name, args)   run one; resolves to { ok, data, images } or { ok:false, error }
 *
 * The same registry backs the Node CLI (`tools/agent-cli.mjs`) and the MCP server
 * (`tools/mcp-server.mjs`), so a tool written once is available in the browser console, the
 * terminal and to any MCP client. Tools that only need content and the simulation ("pure") also
 * run under Vitest without a browser; tools that draw need the live game (`needs: 'game'`).
 *
 * Images: a tool calls `ctx.image(name, img)` and gets back a reference string; the CLI writes the
 * PNG to disk, the MCP server returns it as image content, the console gets a data URL.
 */
import type { ClipTable } from '../sim/sim';
import type { Game } from '../game';
import type { Img } from './capture';

export type ParamType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export interface ParamSpec {
  type: ParamType;
  desc: string;
  default?: unknown;
  enum?: readonly (string | number)[];
  /** Element type for arrays. */
  items?: { type: ParamType; enum?: readonly (string | number)[] };
  min?: number;
  max?: number;
  required?: boolean;
}

export interface ToolImage {
  name: string;
  width: number;
  height: number;
  /** PNG data URL in the browser; absent under Node (raw pixels in `img`). */
  png?: string;
  img?: Img;
}

export interface ToolContext {
  game: Game | null;
  clips: ClipTable;
  /** Attach an image to the result; returns a reference to put in the data. */
  image(name: string, img: Img, scale?: number): string;
}

export interface ToolDef {
  name: string;
  group: string;
  desc: string;
  params: Record<string, ParamSpec>;
  /** 'game' tools need the live renderer and scene (browser only). */
  needs?: 'game';
  /** Example arguments shown in help. */
  example?: Record<string, unknown>;
  run(args: Record<string, any>, ctx: ToolContext): unknown;
}

export type ToolResult = { ok: true; data: unknown; images: ToolImage[]; ms: number } | { ok: false; error: string; ms: number };

const TOOLS = new Map<string, ToolDef>();

export function defineTool(t: ToolDef): ToolDef {
  if (TOOLS.has(t.name)) throw new Error(`tool "${t.name}" defined twice`);
  TOOLS.set(t.name, t);
  return t;
}

export function tool(name: string): ToolDef | undefined {
  return TOOLS.get(name);
}

export function allTools(): ToolDef[] {
  return [...TOOLS.values()];
}

/** JSON Schema of a tool's parameters (MCP `inputSchema`). */
export function schemaOf(t: ToolDef) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, p] of Object.entries(t.params)) {
    const s: Record<string, unknown> = { type: p.type, description: p.desc };
    if (p.enum) s.enum = p.enum;
    if (p.items) s.items = { type: p.items.type, ...(p.items.enum ? { enum: p.items.enum } : {}) };
    if (p.min !== undefined) s.minimum = p.min;
    if (p.max !== undefined) s.maximum = p.max;
    if (p.default !== undefined) s.default = p.default;
    properties[k] = s;
    if (p.required) required.push(k);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export function describeTools(group?: string) {
  return allTools()
    .filter((t) => !group || t.group === group)
    .map((t) => ({ name: t.name, group: t.group, desc: t.desc, needs: t.needs ?? 'none', params: schemaOf(t), example: t.example ?? null }));
}

const typeOk = (v: unknown, type: ParamType) =>
  type === 'array' ? Array.isArray(v) : type === 'integer' ? Number.isInteger(v) : type === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === type;

/** Validates and fills defaults; throws with a helpful message. */
export function validateArgs(t: ToolDef, raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const args: Record<string, unknown> = { ...(raw ?? {}) };
  const known = Object.keys(t.params);
  for (const k of Object.keys(args)) {
    if (!(k in t.params)) throw new Error(`unknown parameter "${k}" for ${t.name}. Parameters: ${known.join(', ') || '(none)'}`);
  }
  for (const [k, p] of Object.entries(t.params)) {
    let v = args[k];
    if (v === undefined || v === null) {
      if (p.required) throw new Error(`${t.name}: "${k}" is required (${p.desc})`);
      if (p.default !== undefined) args[k] = structuredClone(p.default);
      else delete args[k];
      continue;
    }
    // Friendly coercion for CLI strings.
    if ((p.type === 'number' || p.type === 'integer') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = args[k] = Number(v);
    if (p.type === 'boolean' && (v === 'true' || v === 'false')) v = args[k] = v === 'true';
    if (!typeOk(v, p.type)) throw new Error(`${t.name}: "${k}" must be ${p.type}, got ${JSON.stringify(v)}`);
    if (p.enum && !p.enum.includes(v as string | number)) throw new Error(`${t.name}: "${k}" must be one of ${p.enum.join(', ')}; got ${JSON.stringify(v)}`);
    if (typeof v === 'number' && ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max))) throw new Error(`${t.name}: "${k}" must be within [${p.min ?? '-inf'}, ${p.max ?? 'inf'}]`);
    if (p.type === 'array' && p.items) {
      for (const x of v as unknown[]) {
        if (!typeOk(x, p.items.type)) throw new Error(`${t.name}: every "${k}" entry must be ${p.items.type}`);
        if (p.items.enum && !p.items.enum.includes(x as string | number)) throw new Error(`${t.name}: "${k}" entries must be among ${p.items.enum.join(', ')}; got ${JSON.stringify(x)}`);
      }
    }
  }
  return args;
}

/** Encodes images as PNG data URLs when a DOM is available. */
export function encodeImage(img: Img, scale = 1): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if (scale === 1) return c.toDataURL('image/png');
  const s = document.createElement('canvas');
  s.width = img.width * scale;
  s.height = img.height * scale;
  const g = s.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, s.width, s.height);
  return s.toDataURL('image/png');
}

export async function callTool(name: string, raw: Record<string, unknown> | null | undefined, env: { game: Game | null; clips: ClipTable }): Promise<ToolResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ms = () => Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  const t = TOOLS.get(name);
  if (!t) {
    const near = allTools().map((x) => x.name).filter((n) => n.split('.')[0] === name.split('.')[0] || n.includes(name));
    return { ok: false, error: `unknown tool "${name}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Call "help" for the list.`, ms: ms() };
  }
  const images: ToolImage[] = [];
  const ctx: ToolContext = {
    ...env,
    image(imgName, img, scale = 1) {
      const png = encodeImage(img, scale);
      const entry: ToolImage = { name: imgName, width: img.width * scale, height: img.height * scale, ...(png ? { png } : { img }) };
      images.push(entry);
      return `image:${imgName}`;
    },
  };
  try {
    if (t.needs === 'game' && !env.game) throw new Error(`${name} needs the running game (browser); use window.agent.call, the CLI or the MCP server`);
    const args = validateArgs(t, raw);
    const data = await t.run(args, ctx);
    return { ok: true, data: data ?? null, images, ms: ms() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: ms() };
  }
}
