import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  test: {
    environment: "jsdom",
    include: ["src/renderer-react/**/*.test.{ts,tsx}"],
    clearMocks: true
  }
});
