import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  timeout: 45000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.HERMES_VOICE_TEST_URL || "http://127.0.0.1:8780",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
