/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Sub-task nesting: the decisions, not the gesture.
 *
 * jsdom has no drag-and-drop and no layout engine, so nothing here simulates
 * folding a row with a mouse or measures an indent. What it does test is every
 * question the feature had to answer — what order does a parent's subtree come
 * out in, what happens to a child whose parent is filtered out, what happens
 * inside bands, how deep does it go, what does a folded parent hide — because
 * those are decisions in a pure function and a decision is exactly what a test
 * can pin.
 */
import { describe, expect, it } from "vitest";
import type { TGanttGroup } from "./grouping";
import {
  buildSubtaskTree,
  hideCollapsedDescendants,
  nestGroups,
  parentIds,
  subtaskRollup,
  type TSubtaskIssue,
} from "./subtasks";

const world = (rows: Record<string, TSubtaskIssue>) => (id: string) => rows[id];

describe("buildSubtaskTree", () => {
  it("puts each child directly under its parent and leaves the roots where they were", () => {
    const rows = world({
      a: { parent_id: null },
      b: { parent_id: null },
      "a-1": { parent_id: "a" },
      "b-1": { parent_id: "b" },
      "a-2": { parent_id: "a" },
    });
    // The incoming order is the display filter's own — sub-tasks scattered through
    // it, which is exactly what the flat chart looked like.
    const tree = buildSubtaskTree(["a", "b", "a-1", "b-1", "a-2"], rows);

    expect(tree.order).toEqual(["a", "a-1", "a-2", "b", "b-1"]);
    expect(tree.byId.get("a-1")?.depth).toBe(1);
    expect(tree.byId.get("a")?.childIds).toEqual(["a-1", "a-2"]);
    expect(tree.byId.get("a")?.descendants).toBe(2);
  });

  it("nests every level of a parent chain rather than stopping at one", () => {
    const rows = world({
      top: { parent_id: null },
      mid: { parent_id: "top" },
      low: { parent_id: "mid" },
      deep: { parent_id: "low" },
    });
    const tree = buildSubtaskTree(["top", "mid", "low", "deep"], rows);

    expect(tree.order).toEqual(["top", "mid", "low", "deep"]);
    expect(tree.byId.get("deep")?.depth).toBe(3);
    // A grandchild drawn as a top-level row directly beneath its own parent's
    // subtree reads as a sibling of the thing it belongs to.
    expect(tree.byId.get("top")?.descendants).toBe(3);
  });

  it("leaves a sub-task alone when its parent is not on this chart", () => {
    // The filtered case, and the same shape as the portfolio's cross-project one:
    // the parent is real, it is simply not in the list being drawn.
    const rows = world({ orphan: { parent_id: "somewhere-else" } });
    const tree = buildSubtaskTree(["orphan"], rows);

    expect(tree.order).toEqual(["orphan"]);
    expect(tree.byId.get("orphan")?.depth).toBe(0);
    expect(tree.byId.get("orphan")?.parentId).toBeNull();
  });

  it("keeps a parent whose own children are filtered out as an ordinary row", () => {
    const rows = world({ parent: { parent_id: null } });
    const tree = buildSubtaskTree(["parent"], rows);

    expect(tree.byId.get("parent")?.childIds).toEqual([]);
    expect(parentIds(tree)).toEqual([]);
  });

  it("survives a parent cycle instead of recursing forever", () => {
    // Nothing in the schema stops A→B→A after a bad import, and a hang is a blank
    // screen rather than a wrong one.
    const rows = world({ a: { parent_id: "b" }, b: { parent_id: "a" } });
    const tree = buildSubtaskTree(["a", "b"], rows);

    // oxlint-disable-next-line unicorn/no-array-sort -- the array is ours alone; toSorted is ES2023 and this workspace targets earlier
    expect(tree.order.slice().sort()).toEqual(["a", "b"]);
    expect(tree.order).toHaveLength(2);
  });

  it("ignores an item that claims to be its own parent", () => {
    const tree = buildSubtaskTree(["solo"], world({ solo: { parent_id: "solo" } }));
    expect(tree.byId.get("solo")?.parentId).toBeNull();
  });

  it("draws a duplicated id once, because two rows would be two bars", () => {
    const tree = buildSubtaskTree(["a", "a"], world({ a: { parent_id: null } }));
    expect(tree.order).toEqual(["a"]);
  });
});

