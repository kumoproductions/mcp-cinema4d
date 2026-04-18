import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Cinema 4D is single-threaded: run suites sequentially to avoid racing
    // over the one shared document.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 90_000,
    hookTimeout: 60_000,
    globals: false,
    reporters: "default",
  },
});
