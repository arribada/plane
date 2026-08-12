/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Dragging a project row on the portfolio, and nesting its work items.
 *
 * The portfolio is a second gantt with its own store; it shares the pure modules
 * with the work-item timeline and nothing else. Its drag is NATIVE HTML5 drag —
 * `draggable` plus `onDragStart`/`onDrop` on the row — so a test cannot drive it:
 * jsdom will dispatch the events, but nothing about a synthesised drop proves the
 * browser would have started the drag in the first place. What can be tested, and
 * is all that ever went wrong, is the store: which sequence a drop is applied to,
 * and what the row list comes out as.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { TPortfolioItem, TPortfolioProject } from "@/plane-web/types/arribada";
import { PortfolioStore } from "./portfolio.store";

const project = (id: string, name: string, start: string | null): TPortfolioProject => ({
  id,
  name,
  identifier: id.toUpperCase(),
  logo_props: null,
  archived: false,
  start_date: start,
  target_date: null,
  derived_start_date: start,
  derived_target_date: null,
  item_count: 0,
  scheduled_item_count: 0,
  undated_item_count: 0,
  completed_item_count: 0,
  baseline_target_date: null,
});

const item = (id: string, sequence: number, parent: string | null): TPortfolioItem => ({
  id,
  name: id,
  sequence_id: sequence,
  start_date: null,
  target_date: null,
  state_id: null,
  parent_id: parent,
  priority: "none",
  assignees: [],
});

/** Three projects whose alphabetical order and date order disagree, which is what
 *  makes "which sequence did the drop use" answerable at all. */
const board = () => {
  const store = new PortfolioStore();
  store.projectMap = {
    alpha: project("alpha", "Alpha", "2026-03-01"),
    bravo: project("bravo", "Bravo", "2026-01-01"),
    charlie: project("charlie", "Charlie", "2026-02-01"),
  };
  store.displayedProjectIds = ["alpha", "bravo", "charlie"];
  return store;
};

beforeEach(() => {
  localStorage.clear();
});

describe("dragging a project while the board is sorted by something else", () => {
  it("applies the drop to the sequence on screen, not the stored one", () => {
    const store = board();
    store.setSortBy("start_date");
    // On screen: bravo (Jan), charlie (Feb), alpha (Mar).
    expect(store.sortedProjectIds).toEqual(["bravo", "charlie", "alpha"]);

    store.moveProject("alpha", "bravo");

    // What the reader did: took the last row and dropped it on the first.
    expect(store.sortedProjectIds).toEqual(["alpha", "bravo", "charlie"]);
    expect(store.sortBy).toBe("manual");
  });

  it("says where the manual order came from", () => {
    const store = board();
    store.setSortBy("start_date");
    store.moveProject("alpha", "bravo");

    // The toolbar prints this beside "Manual (drag)". Silently swallowing the
    // sort is the difference between a feature and the board misbehaving.
    expect(store.manualFrom).toBe("Start date");
  });

  it("stops saying so once a sort is picked by hand again", () => {
    const store = board();
    store.setSortBy("start_date");
    store.moveProject("alpha", "bravo");
    store.setSortBy("name");

    expect(store.manualFrom).toBeNull();
  });

  it("records nothing when the order was already manual", () => {
    const store = board();
    store.setSortBy("manual");
    store.moveProject("charlie", "alpha");

    expect(store.manualFrom).toBeNull();
    expect(store.displayedProjectIds).toEqual(["charlie", "alpha", "bravo"]);
  });
});

