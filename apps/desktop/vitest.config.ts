import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    // This suite is integration-heavy: several files render thousands of jsdom
    // nodes (500-row timelines, full Workbench) and some exercise real git and
    // filesystem work. Running every file at full core count starves them and
    // makes ordinary 5s per-test timeouts fire on tests that take ~300ms alone.
    // Bound the pool and give tests headroom instead of retrying flakes.
    maxWorkers: 4,
    testTimeout: 20000
  }
});
