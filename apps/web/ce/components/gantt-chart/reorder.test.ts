/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a drag hands to the drop that triggered it.
 *
 * Neither of these can be reached by a synthesised gesture — the gantt's reorder
 * runs on pragmatic-drag-and-drop, which needs a real pointer, and the portfolio's
 * runs on native HTML5 drag events. So the drop's ARITHMETIC is tested here
 * instead, which is where every one of its failures actually lived.
 */
import { describe, expect, it } from "vitest";
import { ORDER_STEP, frozenOrder, reorderWithinSubset } from "./reorder";

describe("frozenOrder", () => {
  it("reproduces exactly what the server's freeze wrote", () => {
    // `_apply_issue_order` writes `(index + 1) * ORDER_STEP`. Pinned on the
    // backend too — see plane/arribada/test_issue_order.py.
    const frozen = frozenOrder(["a", "b", "c"]);

    expect(frozen.sortOrderOf("a")).toBe(ORDER_STEP);
    expect(frozen.sortOrderOf("b")).toBe(2 * ORDER_STEP);
    expect(frozen.sortOrderOf("c")).toBe(3 * ORDER_STEP);
  });

  it("says nothing about an id the freeze never saw", () => {
    // undefined, not 0: the caller falls back to the store, and 0 would place a
    // stranger at the very top of the list.
    expect(frozenOrder(["a"]).sortOrderOf("elsewhere")).toBeUndefined();
  });

  it("carries the sequence itself, because the caller's props are one render stale", () => {
    expect(frozenOrder(["b", "a"]).blockIds).toEqual(["b", "a"]);
  });
});

describe("reorderWithinSubset", () => {
  it("moves the dragged row to where the row it was dropped on sits", () => {
    expect(reorderWithinSubset(["a", "b", "c"], ["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("rewrites only the positions the visible rows occupy", () => {
    // A focused folder, or a filtered board: three projects on screen out of five.
    // Reordering the subset and storing it would delete the two that were not.
    const full = ["p1", "hidden-a", "p2", "hidden-b", "p3"];
    const visible = ["p1", "p2", "p3"];

    expect(reorderWithinSubset(full, visible, "p3", "p1")).toEqual(["p3", "hidden-a", "p1", "hidden-b", "p2"]);
  });

  it("takes the visible sequence as the order, not the stored one", () => {
    // This is the whole feature. The stored order is alphabetical; the reader is
    // looking at a date sort, or at folder swimlanes. Dropping c on a has to mean
    // what the reader sees, so the result starts from THEIR sequence.
    const stored = ["a", "b", "c"];
    const onScreen = ["c", "b", "a"];

    expect(reorderWithinSubset(stored, onScreen, "a", "c")).toEqual(["a", "c", "b"]);
  });

  it("returns the same array when the drop is a no-op, so nothing re-renders", () => {
    const full = ["a", "b"];
    expect(reorderWithinSubset(full, full, "a", "a")).toBe(full);
    expect(reorderWithinSubset(full, full, "a", "missing")).toBe(full);
  });

  it("appends a visible row the stored order has never heard of", () => {
    expect(reorderWithinSubset(["a"], ["a", "new"], "new", "a")).toEqual(["new", "a"]);
  });
});