describe("dragging a project while the board is grouped into folder swimlanes", () => {
  const grouped = () => {
    const store = board();
    store.folders = [
      { id: "f2", name: "Trackers", parent_id: null, project_ids: ["charlie"] },
      { id: "f1", name: "Cameras", parent_id: null, project_ids: ["alpha", "bravo"] },
    ];
    store.setGroupByFolder(true);
    store.setSortBy("name");
    return store;
  };

  it("takes the banded sequence as the order and drops the bands", () => {
    const store = grouped();
    // The swimlanes walk the folder tree, so: Trackers (charlie), then Cameras
    // (alpha, bravo) — an order neither the sort nor the saved list would give.
    expect(store.visibleProjectSequence).toEqual(["charlie", "alpha", "bravo"]);

    store.moveProject("bravo", "charlie");

    expect(store.groupByFolder).toBe(false);
    expect(store.sortBy).toBe("manual");
    // Nothing moved except the row under the hand.
    expect(store.sortedProjectIds).toEqual(["bravo", "charlie", "alpha"]);
  });

  it("names both the sort and the bands it consumed", () => {
    const store = grouped();
    store.moveProject("bravo", "charlie");

    expect(store.manualFrom).toBe("Name, inside folders");
  });

  it("leaves the projects outside a focused folder where they were", () => {
    // The board is narrowed to one folder. Writing the visible three back as the
    // whole order would delete every project that was not on screen.
    const store = grouped();
    store.setFocusFolder("f1");
    expect(store.sortedProjectIds).toEqual(["alpha", "bravo"]);

    store.moveProject("bravo", "alpha");

    expect(store.displayedProjectIds).toContain("charlie");
    expect(store.displayedProjectIds).toHaveLength(3);
  });
});

describe("sub-tasks nested under their project's work items", () => {
  const withItems = () => {
    const store = board();
    store.itemMap = {
      "task-a": item("task-a", 1, null),
      "task-a1": item("task-a1", 2, "task-a"),
      "task-a1a": item("task-a1a", 3, "task-a1"),
      "task-b": item("task-b", 4, null),
      // Its parent is in another project, so this one is nobody's child here.
      "task-elsewhere": item("task-elsewhere", 5, "task-in-another-project"),
    };
    store.itemProjectId = {
      "task-a": "alpha",
      "task-a1": "alpha",
      "task-a1a": "alpha",
      "task-b": "alpha",
      "task-elsewhere": "alpha",
    };
    store.expandedProjectIds = new Set(["alpha"]);
    store.setSortBy("manual");
    return store;
  };

  it("draws each sub-task under its parent", () => {
    const store = withItems();
    expect(store.ganttBlockIds).toEqual([
      "alpha",
      "task-a",
      "task-a1",
      "task-a1a",
      "task-b",
      "task-elsewhere",
      "bravo",
      "charlie",
    ]);
    expect(store.itemSubtaskTree.byId.get("task-a1a")?.depth).toBe(2);
    // A parent in another project is not a parent here: the portfolio spans a
    // workspace, and this row would otherwise be pulled out of its own project.
    expect(store.itemSubtaskTree.byId.get("task-elsewhere")?.depth).toBe(0);
  });

  it("folds a whole subtree behind its parent", () => {
    const store = withItems();
    store.toggleItemCollapsed("task-a");

    expect(store.ganttBlockIds).toEqual(["alpha", "task-a", "task-b", "task-elsewhere", "bravo", "charlie"]);
  });

  it("gives back the flat list when nesting is switched off", () => {
    const store = withItems();
    store.toggleItemCollapsed("task-a");
    store.setNestSubtasks(false);

    // Both the nesting and the fold: a fold left behind would hide rows the
    // moment nesting came back on.
    expect(store.ganttBlockIds).toEqual([
      "alpha",
      "task-a",
      "task-a1",
      "task-a1a",
      "task-b",
      "task-elsewhere",
      "bravo",
      "charlie",
    ]);
    expect(store.isItemCollapsed("task-a")).toBe(false);
  });

  it("keeps the folder header rows, which belong to no tree", () => {
    const store = withItems();
    store.folders = [{ id: "f1", name: "Cameras", parent_id: null, project_ids: ["alpha"] }];
    store.setGroupByFolder(true);
    store.toggleItemCollapsed("task-a");

    expect(store.ganttBlockIds[0]).toBe("__folder__:f1");
    expect(store.ganttBlockIds).not.toContain("task-a1");
  });
});

