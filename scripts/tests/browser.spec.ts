import { it, expect } from "vitest";
import { resolveChromiumPath } from "../browser";
const managedPath = "/playwright/chromium/chrome";
it("uses Playwright-managed Chromium without assuming a Linux path", () => {
  expect(
    resolveChromiumPath({
      managedPath,
      exists: (p) => p === managedPath || p === "/usr/bin/chromium",
    }),
  ).toBeUndefined();
});
it("retains the system Chromium fallback for cloud machines", () => {
  expect(
    resolveChromiumPath({
      managedPath,
      platform: "linux",
      exists: (p) => p === "/usr/bin/chromium",
    }),
  ).toBe("/usr/bin/chromium");
});
it("honors a valid explicit browser override", () => {
  expect(
    resolveChromiumPath({
      managedPath,
      override: "/custom/chrome",
      exists: (p) => p === "/custom/chrome",
    }),
  ).toBe("/custom/chrome");
});
it("rejects invalid overrides with installation instructions", () => {
  expect(() =>
    resolveChromiumPath({
      managedPath,
      override: "/missing/chrome",
      exists: () => false,
    }),
  ).toThrow("npx playwright install");
});
it("leaves missing managed-browser diagnostics to Playwright on any platform", () => {
  expect(
    resolveChromiumPath({
      managedPath,
      platform: "darwin",
      exists: () => false,
    }),
  ).toBeUndefined();
  expect(
    resolveChromiumPath({
      managedPath,
      platform: "linux",
      exists: () => false,
    }),
  ).toBeUndefined();
});
