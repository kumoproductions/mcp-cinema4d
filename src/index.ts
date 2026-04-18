#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { C4DClient } from "./c4d-client.js";
import { TOOLS, type AnyTool } from "./tools/index.js";
import { execPythonEnabled } from "./tools/exec-python.js";

// Prefer the unified C4D_MCP_* pair so one variable change reaches both sides.
// Fall back to the legacy C4D_BRIDGE_* names for existing configs.
const host = process.env.C4D_MCP_HOST ?? process.env.C4D_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.C4D_MCP_PORT ?? process.env.C4D_BRIDGE_PORT ?? 18710);
const token = process.env.C4D_MCP_TOKEN?.trim() || undefined;
if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  console.error(`[cinema4d-mcp] invalid port: ${port}`);
  process.exit(1);
}

const client = new C4DClient({ host, port, token });

const server = new McpServer({
  name: "cinema4d-mcp",
  version: "0.1.0",
});

function register(tool: AnyTool): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputShape,
    },
    async (args: unknown) => {
      try {
        return await tool.handler(args as any, client);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

TOOLS.forEach(register);

async function main(): Promise<void> {
  if (execPythonEnabled()) {
    console.error(
      "[cinema4d-mcp] exec_python is ENABLED via C4D_MCP_ENABLE_EXEC_PYTHON — arbitrary Python is exposed to the MCP client.",
    );
  } else {
    console.error(
      "[cinema4d-mcp] exec_python is disabled (default). Opt in with C4D_MCP_ENABLE_EXEC_PYTHON=1 on both sides.",
    );
  }
  if (token) {
    console.error("[cinema4d-mcp] token authentication enabled (C4D_MCP_TOKEN).");
  } else {
    console.error(
      "[cinema4d-mcp] no C4D_MCP_TOKEN set — bridge accepts any local connection. Recommended for shared workstations: set a random token on both sides.",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const shutdown = () => {
  client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