describe("group and subgroup, stacked", () => {
  const banded = () => {
    const store = board();
    store.itemMap = {
      hw: item("hw", 1, null),
      "hw-sub": item("hw-sub", 2, "hw"),
      fw: item("fw", 3, null),
    };
    store.itemMap.hw.module = { id: "m-hw", name: "Hardware" };
    store.itemMap["hw-sub"].module = { id: "m-hw", name: "Hardware" };
    store.itemMap.fw.module = { id: "m-fw", name: "Firmware" };
    store.itemProjectId = { hw: "alpha", "hw-sub": "alpha", fw: "alpha" };
    store.expandedProjectIds = new Set(["alpha"]);
    store.setSortBy("manual");
    return store;
  };

  it("defaults to one row per project, which is the board as it was", () => {
    const store = board();
    store.setSortBy("manual");

    expect(store.groupBy).toBe("project");
    expect(store.subgroupBy).toBe("none");
    // No header rows at all: the default arrangement adds nothing to the id list
    // the portfolio has always produced.
    expect(store.ganttBlockIds).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("bands a project's items and nests inside each band", () => {
    const store = banded();
    store.setSubgroupBy("module");

    // Firmware sorts before Hardware; the sub-task follows its parent INSIDE the
    // Hardware band, which is the whole composition: band, then nest.
    expect(store.ganttBlockIds).toEqual([
      "alpha",
      "__psub__:alpha:m-fw",
      "fw",
      "__psub__:alpha:m-hw",
      "hw",
      "hw-sub",
      "bravo",
      "charlie",
    ]);
  });

  it("folds a band away without touching the others", () => {
    const store = banded();
    store.setSubgroupBy("module");
    store.toggleSubgroupCollapse("__psub__:alpha:m-hw");

    expect(store.ganttBlockIds).toEqual([
      "alpha",
      "__psub__:alpha:m-fw",
      "fw",
      "__psub__:alpha:m-hw",
      "bravo",
      "charlie",
    ]);
  });

  it("stops nesting a sub-task whose parent is in another band", () => {
    // Same rule as the work-item timeline: a band has to keep meaning
    // "everything with this value", so a chevron never points off screen.
    const store = banded();
    store.itemMap["hw-sub"].module = { id: "m-fw", name: "Firmware" };
    store.setSubgroupBy("module");

    expect(store.itemSubtaskTree.byId.get("hw-sub")?.depth).toBe(0);
    // Inside the Firmware band it keeps the portfolio's own order (sequence 2
    // before 3), as a top-level row rather than as anybody's child.
    expect(store.ganttBlockIds).toEqual([
      "alpha",
      "__psub__:alpha:m-fw",
      "hw-sub",
      "fw",
      "__psub__:alpha:m-hw",
      "hw",
      "bravo",
      "charlie",
    ]);
  });

  it("stacks a group band over a subgroup band over a nested sub-task", () => {
    const store = banded();
    store.folders = [{ id: "f1", name: "Cameras", parent_id: null, project_ids: ["alpha"] }];
    store.setGroupBy("folder");
    store.setSubgroupBy("module");

    // group → project → subgroup → parent → child, all five levels at once.
    expect(store.ganttBlockIds.slice(0, 6)).toEqual([
      "__folder__:f1",
      "alpha",
      "__psub__:alpha:m-fw",
      "fw",
      "__psub__:alpha:m-hw",
      "hw",
    ]);
  });

  it("bands the project rows by status, worst first", () => {
    const store = board();
    store.setProjectStatuses({ alpha: "on_track", bravo: "off_track" });
    store.setGroupBy("status");

    // A portfolio is read to find what is going wrong, so off track leads and the
    // projects nobody has reported on are last — which is not the same as "fine".
    expect(store.bandGroups.map((b) => b.name)).toEqual(["Off track", "On track", "No update"]);
    expect(store.bandGroups[2].projectIds).toEqual(["charlie"]);
  });

  it("gives every subgroup band a row the chart can measure", () => {
    // Both panes map over this id list and every dependency arrow computes its y
    // from a row's index in it. A header with no row would slide every arrow
    // below it off its own bar.
    const store = banded();
    store.setSubgroupBy("module");
    const row = store.getRowById("__psub__:alpha:m-hw");

    expect(row?.name).toBe("Hardware");
    expect(row?.start_date).toBeNull();
  });

  it("takes the banded sequence into the manual order when a project is dragged", () => {
    // Item 2's principle, applied to a two-level arrangement: the visible
    // sequence is what gets written down, whatever produced it.
    const store = board();
    store.setProjectStatuses({ alpha: "on_track", bravo: "off_track" });
    store.setGroupBy("status");
    store.setSortBy("name");
    expect(store.visibleProjectSequence).toEqual(["bravo", "alpha", "charlie"]);

    store.moveProject("charlie", "bravo");

    expect(store.groupBy).toBe("project");
    expect(store.sortedProjectIds).toEqual(["charlie", "bravo", "alpha"]);
    expect(store.manualFrom).toBe("Name, inside status bands");
  });
});
