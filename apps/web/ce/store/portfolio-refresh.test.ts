/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What the board reads after the SERVER has changed it underneath.
 *
 * Two of the portfolio toolbar's actions write nothing through this store: "reflow"
 * auto-schedules every project in scope and "capture baseline" snapshots them, both
 * straight to the API. Afterwards `projectMap` held the pre-reflow windows and the
 * pre-capture baseline fields — and the drift badge beside every project name is
 * computed from those, so the board reported drift against a baseline that had been
 * replaced. Reflow did refetch the rows, via `fetchPortfolio`, which also rebuilds
 * `displayedProjectIds` and force-flips the sort — so it fixed the numbers by
 * reshuffling the board under the reader's hand, and left the work-item bars it had
 * just moved showing their old dates.
 *
 * The first test in "what fetchPortfolio does instead" is the reason this method
 * exists rather than a second call to that one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TPortfolioItem, TPortfolioProject } from "@/plane-web/types/arribada";

const { getPortfolio, getFolders, getProjectItems } = vi.hoisted(() => ({
  getPortfolio: vi.fn(),
  getFolders: vi.fn(),
  getProjectItems: vi.fn(),
}));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getPortfolio = getPortfolio;
    getFolders = getFolders;
    getProjectItems = getProjectItems;
  },
}));

const { PortfolioStore } = await import("./portfolio.store");

const project = (id: string, over: Partial<TPortfolioProject> = {}): TPortfolioProject => ({
  id,
  name: id.toUpperCase(),
  identifier: id.toUpperCase(),
  logo_props: null,
  archived: false,
  start_date: "2026-09-01",
  target_date: "2026-12-01",
  derived_start_date: "2026-09-01",
  derived_target_date: "2026-12-01",
  item_count: 1,
  scheduled_item_count: 1,
  undated_item_count: 0,
  completed_item_count: 0,
  baseline_target_date: "2026-12-01",
  ...over,
});

const item = (id: string, target: string): TPortfolioItem => ({
  id,
  name: id,
  sequence_id: 1,
  start_date: "2026-09-01",
  target_date: target,
  state_id: null,
  parent_id: null,
  priority: "none",
  assignees: [],
});

let store: InstanceType<typeof PortfolioStore>;

beforeEach(async () => {
  window.localStorage.clear();
  getPortfolio.mockReset();
  getFolders.mockReset();
  getProjectItems.mockReset();

  getPortfolio.mockResolvedValue([project("p1"), project("p2")]);
  getFolders.mockResolvedValue([]);
  getProjectItems.mockResolvedValue([item("i1", "2026-10-01")]);

  store = new PortfolioStore();
  await store.fetchPortfolio("arribada");
  await store.toggleProjectExpansion("arribada", "p1");
});

describe("refreshLoaded", () => {
  it("picks up the baseline a capture just replaced", async () => {
    expect(store.getProject("p1")?.baseline_target_date).toBe("2026-12-01");
    getPortfolio.mockResolvedValue([project("p1", { baseline_target_date: "2027-02-01" }), project("p2")]);

    expect(await store.refreshLoaded("arribada")).toBe(true);
    expect(store.getProject("p1")?.baseline_target_date).toBe("2027-02-01");
  });

  it("picks up the dates a reflow just moved, on the work items too", async () => {
    expect(store.getRowById("i1")?.target_date).toBe("2026-10-01");
    getProjectItems.mockResolvedValue([item("i1", "2026-11-15")]);

    await store.refreshLoaded("arribada");
    expect(store.getRowById("i1")?.target_date).toBe("2026-11-15");
  });

  it("leaves the reader's arrangement exactly as it was", async () => {
    store.moveProject("p2", "p1");
    const arrangement = [...store.displayedProjectIds];
    store.setSortBy("start_date");

    await store.refreshLoaded("arribada");

    expect(store.displayedProjectIds).toEqual(arrangement);
    expect(store.sortBy).toBe("start_date");
  });

  it("only asks for the items of projects that are expanded", async () => {
    getProjectItems.mockClear();
    await store.refreshLoaded("arribada");
    expect(getProjectItems).toHaveBeenCalledTimes(1);
    expect(getProjectItems).toHaveBeenCalledWith("arribada", "p1");
  });

  it("drops a work item that has been deleted since", async () => {
    getProjectItems.mockResolvedValue([]);
    await store.refreshLoaded("arribada");
    expect(store.getItem("i1")).toBeUndefined();
    expect(store.getRowById("i1")).toBeUndefined();
  });

  it("says so rather than blanking the board when the reload fails", async () => {
    getPortfolio.mockRejectedValue(new Error("502"));

    expect(await store.refreshLoaded("arribada")).toBe(false);
    // The stale rows are better than none: the caller warns, and nothing here
    // reads as "this workspace has no projects".
    expect(store.getProject("p1")?.name).toBe("P1");
    expect(store.getRowById("i1")?.target_date).toBe("2026-10-01");
  });

  it("says so when only the items fail", async () => {
    getProjectItems.mockRejectedValue(new Error("502"));
    expect(await store.refreshLoaded("arribada")).toBe(false);
    expect(store.getRowById("i1")?.target_date).toBe("2026-10-01");
  });
});

describe("what fetchPortfolio does instead", () => {
  it("rebuilds the arrangement, which is why the bulk actions must not call it", async () => {
    store.moveProject("p2", "p1");
    expect(store.displayedProjectIds).toEqual(["p2", "p1"]);
    store.setSortBy("start_date");

    await store.fetchPortfolio("arribada");

    // The saved manual order comes back out of localStorage and drags the sort
    // with it — correct on a fresh page load, a reshuffle mid-session.
    expect(store.sortBy).toBe("manual");
  });

  it("does not reload the items of an expanded project", async () => {
    getProjectItems.mockClear();
    await store.fetchPortfolio("arribada");
    expect(getProjectItems).not.toHaveBeenCalled();
  });
});
