/**
 * Browser tests: the bridge in a real browser, against the built app and a seeded
 * Postgres. Run them with `make test-browser`, which builds the app first. Where they
 * sit among the other test areas is in docs/testing.md.
 *
 * The global setup starts the database, the app and the browser, then publishes the
 * app's address and the browser's endpoint through the environment. Workers start
 * after it and read this file again, so `use` picks both up there. In the runner's own
 * first read the two are unset, which is fine: the runner launches no browser itself.
 */

import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "test-results",
  forbidOnly: CI,
  // No retries: a test that passes only on a second try is a flaky test, and a
  // retry would hide it.
  retries: 0,
  reporter: CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    connectOptions: process.env.E2E_BROWSER_WS_ENDPOINT
      ? { wsEndpoint: process.env.E2E_BROWSER_WS_ENDPOINT }
      : undefined,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
