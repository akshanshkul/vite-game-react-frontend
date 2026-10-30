import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    testTimeout: 30000,
    include: ["packages/**/*.spec.ts", "scripts/tests/**/*.spec.ts"],
    coverage: { provider: "v8", include: ["packages/engine/src/**"] },
  },
});
