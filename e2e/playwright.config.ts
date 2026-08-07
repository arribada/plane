// ABOUTME: Playwright config for the Arribada Plane browser harness.
// ABOUTME: Targets a live deployment (default plane.arribada.org) and reuses a captured login.

import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** The deployment under test. Override with PLANE_BASE_URL for staging or a local stack. */
export const BASE_URL = process.env.PLANE_BASE_URL ?? "https://plane.arribada.org";

/** Where `pnpm auth` writes the logged-in browser state. Never commit this file. */
export const STORAGE_STATE = resolve(here, ".auth/storageState.json");

export default defineConfig({
  testDir: resolve(here, "tests"),
  outputDir: resolve(here, "test-results"),
  // Production is shared, mutable and rate-limited: one browser at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: resolve(here, "playwright-report"), open: "never" }]],
  use: {
    baseURL: BASE_URL,
    storageState: existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
    viewport: { width: 1600, height: 1000 },
    screenshot: "only-on-failure",
    video: "off",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.PLANE_CHROME_CHANNEL || undefined },
    },
  ],
});
