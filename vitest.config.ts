import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
