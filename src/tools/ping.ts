import { defineTool, textResult } from "./define-tool.js";

export const pingTool = defineTool({
  name: "ping",
  group: "basics",
  title: "Ping C4D",
  description: "Check connectivity to the Cinema 4D bridge plugin.",
  inputShape: {},
  async handler(_args, client) {
    return textResult(await client.request<{ pong: boolean }>("ping", {}, 5_000));
  },
});
