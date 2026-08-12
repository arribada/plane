/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The portfolio half of two reports, a session apart and the same defect twice:
 *
 *   "Dans la date d'un item que je change après avoir cliqué depuis portfolio […],
 *    je change la date et ça ne s'actualise pas sur le diagramme."
 *   "sur mon portfolio je mets une task à done et ça ne s'actualise pas
 *    automatiquement, je dois refresh."
 *
 * The peek panel opened from a portfolio bar is Plane's, so it writes Plane's
 * `issuesMap`; the bar is drawn from the portfolio store's own `itemMap`. The
 * assertions below are about the join between them, so the real `PortfolioStore`
 * is used on one side — `applyItemFields`, `removeItem`, `getItem` and
 * `getRowById` are the actual ones the board draws through — and a miniature of
 * Plane's issue store on the other, because all the mirror reads from it is one
 * map.
 */
import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { mirrorIssueChangesIntoPortfolio, type TPortfolioMirrorResolvers } from "./portfolio-issue-mirror";
import { PortfolioStore } from "./portfolio.store";
import type { RootStore } from "./root.store";

type TFakeRoot = {
  issue: { issues: { issuesMap: Record<string, Partial<TIssue>> } };
  portfolio: PortfolioStore;
};

let root: TFakeRoot;
let dispose: () => void;

/** The three things `issuesMap` holds as ids and a portfolio row holds as
 *  objects. Named so a test can say what the cycle store would have answered. */
const resolvers: TPortfolioMirrorResolvers = {
  getCycleName: (id) => ({ c1: "Sprint 12", c2: "Sprint 13" })[id],
  getModuleName: (id) => ({ m1: "Firmware", m2: "Antenna", m3: "Zephyr" })[id],
  getMember: (id) => ({ u1: { name: "Ruby", avatar: null }, u2: { name: "Geoffrey", avatar: "g.png" } })[id],
};

const seedIssue = (id: string, fields: Partial<TIssue> = {}) => {
  root.issue.issues.issuesMap[id] = {
    id,
    name: id,
    start_date: "2026-09-01",
    target_date: "2026-09-05",
    ...fields,
  };
};

const seedPortfolioItem = (id: string, projectId: string, fields: Record<string, unknown> = {}) => {
  runInAction(() => {
    root.portfolio.itemMap[id] = {
      id,
      name: id,
      start_date: "2026-09-01",
      target_date: "2026-09-05",
      ...fields,
    } as PortfolioStore["itemMap"][string];
    root.portfolio.itemProjectId[id] = projectId;
  });
};

const seedProject = (id: string, fields: Record<string, unknown> = {}) => {
  runInAction(() => {
    root.portfolio.projectMap[id] = {
      id,
      name: id,
      item_count: 2,
      completed_item_count: 0,
      undated_item_count: 0,
      ...fields,
    } as PortfolioStore["projectMap"][string];
  });
};

/** The reaction settles synchronously inside a mobx action, so nothing here needs
 *  to await — but it does need the write to be one transaction, as the store's own
 *  writes are. */
const write = (fn: () => void) => runInAction(fn);

beforeEach(() => {
  root = {
    issue: { issues: { issuesMap: observable({} as Record<string, Partial<TIssue>>) } },
    portfolio: new PortfolioStore(),
  };
  dispose = mirrorIssueChangesIntoPortfolio(root as unknown as RootStore, resolvers);
});

afterEach(() => {
  dispose();
});

/** Both stores holding the row, which is the state every propagation test starts
 *  from — the mirror deliberately does nothing on the first snapshot. */
const bothHold = (id = "i1", projectId = "p1", issue: Partial<TIssue> = {}, item: Record<string, unknown> = {}) => {
  seedProject(projectId);
  seedPortfolioItem(id, projectId, item);
  write(() => seedIssue(id, issue));
};

describe("a date edited in the peek panel opened from a portfolio bar", () => {
  beforeEach(() => bothHold());

  it("moves the bar", () => {
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-12";
    });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-12");
  });

  it("moves both ends", () => {
    write(() => {
      root.issue.issues.issuesMap.i1.start_date = "2026-08-24";
      root.issue.issues.issuesMap.i1.target_date = "2026-08-28";
    });
    const row = root.portfolio.getRowById("i1");
    expect(row?.start_date).toBe("2026-08-24");
    expect(row?.target_date).toBe("2026-08-28");
  });

  it("follows the rollback when the write is refused", () => {
    // Plane patches the store first and puts the old value back if the PATCH
    // fails. The bar must not be left asserting a date the server rejected.
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-12";
    });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-12");
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-05";
    });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-05");
  });

  it("clears a date that was unset", () => {
    write(() => {
      root.issue.issues.issuesMap.i1.start_date = null;
    });
    expect(root.portfolio.getRowById("i1")?.start_date).toBeNull();
  });

  it("leaves every other row alone", () => {
    seedPortfolioItem("i2", "p1", { start_date: "2026-10-01", target_date: "2026-10-02" });
    write(() => seedIssue("i2", { start_date: "2026-10-01", target_date: "2026-10-02" }));
    const before = root.portfolio.getItem("i2");
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-30";
    });
    // Same object, not merely equal dates: a rewrite of every row would churn the
    // identity the timeline's block map compares against.
    expect(root.portfolio.getItem("i2")).toBe(before);
  });
});

