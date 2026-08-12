/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Where a dropped row lands.
 *
 * `handleOrderChange` is the whole of the gantt's reorder that is not a gesture:
 * it takes the sequence, the two ids and the direction, and produces one
 * sort_order. jsdom cannot drive the drag that calls it — pragmatic-drag-and-drop
 * needs a real pointer — so this calls it directly, which is the only part a test
 * could have caught anything in anyway.
 *
 * The case that matters here is the new one: a drag that starts by FREEZING the
 * arrangement on screen. The freeze rewrites every sort_order server-side and the
 * local store still holds the numbers from before it, so without the override the
 * midpoint is taken between two values nobody is looking at.
 */
import { describe, expect, it, vi } from "vitest";
import type { IGanttBlock } from "@plane/types";
import { ORDER_STEP, frozenOrder } from "@/plane-web/components/gantt-chart/reorder";
import { handleOrderChange } from "./utils";

/** The store as it is at the moment of the drop: every row still carrying the
 *  sort_order it had before the freeze — here, Plane's default for everything. */
const staleStore = (ids: string[]) => {
  const blocks = new Map(ids.map((id) => [id, { id, sort_order: 65535, data: { id } } as unknown as IGanttBlock]));
  return (id: string) => blocks.get(id) as IGanttBlock;
};

describe("handleOrderChange", () => {
  it("takes the midpoint of the frozen neighbours, not of the store's stale ones", () => {
    const ids = ["a", "b", "c", "d"];
    const update = vi.fn();

    handleOrderChange("d", "c", false, ids, staleStore(ids), update, frozenOrder(ids).sortOrderOf);

    expect(update).toHaveBeenCalledTimes(1);
    // Dropped on "c", which the freeze put at 3000, between "b" at 2000.
    expect(update.mock.calls[0][1].sort_order.newSortOrder).toBe(2.5 * ORDER_STEP);
  });

  it("without the override, the same drop computes a midpoint of two identical numbers", () => {
    // Kept as a test rather than a comment: this is what the drop did before, and
    // 65535 for both neighbours means the row lands exactly where every other row
    // already is — a no-op the reader reads as the drag having been ignored.
    const ids = ["a", "b", "c", "d"];
    const update = vi.fn();

    handleOrderChange("d", "c", false, ids, staleStore(ids), update);

    expect(update.mock.calls[0][1].sort_order.newSortOrder).toBe(65535);
  });

  it("puts a row dropped at the top a whole step below the first one", () => {
    const ids = ["a", "b", "c"];
    const update = vi.fn();

    handleOrderChange("c", "a", false, ids, staleStore(ids), update, frozenOrder(ids).sortOrderOf);

    expect(update.mock.calls[0][1].sort_order.newSortOrder).toBe(ORDER_STEP - 1000);
  });

  it("puts a row dropped past the last one a whole step above it", () => {
    const ids = ["a", "b", "c"];
    const update = vi.fn();

    handleOrderChange("a", "c", true, ids, staleStore(ids), update, frozenOrder(ids).sortOrderOf);

    expect(update.mock.calls[0][1].sort_order.newSortOrder).toBe(3 * ORDER_STEP + 1000);
  });

  it("computes against the frozen sequence it was handed, not the grouped one on screen", () => {
    // The reason the sequence is returned at all. At the moment of the drop the
    // component's `blockIds` prop still holds the pre-flatten list, headers and
    // all; asking the store for a header's sort_order gets nothing.
    const flattened = ["a", "b", "c"];
    const update = vi.fn();

    handleOrderChange("c", "b", false, flattened, staleStore(flattened), update, frozenOrder(flattened).sortOrderOf);

    // Between "a" at 1000 and "b" at 2000. With the on-screen list — ["__ggrp__:x",
    // "a", "b", "__ggrp__:y", "c"] — "b"'s left neighbour is "a" too, but its own
    // frozen order differs, and the header rows resolve to 0.
    expect(update.mock.calls[0][1].sort_order.newSortOrder).toBe(1.5 * ORDER_STEP);
  });

  it("does nothing at all when the row is dropped on itself", () => {
    const ids = ["a", "b"];
    const update = vi.fn();

    handleOrderChange("a", "a", false, ids, staleStore(ids), update, frozenOrder(ids).sortOrderOf);

    expect(update).not.toHaveBeenCalled();
  });
});
