/**
 * The code map (codemap.ts) as tools the crew can call.
 *
 * Claude: served in-process through the Agent SDK -- no separate server, no
 * install, nothing in the person's own Claude settings.
 * Codex: the same tools over stdio (codemapStdio.ts), handed to each thread
 * through thread/start's config overrides -- also nothing to install.
 * The words below are shared so the two crews are told the same thing.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { explore, impactReport } from './codemap.js';

/** The MCP server name; tools arrive as mcp__roost__<tool> (Claude) / roost.<tool> (Codex). */
export const CODEMAP_SERVER = 'roost';
/** Read-only lookups: never worth a permission prompt on the phone. */
export const isCodemapTool = (toolName: string) => toolName.startsWith(`mcp__${CODEMAP_SERVER}__`);

export const CODEMAP_INSTRUCTIONS = `This project has a pre-built code map (TypeScript/JavaScript): every function, class, method and component, and who calls whom, kept current with the files on disk.
Reach for code_explore first for structural questions -- "how does X work", "where is X handled", "how does X reach Y", or surveying an area before a change. One call returns the relevant source with exact line numbers, callers, callees, call paths and a blast radius; a grep → read → read loop repeats work the map already did and costs far more.
Use code_impact before changing a function's signature or behaviour, to see everything that depends on it.
Fall back to Grep/Read for non-code text (docs, config, CSS), for string literals, or when the map says nothing matches.`;

export const EXPLORE = {
  name: 'code_explore',
  description:
    'Answer a structural question about this project in one call: the relevant symbols\' verbatim source (with line numbers) grouped by file, what calls them and what they call, the call paths between them, and the blast radius of the main one. Ask in plain words ("how does a deploy restart get reported") or name a symbol exactly ("Session.notice") to get its full source.',
  arg: 'A question, a feature area, or an exact function/class/method name',
};
export const IMPACT = {
  name: 'code_impact',
  description:
    'Everything in the project that depends on a symbol, transitively (up to 5 calls away), grouped by distance -- check this before changing what a function takes or does.',
  arg: 'Function, method (Class.method) or component name',
};

/** Never throws: a broken map must degrade to "use Grep", not fail the turn. */
export function runExplore(cwd: string, query: string): string {
  try {
    return explore(cwd, query);
  } catch (err: any) {
    return `The code map failed: ${String(err?.message ?? err)}. Use Grep/Read instead.`;
  }
}
export function runImpact(cwd: string, symbol: string): string {
  try {
    return impactReport(cwd, symbol);
  } catch (err: any) {
    return `The code map failed: ${String(err?.message ?? err)}.`;
  }
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export function codemapServer(cwd: string) {
  return createSdkMcpServer({
    name: CODEMAP_SERVER,
    version: '1.0.0',
    instructions: CODEMAP_INSTRUCTIONS,
    alwaysLoad: true,
    tools: [
      tool(EXPLORE.name, EXPLORE.description, { query: z.string().describe(EXPLORE.arg) }, async ({ query }) => text(runExplore(cwd, query)), {
        annotations: { readOnlyHint: true },
      }),
      tool(IMPACT.name, IMPACT.description, { symbol: z.string().describe(IMPACT.arg) }, async ({ symbol }) => text(runImpact(cwd, symbol)), {
        annotations: { readOnlyHint: true },
      }),
    ],
  });
}

/** How Codex should launch the stdio server: the built .js under node, or
 *  the .ts source under tsx when Roost itself runs from source (dev, tests). */
export function codemapStdioCommand(cwd: string): { command: string; args: string[] } | null {
  const js = fileURLToPath(new URL('./codemapStdio.js', import.meta.url));
  if (existsSync(js)) return { command: process.execPath, args: [js, cwd] };
  const tsSrc = fileURLToPath(new URL('./codemapStdio.ts', import.meta.url));
  if (existsSync(tsSrc)) return { command: process.execPath, args: ['--import', 'tsx', tsSrc, cwd] };
  return null;
}

/** The thread/start `config` override that gives a Codex thread the map. */
export function codexCodemapConfig(cwd: string): Record<string, unknown> | null {
  const cmd = codemapStdioCommand(cwd);
  if (!cmd) return null;
  return {
    [`mcp_servers.${CODEMAP_SERVER}`]: {
      command: cmd.command,
      args: cmd.args,
      // Read-only lookups: auto-approved like Claude's, never a phone prompt.
      default_tools_approval_mode: 'approve',
      startup_timeout_sec: 20,
      tool_timeout_sec: 60,
    },
  };
}
