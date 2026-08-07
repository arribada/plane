// ABOUTME: Checks the Finance page renders and that its money figures agree with each other.
// ABOUTME: Strictly read-only — it reads every visible project's budget and asserts the invariants.

import { test, expect } from "@playwright/test";
import { requireAuth, firstWorkspaceSlug, projects, gotoAndSettle, collectPageErrors } from "./support";

test.describe("finance", () => {
  let slug: string;

  test.beforeAll(async ({ request }) => {
    await requireAuth(request);
    slug = await firstWorkspaceSlug(request);
  });

  test("every project's budget is self-consistent", async ({ request }) => {
    const list = await projects(request, slug);
    const failures: string[] = [];

    for (const p of list) {
      const res = await request.get(`/api/arribada/workspaces/${slug}/projects/${p.id}/budget/`);
      if (res.status() === 403) continue; // not on this project
      if (!res.ok()) {
        failures.push(`${p.name}: budget endpoint ${res.status()}`);
        continue;
      }
      const b = await res.json();

      // 1. Cost-per-sprint rows must account for the whole committed figure.
      //    This is the invariant test_cost_by_cycle.py pins server-side.
      const cycles = b?.by_cycle?.cycles ?? [];
      const committed = b?.allocation?.committed;
      const unconvertible = b?.by_cycle?.unconvertible ?? [];
      if (cycles.length && typeof committed === "number" && unconvertible.length === 0) {
        const sum = cycles.reduce((a: number, c: any) => a + (c.amount ?? 0), 0);
        if (Math.abs(sum - committed) > 0.05) {
          failures.push(`${p.name}: sprint rows sum to ${sum.toFixed(2)} but committed is ${committed.toFixed(2)}`);
        }
      }

      // 2. The display block's parts must sum to its own whole.
      const d = b?.display;
      if (d && typeof d.committed === "number") {
        const parts = (d.labour_total ?? 0) + (d.expenses_planned ?? 0) + (d.expenses_actual ?? 0);
        if (Math.abs(parts - d.committed) > 0.05) {
          failures.push(
            `${p.name}: display labour+planned+actual = ${parts.toFixed(2)} but committed = ${d.committed.toFixed(2)}`
          );
        }
      }

      // 3. remaining must equal allocation - committed.
      const a = b?.allocation;
      if (a && typeof a.amount === "number" && typeof a.committed === "number" && typeof a.remaining === "number") {
        if (Math.abs(a.amount - a.committed - a.remaining) > 0.05) {
          failures.push(`${p.name}: amount - committed !== remaining`);
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("the finance page renders its sections", async ({ page, request }) => {
    const list = await projects(request, slug);
    const p = list[0];
    const errors = collectPageErrors(page);

    await gotoAndSettle(page, `/${slug}/projects/${p.id}/finance/`);

    await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
    await expect(page.getByText("Budget", { exact: true })).toBeVisible();
    await expect(page.getByText("Couldn't read this project's costs.", { exact: false })).toHaveCount(0);

    expect(
      errors.filter((e) => e.startsWith("HTTP 5")),
      errors.join("\n")
    ).toEqual([]);
  });
});