describe("nestGroups — nesting composed with bands", () => {
  // a fixture for this describe block only; hoisting it would imply the other blocks share it.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const band = (key: string, ids: string[]): TGanttGroup => ({
    key,
    label: key,
    ids,
    start: null,
    end: null,
    days: 0,
    done: 0,
  });

  it("nests inside each band and never moves a row between them", () => {
    // THE DECISION: bands are computed first and keep their meaning — a band holds
    // exactly the items with that field value. A sub-task whose parent is in
    // another band keeps a row of its own, because the alternative is a header
    // that promises "Hardware" and holds a firmware task.
    const rows = world({
      hw: { parent_id: null },
      "hw-sub": { parent_id: "hw" },
      "fw-child-of-hw": { parent_id: "hw" },
      fw: { parent_id: null },
    });
    const nested = nestGroups([band("hardware", ["hw", "hw-sub"]), band("firmware", ["fw", "fw-child-of-hw"])], rows);

    expect(nested.groups[0].ids).toEqual(["hw", "hw-sub"]);
    expect(nested.groups[1].ids).toEqual(["fw", "fw-child-of-hw"]);
    // Present in the other band, so not a child here — and drawn at the top level
    // rather than under a chevron pointing off screen.
    expect(nested.tree.byId.get("fw-child-of-hw")?.depth).toBe(0);
    expect(nested.tree.byId.get("hw-sub")?.depth).toBe(1);
  });

  it("covers every band with one tree, so both panes ask the same question", () => {
    const rows = world({ a: { parent_id: null }, "a-1": { parent_id: "a" }, z: { parent_id: null } });
    const nested = nestGroups([band("one", ["a", "a-1"]), band("two", ["z"])], rows);

    expect(nested.tree.order).toEqual(["a", "a-1", "z"]);
  });
});

describe("hideCollapsedDescendants", () => {
  const rows = world({
    a: { parent_id: null },
    "a-1": { parent_id: "a" },
    "a-1-1": { parent_id: "a-1" },
    b: { parent_id: null },
  });
  const tree = buildSubtaskTree(["a", "a-1", "a-1-1", "b"], rows);

  it("folds a whole subtree away, not just the direct children", () => {
    expect(hideCollapsedDescendants(tree.order, tree, new Set(["a"]))).toEqual(["a", "b"]);
  });

  it("folds one level without touching the level above it", () => {
    expect(hideCollapsedDescendants(tree.order, tree, new Set(["a-1"]))).toEqual(["a", "a-1", "b"]);
  });

  it("returns the list untouched when nothing is folded", () => {
    const rowIds = tree.order;
    expect(hideCollapsedDescendants(rowIds, tree, new Set())).toBe(rowIds);
  });

  it("leaves a group header alone — it is in no tree and has no ancestors", () => {
    const withHeader = ["__ggrp__:hardware", ...tree.order];
    expect(hideCollapsedDescendants(withHeader, tree, new Set(["a"]))).toEqual(["__ggrp__:hardware", "a", "b"]);
  });
});

describe("subtaskRollup — what a fold hides", () => {
  it("says nothing when the parent already spans its children", () => {
    // THE DECISION: the parent's bar always spans the parent's own dates, folded
    // or not, because that bar is draggable and a bar meaning "my children" has no
    // defined answer to being dragged. The rollup exists only for the gap that
    // leaves — and on a well-formed plan there is none.
    const rows = world({
      p: { parent_id: null, start_date: "2026-08-01", target_date: "2026-08-31" },
      c: { parent_id: "p", start_date: "2026-08-05", target_date: "2026-08-10" },
    });
    const tree = buildSubtaskTree(["p", "c"], rows);
    expect(subtaskRollup("p", tree, rows)).toBeNull();
  });

  it("reports the envelope when a child runs past the parent's own dates", () => {
    const rows = world({
      p: { parent_id: null, start_date: "2026-08-01", target_date: "2026-08-10" },
      c: { parent_id: "p", start_date: "2026-08-05", target_date: "2026-09-20" },
      g: { parent_id: "c", start_date: "2026-07-20", target_date: "2026-07-25" },
    });
    const tree = buildSubtaskTree(["p", "c", "g"], rows);
    const rollup = subtaskRollup("p", tree, rows);

    // Grandchildren count: folding the parent hides them too.
    expect(rollup?.start.toISOString().slice(0, 10)).toBe("2026-07-20");
    expect(rollup?.end.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("says nothing for a leaf, and nothing for children with no dates at all", () => {
    const rows = world({ p: { parent_id: null }, c: { parent_id: "p" } });
    const tree = buildSubtaskTree(["p", "c"], rows);
    expect(subtaskRollup("c", tree, rows)).toBeNull();
    expect(subtaskRollup("p", tree, rows)).toBeNull();
  });
});
