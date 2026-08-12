/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The portfolio half of the third report:
 *
 *   "Dans la date d'un item que je change après avoir cliqué depuis portfolio […],
 *    je change la date et ça ne s'actualise pas sur le diagramme."
 *
 * The peek panel opened from a portfolio bar is Plane's, so it writes Plane's
 * `issuesMap`; the bar is drawn from the portfolio store's own `itemMap`. The
 * assertions below are about the join between them, so the real `PortfolioStore` is
 * used on one side — `applyItemDates`, `getItem` and `getRowById` are the actual
 * ones the board draws through — and a miniature of Plane's issue store on the
 * other, because all the mirror reads from it is one map.
 */
import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { mirrorIssueDatesIntoPortfolio } from "./portfolio-issue-dates";
import { PortfolioStore } from "./portfolio.store";
import type { RootStore } from "./root.store";

type TFakeRoot = {
  issue: { issues: { issuesMap: Record<string, Partial<TIssue>> } };
  portfolio: PortfolioStore;
};

let root: TFakeRoot;
let dispose: () => void;

const seedIssue = (id: string, start: string | null, target: string | null) => {
  root.issue.issues.issuesMap[id] = { id, start_date: start, target_date: target };
};

const seedPortfolioItem = (id: string, projectId: string, start: string | null, target: string | null) => {
  runInAction(() => {
    root.portfolio.itemMap[id] = {
      id,
      name: id,
      start_date: start,
      target_date: target,
    } as PortfolioStore["itemMap"][string];
    root.portfolio.itemProjectId[id] = projectId;
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
  dispose = mirrorIssueDatesIntoPortfolio(root as unknown as RootStore);
});

afterEach(() => {
  dispose();
});

describe("a date edited in the peek panel opened from a portfolio bar", () => {
  beforeEach(() => {
    seedPortfolioItem("i1", "p1", "2026-09-01", "2026-09-05");
    write(() => seedIssue("i1", "2026-09-01", "2026-09-05"));
  });

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
    seedPortfolioItem("i2", "p1", "2026-10-01", "2026-10-02");
    write(() => seedIssue("i2", "2026-10-01", "2026-10-02"));
    const before = root.portfolio.getItem("i2");
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-30";
    });
    // Same object, not merely equal dates: a rewrite of every row would churn the
    // identity the timeline's block map compares against.
    expect(root.portfolio.getItem("i2")).toBe(before);
  });
});

describe("what it must NOT do", () => {
  it("does not seed a freshly fetched row from an older copy in the issue store", () => {
    // The peek left 5 Sept in `issuesMap` earlier in the session; the board has
    // just fetched the row and the server now says the 12th. The fetch wins.
    write(() => seedIssue("i1", "2026-09-01", "2026-09-05"));
    seedPortfolioItem("i1", "p1", "2026-09-01", "2026-09-12");
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-12");
  });

  it("still propagates the next real change to that row", () => {
    write(() => seedIssue("i1", "2026-09-01", "2026-09-05"));
    seedPortfolioItem("i1", "p1", "2026-09-01", "2026-09-12");
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-20";
    });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-20");
  });

  it("ignores work items the board is not showing", () => {
    write(() => seedIssue("stranger", "2026-09-01", "2026-09-05"));
    write(() => {
      root.issue.issues.issuesMap.stranger.target_date = "2026-09-30";
    });
    expect(root.portfolio.getItem("stranger")).toBeUndefined();
    expect(root.portfolio.getRowById("stranger")).toBeUndefined();
  });

  it("stops when disposed", () => {
    seedPortfolioItem("i1", "p1", "2026-09-01", "2026-09-05");
    write(() => seedIssue("i1", "2026-09-01", "2026-09-05"));
    dispose();
    write(() => {
      root.issue.issues.issuesMap.i1.target_date = "2026-09-12";
    });
    expect(root.portfolio.getRowById("i1")?.target_date).toBe("2026-09-05");
  });
});
