/**
 * WebMCP: when the browser offers `navigator.modelContext` (the Web Model Context Protocol), the
 * game registers its agent tools there, so an AI agent built into the browser can inspect and
 * play the page it is looking at, with the same tools as the console, CLI and MCP server.
 * Feature-detected: browsers without WebMCP are unaffected. Lighthouse recommends at most 40
 * tools per page, so two developer diagnostics stay console/CLI-only.
 */
import type { AgentApi } from './api';

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(input: Record<string, unknown>): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>;
}

interface ModelContext {
  registerTool?(tool: ModelContextTool): unknown;
  provideContext?(ctx: { tools: ModelContextTool[] }): unknown;
}

/** Not offered to in-page agents: developer diagnostics and minutes-long batch runs. */
export const WEBMCP_EXCLUDED: ReadonlySet<string> = new Set(['logs.read', 'scene.stats', 'balance.campaign']);
export const WEBMCP_MAX_TOOLS = 40;

/** The tools as WebMCP descriptors (names use underscores, like the MCP server). */
export function webMcpTools(agent: AgentApi): ModelContextTool[] {
  const offered = agent.tools().filter((t) => !WEBMCP_EXCLUDED.has(t.name));
  // Over the cap, the last tools would vanish silently: say which, so WEBMCP_EXCLUDED gets updated.
  if (offered.length > WEBMCP_MAX_TOOLS) console.warn(`WebMCP: ${offered.length} tools, offering ${WEBMCP_MAX_TOOLS}; left out: ${offered.slice(WEBMCP_MAX_TOOLS).map((t) => t.name).join(', ')}`);
  return offered.slice(0, WEBMCP_MAX_TOOLS).map((t) => ({
    name: t.name.replace(/\./g, '_'),
    description: `${t.desc}${t.example ? ` Example: ${JSON.stringify(t.example)}` : ''}`,
    inputSchema: t.params,
    async execute(input) {
      const r = await agent.call(t.name, input ?? {});
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: JSON.stringify(r.data) }];
      for (const im of r.images) if (im.png) content.push({ type: 'image', data: im.png.split(',')[1], mimeType: 'image/png' });
      return { content };
    },
  }));
}

/** Registers the tools when WebMCP exists; returns how many were offered (0 = unsupported). */
export function registerWebMcp(agent: AgentApi, nav: { modelContext?: ModelContext } = navigator as never): number {
  const mc = nav.modelContext;
  if (!mc) return 0;
  const tools = webMcpTools(agent);
  try {
    if (typeof mc.registerTool === 'function') for (const t of tools) mc.registerTool(t);
    else if (typeof mc.provideContext === 'function') mc.provideContext({ tools });
    else return 0;
  } catch (e) {
    console.warn('WebMCP registration failed', e);
    return 0;
  }
  return tools.length;
}
