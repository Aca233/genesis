import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    clearMocks: true,
    fileParallelism: false,
    testTimeout: 15_000,
    setupFiles: [path.resolve(__dirname, "src/test/require-test-database.ts")],
  },
  resolve: {
    alias: [
      { find: "server-only", replacement: path.resolve(__dirname, "src/test/server-only.ts") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
});
