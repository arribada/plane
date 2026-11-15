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
import { OFFLINE_MESSAGE } from "@/plane-web/services/api-error";
import type { TPortfolioDragContext } from "./drag-target";
import {
  canMovePortfolioRow,
  describeDragFailure,
  describeRefusal,
  portfolioRowRefusal,
  routePortfolioDrag,
} from "./drag-target";

type TGates = {
  locked?: string[];
  /** Projects whose plan is the lead's, and this is not the lead. */
  leadOnly?: string[];
  /** Projects with `allow_edit_others` off. */
  ownOnly?: string[];
  /** Items assigned to the current user. */
  mine?: string[];
};

const context = (lockedOrGates: string[] | TGates = []): TPortfolioDragContext => {
  const gates: TGates = Array.isArray(lockedOrGates) ? { locked: lockedOrGates } : lockedOrGates;
  return {
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
    isProjectLocked: (projectId) => (gates.locked ?? []).includes(projectId),
    canEditPlan: (projectId) => !(gates.leadOnly ?? []).includes(projectId),
    allowEditOthers: (projectId) => !(gates.ownOnly ?? []).includes(projectId),
    isAssignedToMe: (itemId) => (gates.mine ?? []).includes(itemId),
  };
};

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

  describe("the plan's own gates, the same ones the per-project timeline applies", () => {
    it("refuses every row of a lead-only plan when this is not the lead, and lets the rest move", () => {
      // `can_edit_plan` is the server's answer for THIS user; drawing a bar
      // draggable against it is drawing one the server will snap back.
      expect(portfolioRowRefusal("p1", context({ leadOnly: ["p1"] }))).toBe("lead-only");
      expect(portfolioRowRefusal("i1", context({ leadOnly: ["p1"] }))).toBe("lead-only");
      expect(canMovePortfolioRow("p2", context({ leadOnly: ["p1"] }))).toBe(true);
      expect(canMovePortfolioRow("i3", context({ leadOnly: ["p1"] }))).toBe(true);
    });

    it("lets a lead-only plan move when the server says this user may", () => {
      expect(canMovePortfolioRow("p1", context({ leadOnly: [] }))).toBe(true);
      expect(canMovePortfolioRow("i1", context({ leadOnly: [] }))).toBe(true);
    });

    it("refuses somebody else's item when the project only lets assignees move their own", () => {
      expect(portfolioRowRefusal("i1", context({ ownOnly: ["p1"] }))).toBe("not-yours");
    });

    it("lets an assignee move their own item under the same rule", () => {
      expect(canMovePortfolioRow("i1", context({ ownOnly: ["p1"], mine: ["i1"] }))).toBe(true);
      expect(portfolioRowRefusal("i2", context({ ownOnly: ["p1"], mine: ["i1"] }))).toBe("not-yours");
    });

    it("does not apply the assignee rule to a project row, which is assigned to nobody", () => {
      expect(canMovePortfolioRow("p1", context({ ownOnly: ["p1"] }))).toBe(true);
    });

    it("lets everything move under the permissive default, as when a project does not send the gates", () => {
      expect(canMovePortfolioRow("i1", context({ ownOnly: ["p1"], mine: ["i1"] }))).toBe(true);
      expect(canMovePortfolioRow("i2", context())).toBe(true);
    });

    it("reads a missing gate as allowed — a backend that has not been redeployed is not a refusal", () => {
      const older: TPortfolioDragContext = {
        kindOf: () => "item",
        projectOf: () => "p1",
        isProjectLocked: () => false,
      };
      expect(canMovePortfolioRow("i1", older)).toBe(true);
    });

    it("answers the lock before the plan gates, so one refusal is named rather than three", () => {
      expect(portfolioRowRefusal("i1", context({ locked: ["p1"], leadOnly: ["p1"], ownOnly: ["p1"] }))).toBe("locked");
    });
  });
});

describe("describeRefusal names the plan gates", () => {
  it("says it is the lead's plan", () => {
    expect(describeRefusal([{ id: "i1", reason: "lead-only" }])).toMatch(/lead/);
  });

  it("says the item is not theirs", () => {
    expect(describeRefusal([{ id: "i1", reason: "not-yours" }])).toMatch(/not yours/);
  });
});

describe("describeDragFailure", () => {
  const LEAD_ONLY = "This project is set so that only its lead (or a workspace admin) changes the plan.";

  it("carries the server's sentence from a normalised 403 (the project window's endpoint)", () => {
    const said = describeDragFailure({ status: 403, offline: false, error: "Only the lead.", detail: LEAD_ONLY });
    expect(said).toContain(LEAD_ONLY);
    expect(said).toContain("put back");
  });

  it("carries the server's sentence from a bare body (the item dates' endpoint strips the status)", () => {
    expect(describeDragFailure({ error: "Only the project lead can change the plan.", detail: LEAD_ONLY })).toContain(
      LEAD_ONLY
    );
  });

  it("says the plan is not theirs on a 403 that sent no sentence", () => {
    expect(describeDragFailure({ status: 403, offline: false })).toMatch(/not yours/);
  });

  it("names the outage rather than blaming permissions when offline", () => {
    const said = describeDragFailure({ status: undefined, offline: true });
    expect(said).toContain(OFFLINE_MESSAGE);
    expect(said).not.toMatch(/not yours/);
  });

  it("falls back to the plain statement of what happened when nothing came back", () => {
    expect(describeDragFailure(undefined)).toBe("The dates were put back as they were.");
    expect(describeDragFailure("<html>502</html>")).toBe("The dates were put back as they were.");
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
