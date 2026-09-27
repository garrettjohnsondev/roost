/**
 * The code map as a standalone stdio MCP server, for Codex threads (Codex
 * launches tool servers as processes; Claude's are in-process). Started by
 * Codex itself with the project directory as its only argument -- see
 * codexCodemapConfig. Same tools, same words as the Claude side.
 *
 *   node dist/codemapStdio.js /path/to/project
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CODEMAP_INSTRUCTIONS, CODEMAP_SERVER, EXPLORE, IMPACT, runExplore, runImpact } from './codemapTool.js';

const cwd = process.argv[2] || process.cwd();
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

const server = new McpServer({ name: CODEMAP_SERVER, version: '1.0.0' }, { instructions: CODEMAP_INSTRUCTIONS });
server.registerTool(
  EXPLORE.name,
  { description: EXPLORE.description, inputSchema: { query: z.string().describe(EXPLORE.arg) }, annotations: { readOnlyHint: true } },
  async ({ query }) => text(runExplore(cwd, query)),
);
server.registerTool(
  IMPACT.name,
  { description: IMPACT.description, inputSchema: { symbol: z.string().describe(IMPACT.arg) }, annotations: { readOnlyHint: true } },
  async ({ symbol }) => text(runImpact(cwd, symbol)),
);

await server.connect(new StdioServerTransport());
