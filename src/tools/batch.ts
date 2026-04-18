import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

const BATCH_DEFAULT_PER_OP_MS = 3_000;
const BATCH_BASE_TIMEOUT_MS = 30_000;
const BATCH_MAX_TIMEOUT_MS = 15 * 60_000;

export const batchTool = defineTool({
  name: "batch",
  group: "script",
  title: "Batch Execute",
  description:
    "Run many generic ops in one RPC. Each op is applied in order; by default failures are recorded per op and the batch continues. The whole batch is wrapped in a single undo group. Useful for 'apply X to all matching entities' workflows (pair with list_entities + name_pattern to get handles).",
  inputShape: {
    ops: z
      .array(
        z.object({
          op: z
            .string()
            .describe(
              "Handler name: set_params, create_entity, set_keyframe, remove_entity, describe, get_params, get_container, list_entities, set_document, exec_python. (batch itself is not allowed inside batch.)",
            ),
          args: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Arguments passed to the handler."),
          timeout_ms: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional per-op timeout hint (summed into the outer request timeout)."),
        }),
      )
      .describe("Operations to execute in order."),
    stop_on_error: z
      .boolean()
      .optional()
      .describe("Abort on first error (default false — errors are collected per op)."),
  },
  async handler(args, client) {
    // Outer timeout = base + sum of op budgets (explicit or defaulted), capped.
    const opsBudget = args.ops.reduce(
      (sum, op) => sum + (op.timeout_ms ?? BATCH_DEFAULT_PER_OP_MS),
      0,
    );
    const timeout = Math.min(BATCH_MAX_TIMEOUT_MS, BATCH_BASE_TIMEOUT_MS + opsBudget);
    return textResult(await client.request("batch", args, timeout));
  },
});
