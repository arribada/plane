/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Is this block draggable, and where do its dates go."
 *
 * The gesture needs a real mouse and is not testable here. What IS testable is
 * every rule the gesture depends on, and the portfolio had none of them: each bar
 * on the board — folder bands and locked projects included — was handed a bare
 * `true`, and the dates it produced were routed nowhere at all.
 */
import { describe, expect, it } from "vitest";
import type { TPortfolioDragContext } from "./drag-target";
import { canMovePortfolioRow, describeRefusal, portfolioRowRefusal, routePortfolioDrag } from "./drag-target";

const context = (locked: string[] = []): TPortfolioDragContext => ({
  kindOf: (id) => {
    if (id.startsWith("folder:")) return "folder";
    if (id.startsWith("p")) return "project";
    if (id.startsWith("i")) return "item";
    return "unknown";
  },
  projectOf: (id) => {
    if (id.startsWith("p")) return id;
    if (id === "i1" || id === "i2") return "p1";
    if (id === "i3") return "p2";
    return undefined;
  },
  isProjectLocked: (projectId) => locked.includes(projectId),
});

describe("portfolioRowRefusal", () => {
  it("lets a project row move", () => {
    expect(canMovePortfolioRow("p1", context())).toBe(true);
  });

  it("lets a work item row move", () => {
    expect(canMovePortfolioRow("i1", context())).toBe(true);
  });

  it("refuses a folder band, which has no dates", () => {
    expect(portfolioRowRefusal("folder:x", context())).toBe("folder-row");
  });

  it("refuses a row in a project whose plan is locked", () => {
    // The same rule the per-project timeline applies. Two timelines that
    // disagree about whether a plan is frozen teach people to distrust the lock.
    expect(portfolioRowRefusal("p1", context(["p1"]))).toBe("locked");
    expect(portfolioRowRefusal("i1", context(["p1"]))).toBe("locked");
    expect(canMovePortfolioRow("i3", context(["p1"]))).toBe(true);
  });

  it("refuses a row the board no longer holds", () => {
    expect(portfolioRowRefusal("gone", context())).toBe("unknown-row");
  });

  it("refuses an item whose owning project cannot be determined", () => {
    expect(portfolioRowRefusal("i9", context())).toBe("no-project");
  });
});

describe("routePortfolioDrag", () => {
  it("sends a project window to the schedule and a work item to its own project", () => {
    const route = routePortfolioDrag(
      [
        { id: "p1", start_date: "2026-08-10", target_date: "2026-08-14" },
        { id: "i1", start_date: "2026-08-11" },
      ],
      context()
    );
    expect(route.projects).toEqual([{ id: "p1", start_date: "2026-08-10", target_date: "2026-08-14" }]);
    expect(route.itemsByProject).toEqual([{ projectId: "p1", updates: [{ id: "i1", start_date: "2026-08-11" }] }]);
  });

  it("groups work items by project, because the endpoint that takes them is scoped to one", () => {
    const route = routePortfolioDrag(
      [
        { id: "i1", target_date: "2026-08-11" },
        { id: "i3", target_date: "2026-08-12" },
        { id: "i2", target_date: "2026-08-13" },
      ],
      context()
    );
    expect(route.itemsByProject).toEqual([
      {
        projectId: "p1",
        updates: [
          { id: "i1", target_date: "2026-08-11" },
          { id: "i2", target_date: "2026-08-13" },
        ],
      },
      { projectId: "p2", updates: [{ id: "i3", target_date: "2026-08-12" }] },
    ]);
  });

  it("drops an update carrying no dates rather than writing an empty patch", () => {
    const route = routePortfolioDrag([{ id: "p1" }], context());
    expect(route.projects).toEqual([]);
    expect(route.refused).toEqual([]);
  });

  it("refuses a locked project's dates and says which rule stopped them", () => {
    const route = routePortfolioDrag([{ id: "p1", start_date: "2026-08-10" }], context(["p1"]));
    expect(route.projects).toEqual([]);
    expect(route.refused).toEqual([{ id: "p1", reason: "locked" }]);
    expect(describeRefusal(route.refused)).toContain("locked");
  });

  it("stays quiet about a folder band, which nobody expected to move", () => {
    const route = routePortfolioDrag([{ id: "folder:x", start_date: "2026-08-10" }], context());
    expect(route.refused).toEqual([{ id: "folder:x", reason: "folder-row" }]);
    expect(describeRefusal(route.refused)).toBeNull();
  });
});
