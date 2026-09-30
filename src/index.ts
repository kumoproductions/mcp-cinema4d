#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { C4DClient } from "./c4d-client.js";
import { DEFAULT_MAX_INSTANCES, InstanceRegistry, multiInstanceEnabled } from "./instances.js";
import type { ToolContext } from "./tools/define-tool.js";
import { TOOLS, type AnyTool } from "./tools/index.js";
import { execPythonEnabled } from "./tools/exec-python.js";

// Read the real package version at runtime so the server never self-reports a
// stale literal. dist/index.js sits one level below package.json in both the
// repo and the published tarball.
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

// Prefer the unified C4D_MCP_* pair so one variable change reaches both sides.
// Fall back to the legacy C4D_BRIDGE_* names for existing configs.
const host = process.env.C4D_MCP_HOST ?? process.env.C4D_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.C4D_MCP_PORT ?? process.env.C4D_BRIDGE_PORT ?? 18710);
const token = process.env.C4D_MCP_TOKEN?.trim() || undefined;
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[mcp-cinema4d] invalid port: ${port}`);
  process.exit(1);
}

const client = new C4DClient({ host, port, token });

// Multi-instance mode (opt-in): one registry routes each call to the instance
// named by its `instance` argument, defaulting to the active one. Off, and
// every call goes straight to `client` exactly as before.
const instances = multiInstanceEnabled() ? createRegistry() : null;
const ctx: ToolContext = { instances };

function createRegistry(): InstanceRegistry {
  const raw = process.env.C4D_MCP_MAX_INSTANCES;
  const maxInstances = raw === undefined || raw.trim() === "" ? DEFAULT_MAX_INSTANCES : Number(raw);
  if (!Number.isInteger(maxInstances) || maxInstances < 1) {
    console.error(`[mcp-cinema4d] invalid C4D_MCP_MAX_INSTANCES: ${raw}`);
    process.exit(1);
  }
  return new InstanceRegistry(client, {
    host,
    basePort: port,
    token,
    maxInstances,
    exePath: process.env.C4D_MCP_EXE?.trim() || undefined,
    log: (message) => console.error(`[mcp-cinema4d] ${message}`),
  });
}

const server = new McpServer({
  name: "mcp-cinema4d",
  version,
});

// Derive MCP behaviour hints from the tool name so clients that gate on them
// can tell readers from mutators without annotating all ~70 tools by hand.
// `sample_transform` is deliberately NOT here: it drives the playhead
// (SetTime + ExecutePasses) to evaluate each frame, and with
// `restore_time:false` leaves it moved — not a read-only operation.
const READ_ONLY_NAMES = new Set(["ping", "describe", "dump_shader"]);
const DESTRUCTIVE_NAMES = new Set(["reset_scene", "close_document", "stop_instance"]);

function annotationsFor(name: string): { readOnlyHint?: boolean; destructiveHint?: boolean } {
  if (name.startsWith("list_") || name.startsWith("get_") || READ_ONLY_NAMES.has(name)) {
    return { readOnlyHint: true };
  }
  if (name.startsWith("remove_") || name.startsWith("delete_") || DESTRUCTIVE_NAMES.has(name)) {
    return { destructiveHint: true };
  }
  return {};
}

const INSTANCE_ARG = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    "Target Cinema 4D instance id (see `list_instances`). Omit to use the active instance.",
  );

function register(tool: AnyTool): void {
  // In multi-instance mode every scene tool gains an optional `instance`
  // argument. It is stripped here, before the handler runs, so tool code
  // never sees it — `batch` forwards its args to the bridge verbatim and
  // would otherwise leak it. The instance tools manage the registry itself
  // and are left untouched.
  const registry = tool.group === "instances" ? null : instances;
  const inputSchema = registry ? { ...tool.inputShape, instance: INSTANCE_ARG } : tool.inputShape;
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema,
      annotations: annotationsFor(tool.name),
    },
    async (args: unknown) => {
      try {
        let toolArgs = args as Record<string, unknown>;
        let target = client;
        if (registry) {
          const { instance, ...rest } = toolArgs;
          toolArgs = rest;
          target = registry.clientFor(instance as number | undefined);
        }
        return await tool.handler(toolArgs, target, ctx);
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
      "[mcp-cinema4d] exec_python is ENABLED via C4D_MCP_ENABLE_EXEC_PYTHON — arbitrary Python is exposed to the MCP client.",
    );
  } else {
    console.error(
      "[mcp-cinema4d] exec_python is disabled (default). Opt in with C4D_MCP_ENABLE_EXEC_PYTHON=1 on both sides.",
    );
  }
  if (instances) {
    console.error(
      "[mcp-cinema4d] multi-instance mode is ENABLED via C4D_MCP_ENABLE_MULTIINSTANCE — launch_instance can start Cinema 4D processes.",
    );
  } else {
    console.error(
      "[mcp-cinema4d] multi-instance mode is disabled (default). Opt in with C4D_MCP_ENABLE_MULTIINSTANCE=1.",
    );
  }
  if (token) {
    console.error("[mcp-cinema4d] token authentication enabled (C4D_MCP_TOKEN).");
  } else {
    console.error(
      "[mcp-cinema4d] no C4D_MCP_TOKEN set — bridge accepts any local connection. Recommended for shared workstations: set a random token on both sides.",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const shutdown = () => {
  // Sockets only: instances launched by this server keep running so a later
  // server session can pick them up again via list_instances.
  instances?.closeAll();
  client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
