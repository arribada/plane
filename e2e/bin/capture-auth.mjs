// ABOUTME: Opens a real browser so a human can log in once, then saves the session.
// ABOUTME: No credential is ever read, typed or stored by this script — only the resulting cookies.

import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE_URL = process.env.PLANE_BASE_URL ?? "https://plane.arribada.org";
const STORAGE_STATE = resolve(here, ".auth/storageState.json");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const browser = await chromium.launch({ headless: false, channel: process.env.PLANE_CHROME_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(BASE_URL);

console.log(`\n  A browser window is open on ${BASE_URL}.`);
console.log("  Log in there (SSO included). Nothing you type is read by this script.");
await ask("  When you can see the workspace, press Enter here to save the session… ");

if (!existsSync(dirname(STORAGE_STATE))) mkdirSync(dirname(STORAGE_STATE), { recursive: true });
await context.storageState({ path: STORAGE_STATE });
console.log(`\n  Saved to ${STORAGE_STATE}. Run \`pnpm test\` now.\n`);

rl.close();
await browser.close();
