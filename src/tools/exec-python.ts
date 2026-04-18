import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

/**
 * Whether this MCP server process has opted IN to exposing exec_python.
 * Default is off — the bridge also enforces the check server-side so neither
 * half alone can be bypassed. Enable with C4D_MCP_ENABLE_EXEC_PYTHON=1 on both
 * the MCP server and the Cinema 4D process.
 */
export function execPythonEnabled(): boolean {
  const flag = process.env.C4D_MCP_ENABLE_EXEC_PYTHON ?? "";
  return ["1", "true", "yes", "on"].includes(flag.trim().toLowerCase());
}

export const execPythonTool = defineTool({
  name: "exec_python",
  group: "script",
  title: "Execute Python in C4D",
  description:
    "Run arbitrary Python code on Cinema 4D's main thread. SECURITY: this tool can touch any file the C4D process can reach — only expose it to trusted clients. Disabled by default; enable with C4D_MCP_ENABLE_EXEC_PYTHON=1 on both sides. Set `result = <value>` in your code to return data; stdout and stderr are captured.",
  inputShape: {
    code: z
      .string()
      .describe(
        "Python source to execute on Cinema 4D's main thread. Preset globals: `c4d`, `documents`, `doc` (active doc), `op` (active object). Assign to `result` to return a value. stdout/stderr are captured.",
      ),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional timeout in milliseconds (default 30000)."),
  },
  async handler(args, client) {
    const timeout = args.timeout_ms ?? 30_000;
    return textResult(await client.request("exec_python", { code: args.code }, timeout));
  },
});
