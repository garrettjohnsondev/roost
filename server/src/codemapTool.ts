/**
 * The code map (codemap.ts) as tools the Claude crew can call, served
 * in-process through the Agent SDK -- no separate server, no install, nothing
 * in the person's own Claude settings. Every Roost session on a project gets
 * it the moment it starts.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { explore, impactReport } from './codemap.js';

/** The MCP server name; tools arrive as mcp__roost__<tool>. */
export const CODEMAP_SERVER = 'roost';
/** Read-only lookups: never worth a permission prompt on the phone. */
export const isCodemapTool = (toolName: string) => toolName.startsWith(`mcp__${CODEMAP_SERVER}__`);

const INSTRUCTIONS = `This project has a pre-built code map (TypeScript/JavaScript): every function, class, method and component, and who calls whom, kept current with the files on disk.
Reach for code_explore first for structural questions -- "how does X work", "where is X handled", "how does X reach Y", or surveying an area before a change. One call returns the relevant source with exact line numbers, callers, callees, call paths and a blast radius; a grep → read → read loop repeats work the map already did and costs far more.
Use code_impact before changing a function's signature or behaviour, to see everything that depends on it.
Fall back to Grep/Read for non-code text (docs, config, CSS), for string literals, or when the map says nothing matches.`;

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

export function codemapServer(cwd: string) {
  return createSdkMcpServer({
    name: CODEMAP_SERVER,
    version: '1.0.0',
    instructions: INSTRUCTIONS,
    alwaysLoad: true,
    tools: [
      tool(
        'code_explore',
        'Answer a structural question about this project in one call: the relevant symbols\' verbatim source (with line numbers) grouped by file, what calls them and what they call, the call paths between them, and the blast radius of the main one. Ask in plain words ("how does a deploy restart get reported") or name a symbol exactly ("Session.notice") to get its full source.',
        { query: z.string().describe('A question, a feature area, or an exact function/class/method name') },
        async ({ query }) => {
          try {
            return text(explore(cwd, query));
          } catch (err: any) {
            return text(`The code map failed: ${String(err?.message ?? err)}. Use Grep/Read instead.`);
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'code_impact',
        'Everything in the project that depends on a symbol, transitively (up to 5 calls away), grouped by distance -- check this before changing what a function takes or does.',
        { symbol: z.string().describe('Function, method (Class.method) or component name') },
        async ({ symbol }) => {
          try {
            return text(impactReport(cwd, symbol));
          } catch (err: any) {
            return text(`The code map failed: ${String(err?.message ?? err)}.`);
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}
