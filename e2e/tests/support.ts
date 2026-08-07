// ABOUTME: Shared helpers for the Arribada Plane browser harness — auth guard, navigation, real-mouse drag.
// ABOUTME: Everything here is read-only unless a test explicitly opts into the scratch project.

import { expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";

/** The scratch project every write in this suite is confined to. Never write outside it. */
export const SCRATCH_PROJECT_NAME = "ZZ-E2E-SCRATCH";

/** Live team projects. A test that writes to one of these is a bug in the test. */
export const PROTECTED_PROJECT_HINTS = ["rewild", "sea turtle", "avian", "rspb", "marlin", "wwf", "pangolin", "linkit"];

export async function currentUser(request: APIRequestContext) {
  const res = await request.get("/api/users/me/");
  if (!res.ok()) return null;
  return res.json();
}

/** Fails the run early and loudly rather than letting every test time out on a login screen. */
export async function requireAuth(request: APIRequestContext) {
  const me = await currentUser(request);
  expect(me, "Not signed in. Run `pnpm auth` in e2e/ and log in once, then re-run.").toBeTruthy();
  return me;
}

export async function firstWorkspaceSlug(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/users/me/workspaces/");
  expect(res.ok(), "could not list workspaces").toBeTruthy();
  const list = await res.json();
  expect(Array.isArray(list) && list.length > 0, "no workspace on this account").toBeTruthy();
  return list[0].slug;
}

export async function projects(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/workspaces/${slug}/projects/`);
  expect(res.ok(), "could not list projects").toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : (body.results ?? []);
}

export function isProtected(name: string) {
  const n = name.toLowerCase();
  return PROTECTED_PROJECT_HINTS.some((h) => n.includes(h));
}

/**
 * The sidebar folder tree uses native HTML5 drag events (not pragmatic-drag-and-drop),
 * and it reads the drag source from a React ref set in `onDragStart` — a synthesised
 * `drop` with no real `dragstart` resolves to null and silently does nothing. So the
 * drag has to be a genuine mouse gesture with enough intermediate moves that Chromium
 * promotes it to a native drag.
 */
export async function realMouseDrag(page: Page, source: Locator, target: Locator, steps = 25) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag source or target is not visible");

  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // A few small moves first: Chromium needs to cross the drag threshold before it
  // starts a native drag session at all.
  await page.mouse.move(sx + 6, sy + 6, { steps: 5 });
  await page.mouse.move(tx, ty, { steps });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

/** The folder tree exposes no test ids; a row is the nearest draggable ancestor of its label. */
export function draggableRowFor(page: Page, text: string): Locator {
  return page.getByText(text, { exact: false }).first().locator('xpath=ancestor::div[@draggable="true"][1]');
}

export async function gotoAndSettle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

/** Console/network noise is a finding in its own right on a first-ever run. */
export function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 400)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}