/**
 * THE REPORTED DEFECT. "Je mets une task à done et ça ne s'actualise pas."
 *
 * `state_id` is what decides the hatch, the tick and — when the board is coloured
 * by state — the bar's whole colour. It was the second field of nine that the
 * mirror did not carry.
 */
describe("marking a work item done from the peek panel", () => {
  beforeEach(() => bothHold("i1", "p1", { state_id: "doing" }, { state_id: "doing" }));

  it("reaches the bar", () => {
    write(() => {
      root.issue.issues.issuesMap.i1.state_id = "done";
    });
    expect(root.portfolio.getItem("i1")?.state_id).toBe("done");
  });

  it("follows a rollback, and a second change after it", () => {
    write(() => {
      root.issue.issues.issuesMap.i1.state_id = "done";
    });
    write(() => {
      root.issue.issues.issuesMap.i1.state_id = "doing";
    });
    expect(root.portfolio.getItem("i1")?.state_id).toBe("doing");
    write(() => {
      root.issue.issues.issuesMap.i1.state_id = "cancelled";
    });
    expect(root.portfolio.getItem("i1")?.state_id).toBe("cancelled");
  });
});

describe("the rest of what the board draws a row from", () => {
  it("carries priority, which is a colour axis AND a filter", () => {
    bothHold("i1", "p1", { priority: "low" }, { priority: "low" });
    write(() => {
      root.issue.issues.issuesMap.i1.priority = "urgent";
    });
    expect(root.portfolio.getItem("i1")?.priority).toBe("urgent");
  });

  it("carries the name, which is written inside the bar and again in the sidebar", () => {
    bothHold();
    write(() => {
      root.issue.issues.issuesMap.i1.name = "Renamed in the panel";
    });
    expect(root.portfolio.getRowById("i1")?.name).toBe("Renamed in the panel");
  });

  it("carries parent_id, so re-parenting re-nests the row", () => {
    bothHold("i1", "p1", { parent_id: null }, { parent_id: null });
    write(() => {
      root.issue.issues.issuesMap.i1.parent_id = "parent-1";
    });
    expect(root.portfolio.getItem("i1")?.parent_id).toBe("parent-1");
  });

  it("carries a sprint, resolving the name the band and the legend print", () => {
    bothHold("i1", "p1", { cycle_id: null }, { cycle: null });
    write(() => {
      root.issue.issues.issuesMap.i1.cycle_id = "c1";
    });
    expect(root.portfolio.getItem("i1")?.cycle).toEqual({ id: "c1", name: "Sprint 12" });
  });

  it("clears the sprint when the item leaves one", () => {
    bothHold("i1", "p1", { cycle_id: "c1" }, { cycle: { id: "c1", name: "Sprint 12" } });
    write(() => {
      root.issue.issues.issuesMap.i1.cycle_id = null;
    });
    expect(root.portfolio.getItem("i1")?.cycle).toBeNull();
  });

  it("keeps the server's own name when the sprint id has not changed", () => {
    // The server sends the name with the row; a client store's copy of it is a
    // second source of truth and must not overwrite the first for no reason.
    bothHold("i1", "p1", { cycle_id: "c1" }, { cycle: { id: "c1", name: "Sprint 12 (Q3)" } });
    write(() => {
      root.issue.issues.issuesMap.i1.priority = "high";
    });
    expect(root.portfolio.getItem("i1")?.cycle?.name).toBe("Sprint 12 (Q3)");
  });

  it("files an item under the LOWEST-NAMED of its modules, as the server does", () => {
    bothHold("i1", "p1", { module_ids: [] }, { module: null });
    write(() => {
      root.issue.issues.issuesMap.i1.module_ids = ["m3", "m1", "m2"];
    });
    // Antenna < Firmware < Zephyr. Picking the first id would have said Zephyr,
    // and a refetch would then have moved the row to a different band.
    expect(root.portfolio.getItem("i1")?.module).toEqual({ id: "m2", name: "Antenna" });
  });

  it("carries assignees, resolving name and avatar for the strip on the bar", () => {
    bothHold("i1", "p1", { assignee_ids: [] }, { assignees: [] });
    write(() => {
      root.issue.issues.issuesMap.i1.assignee_ids = ["u2", "u1"];
    });
    expect(root.portfolio.getItem("i1")?.assignees).toEqual([
      { id: "u2", name: "Geoffrey", avatar: "g.png" },
      { id: "u1", name: "Ruby", avatar: null },
    ]);
  });

  it("keeps an assignee the row already named when somebody else is added", () => {
    bothHold(
      "i1",
      "p1",
      { assignee_ids: ["u1"] },
      { assignees: [{ id: "u1", name: "Ruby Fitzgerald", avatar: null }] }
    );
    write(() => {
      root.issue.issues.issuesMap.i1.assignee_ids = ["u1", "u2"];
    });
    expect(root.portfolio.getItem("i1")?.assignees?.[0]?.name).toBe("Ruby Fitzgerald");
  });

  it("does not fill a legend with a uuid when a name cannot be resolved", () => {
    bothHold("i1", "p1", { cycle_id: null }, { cycle: null });
    write(() => {
      root.issue.issues.issuesMap.i1.cycle_id = "never-loaded";
    });
    // Empty, not the id: `buildColorScale` takes the first NON-EMPTY label for a
    // series, so another row in the same sprint supplies it and a refetch
    // restores the server's. A uuid in a legend is worse than a gap.
    expect(root.portfolio.getItem("i1")?.cycle).toEqual({ id: "never-loaded", name: "" });
  });
});

