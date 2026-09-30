import { z } from "zod";
import type { InstanceRegistry } from "../instances.js";
import { defineTool, textResult, type ToolContext } from "./define-tool.js";

const LAUNCH_DEFAULT_TIMEOUT_MS = 180_000;
const LAUNCH_MAX_TIMEOUT_MS = 600_000;
// Longer than the bridge's own hard-exit grace, so a clean shutdown is never
// cut short from this side.
const STOP_TIMEOUT_MS = 60_000;

function registryOf(ctx: ToolContext): InstanceRegistry {
  // These tools are only registered when the flag is set (see tools/index.ts),
  // so this is a belt-and-braces check rather than the gate itself.
  if (!ctx.instances) {
    throw new Error(
      "multi-instance mode is disabled (set C4D_MCP_ENABLE_MULTIINSTANCE=1 on the MCP server to enable it)",
    );
  }
  return ctx.instances;
}

export const listInstancesTool = defineTool({
  name: "list_instances",
  group: "instances",
  title: "List C4D Instances",
  description:
    "List the Cinema 4D instances this server can reach and which one is active. Instance 0 is the primary (the bridge at C4D_MCP_PORT); the others were started by `launch_instance` or discovered on the neighbouring ports. Every scene tool accepts an optional `instance` argument to target one explicitly; calls without it go to the active instance (see `set_active_instance`). Status is `ready` (bridge answers), `starting` (launched, bridge not up yet — a cold start takes 1–2 minutes) or `unreachable`.",
  inputShape: {},
  async handler(_args, _client, ctx) {
    const registry = registryOf(ctx);
    return textResult({ active: registry.active, instances: await registry.list() });
  },
});

export const setActiveInstanceTool = defineTool({
  name: "set_active_instance",
  group: "instances",
  title: "Set Active Instance",
  description:
    "Choose which Cinema 4D instance receives tool calls that omit the `instance` argument. This is session-wide state: when issuing calls in parallel against different instances, pass `instance` explicitly on each call instead of relying on it.",
  inputShape: {
    id: z.number().int().min(0).describe("Instance id from `list_instances` (0 = primary)."),
  },
  async handler(args, _client, ctx) {
    return textResult(registryOf(ctx).setActive(args.id));
  },
});

export const launchInstanceTool = defineTool({
  name: "launch_instance",
  group: "instances",
  title: "Launch C4D Instance",
  description:
    "Start another Cinema 4D process next to the running one, with its own bridge on the next free port, and return its id. Cinema 4D normally refuses a second instance of the same installation; this passes g_allowParallelInstance=true. Use it for isolated scratch work — testing a heavy operation or a render without touching the primary scene. Costs a full C4D start (1–2 minutes and several GB of RAM per instance); the executable is C4D_MCP_EXE or the newest installed version. Waits until the new bridge answers unless `wait` is false.",
  inputShape: {
    wait: z
      .boolean()
      .optional()
      .describe(
        "Wait until the new bridge answers ping (default true). With false, returns at once with status `starting`; poll `list_instances`.",
      ),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(LAUNCH_MAX_TIMEOUT_MS)
      .optional()
      .describe(
        "How long to wait for readiness in milliseconds (default 180000). On timeout the instance keeps starting in the background.",
      ),
  },
  async handler(args, _client, ctx) {
    return textResult(
      await registryOf(ctx).launch({
        wait: args.wait ?? true,
        timeoutMs: args.timeout_ms ?? LAUNCH_DEFAULT_TIMEOUT_MS,
      }),
    );
  },
});

export const stopInstanceTool = defineTool({
  name: "stop_instance",
  group: "instances",
  title: "Stop C4D Instance",
  description:
    "Quit a secondary Cinema 4D instance. Unsaved documents in it are discarded without prompting. Refuses instance 0 (the primary). Instances started by `launch_instance` quit through their bridge and are terminated if that fails; other instances only accept quit when their bridge was launched with C4D_MCP_ENABLE_MULTIINSTANCE=1.",
  inputShape: {
    id: z.number().int().min(1).describe("Instance id from `list_instances` (never 0)."),
    force: z
      .boolean()
      .optional()
      .describe(
        "Terminate the process immediately instead of asking the bridge to quit (default false).",
      ),
  },
  async handler(args, _client, ctx) {
    return textResult(
      await registryOf(ctx).stop(args.id, {
        force: args.force ?? false,
        timeoutMs: STOP_TIMEOUT_MS,
      }),
    );
  },
});
