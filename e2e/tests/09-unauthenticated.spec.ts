// ABOUTME: What a logged-out visitor sees — the sign-in page, and the published timeline link.
// ABOUTME: Runs with no storage state, so it is the one spec that works before `pnpm auth`.

import { test, expect } from "@playwright/test";
import { gotoAndSettle, collectPageErrors } from "./support";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("logged out", () => {
  test("the sign-in page renders and offers a way in", async ({ page }) => {
    const errors = collectPageErrors(page);
    await gotoAndSettle(page, "/");
    await expect(page.locator("body")).not.toBeEmpty();
    await page.screenshot({ path: "screenshots/logged-out-landing.png", fullPage: true });
    expect(
      errors.filter((e) => e.startsWith("HTTP 5")),
      errors.join("\n")
    ).toEqual([]);
  });

  test("a private workspace page does not leak content to a stranger", async ({ page }) => {
    await gotoAndSettle(page, "/arribada/portfolio/");
    const text = await page.locator("body").innerText();
    expect(text.toLowerCase()).not.toContain("rewild");
  });

  test("an unknown published-timeline anchor is refused, not 500", async ({ page }) => {
    const res = await page.goto("/public/timeline/definitely-not-a-real-anchor/", {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status(), "a bad anchor should not 5xx").toBeLessThan(500);
    await page.screenshot({ path: "screenshots/public-timeline-bad-anchor.png", fullPage: true });
  });
});
