import { chromium, defineConfig } from "@playwright/test";
import { resolveChromiumPath } from "./scripts/browser";

export default defineConfig({
  testDir: "./tests",
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    launchOptions: {
      executablePath: resolveChromiumPath({
        override: process.env.CHROMIUM_PATH,
        managedPath: chromium.executablePath(),
      }),
      args: ["--no-sandbox"],
    },
    trace: {
      mode: "retain-on-failure",
      screenshots: false,
      snapshots: true,
      sources: true,
    },
  },
  webServer: {
    command: "npm exec vite preview -- --host 0.0.0.0 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
});
