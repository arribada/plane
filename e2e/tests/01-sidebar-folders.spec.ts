// ABOUTME: Drives the sidebar project-folder tree with a real mouse — create, nest, drop, reload.
// ABOUTME: Writes only folders it creates itself (ZZ-E2E-*) and removes them again.

import { test, expect } from "@playwright/test";
import { requireAuth, firstWorkspaceSlug, realMouseDrag, draggableRowFor, gotoAndSettle } from "./support";

const A = "ZZ-E2E-Folder-A";
const B = "ZZ-E2E-Folder-B-nested";

test.describe("sidebar project folders", () => {
  let slug: string;

  test.beforeAll(async ({ request }) => {
    await requireAuth(request);
    slug = await firstWorkspaceSlug(request);
  });

  test("a folder can be created, nested, and a project dropped into it survives reload", async ({ page }) => {
    // Create / rename / delete all go through window.prompt and window.confirm.
    const answers: string[] = [];
    page.on("dialog", async (d) => {
      const next = answers.shift();
      await d.accept(next ?? "");
    });

    await gotoAndSettle(page, `/${slug}/`);

    // The tree only shows the "Folders" header once at least one folder exists;
    // with none it shows a single "New project folder" button instead.
    const header = page.getByText("Folders", { exact: true });
    const createTop = (await header.count())
      ? page.getByTitle("New folder")
      : page.getByRole("button", { name: "New project folder" });

    answers.push(A);
    await createTop.click();
    await expect(page.getByText(A)).toBeVisible({ timeout: 15_000 });

    // A subfolder, so we can prove a drop onto a *nested* folder works too.
    const rowA = draggableRowFor(page, A);
    await rowA.hover();
    answers.push(B);
    await rowA.getByTitle("New subfolder").click();
    await expect(page.getByText(B)).toBeVisible({ timeout: 15_000 });

    // Pick a project from the sidebar's own project list to drag in.
    const assign = page.waitForResponse(
      (r) => r.url().includes("/project-folders/assign/") && r.request().method() === "PUT"
    );

    // Expand A so B is visible as a drop target.
    await page.getByRole("button", { name: new RegExp(A) }).click();

    const projectRow = page.locator('[draggable="true"]').filter({ hasNotText: A }).filter({ hasNotText: B }).first();
    const projectName = (await projectRow.innerText()).trim().split("\n")[0];

    await realMouseDrag(page, projectRow, draggableRowFor(page, B));

    const res = await assign;
    const body = await res.json().catch(() => ({}));
    expect(res.status(), `assign returned ${res.status()}: ${JSON.stringify(body)}`).toBe(200);
    expect(body.folder_id, "the drop filed the project under a null folder").toBeTruthy();
    expect(body.project_id, "the drop sent a null project id").toBeTruthy();

    // It has to still be there after a reload — an optimistic UI that never persisted
    // is exactly the failure this feature has had before.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: new RegExp(A) }).click();
    await page.getByRole("button", { name: new RegExp(B) }).click();
    await expect(page.getByText(projectName, { exact: false }).first()).toBeVisible();
  });

  test.afterAll(async ({ request }) => {
    // Remove only folders this spec made.
    const res = await request.get(`/api/arribada/workspaces/${slug}/project-folders/`);
    if (!res.ok()) return;
    const folders = await res.json();
    for (const f of folders) {
      if (typeof f.name === "string" && f.name.startsWith("ZZ-E2E-")) {
        await request.delete(`/api/arribada/workspaces/${slug}/project-folders/${f.id}/`);
      }
    }
  });
});
