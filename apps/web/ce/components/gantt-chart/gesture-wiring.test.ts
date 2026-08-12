/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * That the gesture decisions are connected to the gestures.
 *
 * `gesture.test.ts` proves every RULE — what counts as a drag, where a pan
 * lands, that a swallowed click stays swallowed exactly once. None of that is
 * worth anything if the chart does not call it, and the chart's side of it
 * cannot be reached from jsdom: mounting the timeline needs the whole mobx root
 * store, the router and the peek overview, and proving a drag needs a real
 * mouse, pointer capture and layout. This is the same source-shape test
 * `portfolio/drag-wiring.test.ts` is, for the same reason — and it exists
 * because the last defect in this area was ALSO a wiring fact rather than a
 * rule: one absent prop, no failure, no message.
 *
 * Markers are taken from the real diff, as string literals rather than invented
 * symbol names — a plausible-sounding string that was never in the file produced
 * a false failure once.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), "utf8");

const resizable = read("../../../core/components/gantt-chart/helpers/blockResizables/use-gantt-resizable.ts");
const mainContent = read("../../../core/components/gantt-chart/chart/main-content.tsx");
const ganttRoot = read("../../../core/components/issues/issue-layouts/gantt/base-gantt-root.tsx");
const dependencyHandle = read("./dependency/blockDraggables/handle.tsx");
const portfolioToolbar = read("../portfolio/toolbar.tsx");
const groupRow = read("./group-row.tsx");

describe("dragging a bar does not open the work item", () => {
  it("measures the press against the shared threshold rather than any movement at all", () => {
    expect(resizable).toContain("isDragGesture({ dx: moveEvent.clientX - pressX, dy: moveEvent.clientY - pressY })");
  });

  it("returns from mouseup without writing when the press never became a drag", () => {
    // A click used to POST the bar's own unchanged dates, which put an
    // `issue.activity.updated` row against the item for nothing.
    expect(resizable).toContain("if (!hasDragged) {");
    expect(resizable).toMatch(/if \(!hasDragged\) \{\s*setIsDragging\(false\);\s*return;/);
  });

  it("swallows the click the browser synthesises after a real drag", () => {
    expect(resizable).toContain("suppressNextClick();");
  });

  it("covers the resize edges too, because they share this one handler", () => {
    // `handleBlockDrag(e, "left" | "right" | "move")` — one function, so the
    // discrimination above cannot be true for the move and false for an edge.
    expect(resizable).toContain('dragDirection: "left" | "right" | "move"');
  });

  it("swallows the click after a dependency has been dragged onto another bar", () => {
    // The link releases OVER the target bar, so without this the item just
    // linked to opened its peek the instant the arrow was drawn.
    expect(dependencyHandle).toContain("suppressNextClick();");
  });
});

describe("right-button pan", () => {
  it("is mounted on the element that actually scrolls", () => {
    // `#gantt-container`, created here and rendered by BOTH the per-project
    // timeline and the portfolio — so one wiring covers both boards.
    expect(mainContent).toContain("useTimelinePan(ganttContainerRef)");
    expect(mainContent).toContain('id="gantt-container"');
  });

  it("gives the grab a cursor, so a taken press does not look like an ignored one", () => {
    expect(mainContent).toContain("cursor-grabbing select-none");
  });

  it("does not let a non-primary press arm a dependency link", () => {
    // This handler used to arm on ANY button, so a right-press that landed on a
    // handle turned the bar blue and waited to link to whatever came next.
    expect(dependencyHandle).toContain("if (e.button !== 0) return;");
  });

  it("leaves the bar drag on the primary button, where it was", () => {
    expect(resizable).toContain("if (e.button !== 0) return;");
  });
});

describe("both halves of a band row take a drop", () => {
  /**
   * `band-drop.test.ts` proves the DECISION exhaustively and cannot see this:
   * the sidebar header had a drop target and the chart-pane brace did not, so
   * every rule was right and the gesture still did nothing where the user was
   * aiming — "en la déposant sur la case sprint". A rule with one caller wired
   * is a rule that works half the time.
   */
  it("registers the drop through one shared hook rather than twice", () => {
    expect(groupRow).toContain("const useBandDropTarget = ");
    // Once in the sidebar header, once in the chart-pane brace.
    expect(groupRow.match(/useBandDropTarget</g)?.length).toBe(2);
  });

  it("puts it on the chart-pane brace, which is the full-width target", () => {
    expect(groupRow).toContain("useBandDropTarget<HTMLDivElement>(groupKey)");
    expect(groupRow).toContain("export const GanttGroupBand");
  });

  it("puts it on the sidebar header too", () => {
    expect(groupRow).toContain("useBandDropTarget<HTMLButtonElement>(groupKey)");
  });

  it("shows the same affordance on both, so one gesture does not look like two features", () => {
    expect(groupRow.match(/outline outline-2 -outline-offset-2 outline-accent-strong/g)?.length).toBe(2);
    expect(groupRow.match(/title=\{droppable \? DROP_HINT : undefined\}/g)?.length).toBe(2);
  });

  it("hands the whole drop payload to the decision instead of picking an id out of it", () => {
    // A band cannot tell a work item id from a synthetic band-header id; they
    // arrive in the same list and a uuid route 404s on the latter.
    expect(groupRow).toContain("void assign(source?.data ?? {}, groupKey)");
  });

  it("reports a band assignment that the server refused", () => {
    expect(ganttRoot).toContain("planBandDrop");
    expect(ganttRoot).toContain("describeBandDrop");
  });
});

describe("push dependents says why it did nothing", () => {
  it("tells the toggle how many links there are to push along", () => {
    expect(ganttRoot).toContain("linkCount={graph.length}");
  });

  it("speaks when the switch is on and the project has no dependencies", () => {
    // This was the silent exit: `if (pushDependents && graph.length > 0)` with
    // no else branch, so "no links yet" and "the feature is broken" were the
    // same experience.
    expect(ganttRoot).toContain("pushDependents && graph.length === 0");
    expect(ganttRoot).toContain("Nothing depends on this yet");
  });

  it("says on the portfolio that a push is a per-project thing", () => {
    // The preference is persisted under one key shared by every timeline store,
    // so it arrives here switched on with no relation graph to act on.
    expect(portfolioToolbar).toContain("PushDependentsUnavailable");
  });
});
