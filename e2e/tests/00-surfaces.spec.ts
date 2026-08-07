// ABOUTME: Smoke sweep — every fork surface loads, renders its own heading, and logs no 5xx.
// ABOUTME: Read-only; this is the first thing to run after a deploy.

import { test, expect } from "@playwright/test";
import { requireAuth, firstWorkspaceSlug, projects, gotoAndSettle, collectPageErrors } from "./support";

test.describe("fork surfaces load", () => {
  let slug: string;
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    await requireAuth(request);
    slug = await firstWorkspaceSlug(request);
    const list = await projects(request, slug);
    projectId = list[0]?.id;
  });

  const workspaceSurfaces: [string, string | RegExp][] = [
    ["portfolio", /Portfolio/i],
    ["github-triage", /triage|GitHub/i],
    ["workload", /Workload/i],
    ["stickies", /Stick/i],
  ];

  for (const [path, heading] of workspaceSurfaces) {
    test(`workspace: /${path}`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await gotoAndSettle(page, `/${slug}/${path}/`);
      await expect(page.locator("body")).toContainText(heading, { timeout: 20_000 });
      // A route that was tree-shaken out renders the app shell and nothing else.
      expect(page.url(), "redirected away — route probably not declared").toContain(path);
      expect(
        errors.filter((e) => e.startsWith("HTTP 5")),
        errors.join("\n")
      ).toEqual([]);
    });
  }

  const projectSurfaces = ["overview", "finance", "issues", "cycles", "modules"];
  for (const path of projectSurfaces) {
    test(`project: /${path}`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await gotoAndSettle(page, `/${slug}/projects/${projectId}/${path}/`);
      expect(page.url()).toContain(path);
      expect(
        errors.filter((e) => e.startsWith("HTTP 5")),
        errors.join("\n")
      ).toEqual([]);
    });
  }

  test("no untranslated i18n keys leak onto a page", async ({ page }) => {
    // `t()` renders the missing key verbatim in this fork, so a raw key on screen
    // looks like `sidebar.finance` rather than a word.
    for (const path of ["portfolio", "workload", "github-triage", "stickies"]) {
      await gotoAndSettle(page, `/${slug}/${path}/`);
      const text = await page.locator("body").innerText();
      const raw = text.match(/\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,4}\b/g) ?? [];
      const suspects = raw.filter((s) => !s.includes(" ") && !/\.(com|org|io|png|svg|js)$/.test(s));
      expect(suspects, `raw i18n keys on /${path}: ${suspects.join(", ")}`).toEqual([]);
    }
  });
});