/**
 * The case `ac98514a4d` explicitly left open. Its note said absence from
 * `issuesMap` cannot be told apart from "never loaded" — and the previous
 * snapshot is exactly that discriminator, because an id in it was present in
 * both maps a moment ago.
 */
describe("a work item deleted from the peek panel", () => {
  beforeEach(() => bothHold("i1", "p1", {}, {}));

  it("stops being drawn", () => {
    write(() => {
      delete root.issue.issues.issuesMap.i1;
    });
    expect(root.portfolio.getItem("i1")).toBeUndefined();
    expect(root.portfolio.getRowById("i1")).toBeUndefined();
  });

  it("takes it out of the project's own count, so the sidebar agrees with the rows", () => {
    write(() => {
      delete root.issue.issues.issuesMap.i1;
    });
    expect(root.portfolio.getProject("p1")?.item_count).toBe(1);
  });

  it("decrements the undated count only when the row had no dates", () => {
    seedProject("p2", { item_count: 2, undated_item_count: 1 });
    seedPortfolioItem("u1", "p2", { start_date: null, target_date: null });
    write(() => seedIssue("u1", { start_date: null, target_date: null }));
    write(() => {
      delete root.issue.issues.issuesMap.u1;
    });
    expect(root.portfolio.getProject("p2")?.undated_item_count).toBe(0);
  });

  it("leaves the other rows of the project alone", () => {
    seedPortfolioItem("i2", "p1");
    write(() => seedIssue("i2"));
    const before = root.portfolio.getItem("i2");
    write(() => {
      delete root.issue.issues.issuesMap.i1;
    });
    expect(root.portfolio.getItem("i2")).toBe(before);
  });
});

/**
 * Archiving is the same disappearance by another route: `issueArchive` only sets
 * `archived_at` and leaves the row in `issuesMap`, but the endpoint the board
 * fetches from reads `Issue.issue_objects`, which excludes archived items.
 */
describe("a work item archived from the peek panel", () => {
  it("stops being drawn", () => {
    bothHold("i1", "p1", { archived_at: null }, {});
    write(() => {
      root.issue.issues.issuesMap.i1.archived_at = "2026-08-12T09:00:00Z";
    });
    expect(root.portfolio.getItem("i1")).toBeUndefined();
    expect(root.portfolio.getProject("p1")?.item_count).toBe(1);
  });
});

describe("what it must NOT do", () => {
  it("does not seed a freshly fetched row from an older copy in the issue store", () => {
    // The peek left 5 Sept in `issuesMap` earlier in the session; the board has
    // just fetched the row and the server now says the 12th. The fetch wins.
    write(() => seedIssue("i1", { target_date: "2026-09-05" }));
    seedPortfolioItem("i1", "p1", { target_date: "2026-09-12" });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-12");
  });

  it("still propagates the next real change to that row", () => {
    write(() => seedIssue("i1", { target_date: "2026-09-05" }));
    seedPortfolioItem("i1", "p1", { target_date: "2026-09-12" });
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-20";
    });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-20");
  });

  it("does not delete a row it has only just met", () => {
    // Present in `itemMap`, never in `issuesMap`: the ordinary state of every row
    // on the board nobody has peeked. It must survive any number of unrelated
    // writes elsewhere.
    seedProject("p1");
    seedPortfolioItem("never-peeked", "p1");
    write(() => seedIssue("someone-else"));
    write(() => {
      root.issue.issues.issuesMap["someone-else"].target_date = "2026-12-01";
    });
    expect(root.portfolio.getItem("never-peeked")).toBeDefined();
    expect(root.portfolio.getProject("p1")?.item_count).toBe(2);
  });

  it("ignores work items the board is not showing", () => {
    write(() => seedIssue("stranger"));
    write(() => {
      root.issue.issues.issuesMap.stranger.target_date = "2026-09-30";
    });
    expect(root.portfolio.getItem("stranger")).toBeUndefined();
    expect(root.portfolio.getRowById("stranger")).toBeUndefined();
  });

  it("stops when disposed", () => {
    bothHold();
    dispose();
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-12";
      root.issue.issues.issuesMap.i1.state_id = "done";
    });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-05");
    expect(root.portfolio.getItem("i1")?.state_id).toBeUndefined();
  });
});
