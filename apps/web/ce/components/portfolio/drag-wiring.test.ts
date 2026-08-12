/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The prop that was missing, pinned.
 *
 * The portfolio's bars could not be dragged or resized, and the reason was one
 * absent prop: the board passed `blockUpdateHandler` and nothing else, and a bar
 * drag does not go through `blockUpdateHandler`. It persists through
 * `updateBlockDates` (`use-gantt-resizable.ts`, which calls it behind
 * `if (updateBlockDates)`), so the gesture ran, the bar followed the mouse, and
 * on mouseup the store's autorun recomputed the position from dates that had
 * never changed. The bar snapped back. Nothing was written and nothing failed.
 *
 * WHY THIS IS A SOURCE-SHAPE TEST. The failure is a wiring fact — one component
 * handing another a prop — and neither half of it can be reached from jsdom:
 * mounting `PortfolioTimelineRoot` needs the whole mobx root store, the router
 * and the peek overview, and proving the drag itself needs a real mouse, pointer
 * capture and layout, none of which jsdom has. The decision functions beside this
 * file cover every RULE; this covers the one thing they cannot, which is that
 * they are connected to anything. Grep markers taken from the real diff, as
 * strings rather than invented symbol names.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "root.tsx"), "utf8");
const resizable = readFileSync(
  path.resolve(__dirname, "../../../core/components/gantt-chart/helpers/blockResizables/use-gantt-resizable.ts"),
  "utf8"
);

describe("the portfolio timeline's drag wiring", () => {
  it("is the prop the drag actually calls", () => {
    // If this ever stops being true, the test below is guarding the wrong name.
    expect(resizable).toContain("if (updateBlockDates) updateBlockDates(blockUpdates)");
  });

  it("hands the gantt an updateBlockDates handler", () => {
    expect(source).toContain("updateBlockDates={updateBlockDates}");
  });

  it("decides move and resize per row rather than enabling every bar on the board", () => {
    // A portfolio spans many projects, each with its own lock, and it draws
    // folder bands that have no dates at all — so a board-wide `true` was wrong
    // for somebody on every screen.
    expect(source).toContain("enableBlockMove={canMoveRow}");
    expect(source).toContain("enableBlockLeftResize={canMoveRow}");
    expect(source).toContain("enableBlockRightResize={canMoveRow}");
  });

  it("routes a dragged row through the destination decision rather than assuming one", () => {
    expect(source).toContain("routePortfolioDrag");
  });
});
