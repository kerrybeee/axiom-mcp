#!/usr/bin/env node
/**
 * AXIOM MCP Server — stdio transport (Claude Desktop, Cursor, Cline, Windsurf)
 * Set AXIOM_TRANSPORT=http to use HTTP/SSE instead (see server-http.ts)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { initDb } from "./db.js";
import { initSession, TOOL_DEFS, handleTool } from "./tools.js";

async function main() {
  await initDb();
  initSession();

  const server = new Server(
    { name: "axiom-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const text = await handleTool(name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[AXIOM] MCP server v2.0 running (stdio)\n");
}

main().catch(e => { process.stderr.write(`[AXIOM] Fatal: ${e}\n`); process.exit(1); });
