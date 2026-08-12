/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Given a move of N days, which items move and by how much."
 *
 * jsdom has no drag physics — no mouse, no pointer capture, no layout — so the
 * gesture itself cannot be tested here and needs a real browser. The DECISION
 * behind it can be, and that is where every rule lives: transitivity, which end
 * of the bar a given edge kind follows, what a locked or foreign or
 * delivery-floored dependent does, and whether the answer is in working days.
 */
import { describe, expect, it } from "vitest";
import type { TGraphEdge } from "./edges";
import { describePush, pushDependents } from "./push-dependents";

// Mon 10 Aug 2026 … Fri 14 Aug, then Mon 17 Aug.
const span = (start: string, target: string) => ({ start_date: start, target_date: target });

const FS = (from: string, to: string): TGraphEdge => ({ from, to, kind: "FS" });
const SS = (from: string, to: string): TGraphEdge => ({ from, to, kind: "SS" });

describe("pushDependents", () => {
  it("shifts a direct successor by the same number of working days", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-12"),
      after: span("2026-08-17", "2026-08-19"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-17", "2026-08-19"), b: span("2026-08-13", "2026-08-14") },
    });
    // Mon→Mon is five WORKING days, not seven calendar ones.
    expect(outcome.finishDelta).toBe(5);
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-20", target_date: "2026-08-21" }]);
  });

  it("cascades transitively down the whole chain, not one level", () => {
    // A one-level push leaves the link between b and c violated by the very
    // gesture meant to keep the plan consistent.
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b"), FS("b", "c"), FS("c", "d")],
      spans: {
        a: span("2026-08-11", "2026-08-11"),
        b: span("2026-08-12", "2026-08-12"),
        c: span("2026-08-13", "2026-08-13"),
        d: span("2026-08-14", "2026-08-14"),
      },
    });
    expect(outcome.moves.map((m) => m.id)).toEqual(["b", "c", "d"]);
    expect(outcome.moves.every((m) => m.start_date === m.target_date)).toBe(true);
    expect(outcome.moves.map((m) => m.start_date)).toEqual(["2026-08-13", "2026-08-14", "2026-08-17"]);
  });

  it("preserves the gaps in the chain instead of squeezing them out", () => {
    // This is the whole difference from `cascade()`, which would pull b up
    // against a. A two-week cure or a review window is deliberate, and a drag is
    // not permission to spend it.
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-11"),
      after: span("2026-08-11", "2026-08-12"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-11", "2026-08-12"), b: span("2026-08-20", "2026-08-21") },
    });
    // b was seven days clear of a and still is.
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-21", target_date: "2026-08-24" }]);
  });

  it("preserves a dependent's duration in WORKING days across a weekend", () => {
    // Three working days that happen to span a weekend stay three working days.
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-11", "2026-08-11"), b: span("2026-08-13", "2026-08-17") },
    });
    // b was Thu→Mon (3 working days). One working day later: Fri→Tue.
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-14", target_date: "2026-08-18" }]);
  });

  it("follows the FINISH for an FS edge, so growing a task pushes its successors", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-11"),
      after: span("2026-08-10", "2026-08-13"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-10", "2026-08-13"), b: span("2026-08-17", "2026-08-17") },
    });
    expect(outcome.startDelta).toBe(0);
    expect(outcome.finishDelta).toBe(2);
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-19", target_date: "2026-08-19" }]);
  });

  it("follows the START for an SS edge, so growing a task does not move it", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-11"),
      after: span("2026-08-10", "2026-08-13"),
      edges: [SS("a", "b")],
      spans: { a: span("2026-08-10", "2026-08-13"), b: span("2026-08-17", "2026-08-17") },
    });
    expect(outcome.moves).toEqual([]);
  });

  it("moves nothing when only the start was dragged earlier and the finish held", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-12", "2026-08-14"),
      after: span("2026-08-10", "2026-08-14"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-10", "2026-08-14"), b: span("2026-08-17", "2026-08-18") },
    });
    expect(outcome.finishDelta).toBe(0);
    expect(outcome.moves).toEqual([]);
  });

  it("pulls the chain earlier when the origin moves back", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-17", "2026-08-17"),
      after: span("2026-08-14", "2026-08-14"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-14", "2026-08-14"), b: span("2026-08-18", "2026-08-18") },
    });
    expect(outcome.finishDelta).toBe(-1);
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-17", target_date: "2026-08-17" }]);
  });

  it("takes the LATEST constraint when two moved predecessors disagree", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-13", "2026-08-13"),
      edges: [FS("a", "b"), FS("a", "c"), FS("b", "d"), FS("c", "d")],
      spans: {
        a: span("2026-08-13", "2026-08-13"),
        b: span("2026-08-11", "2026-08-11"),
        c: span("2026-08-11", "2026-08-11"),
        d: span("2026-08-12", "2026-08-12"),
      },
    });
    const moved = new Map(outcome.moves.map((m) => [m.id, m.start_date]));
    expect(moved.get("d")).toBe("2026-08-17"); // 3 working days on from 12 Aug
  });

  it("refuses a dependent the mover may not edit, and names it", () => {
    // A cascade must not become a way around a per-item permission.
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-11", "2026-08-11"), b: span("2026-08-12", "2026-08-12") },
      notEditable: new Set(["b"]),
    });
    expect(outcome.moves).toEqual([]);
    expect(outcome.refused).toEqual([{ id: "b", reason: "not-editable" }]);
  });

  it("refuses a dependent in another project", () => {
    // The write endpoint is scoped to one project, so this push stops at the
    // boundary rather than pretending to have moved something it cannot reach.
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-11", "2026-08-11"), b: span("2026-08-12", "2026-08-12") },
      otherProject: new Set(["b"]),
    });
    expect(outcome.refused).toEqual([{ id: "b", reason: "other-project" }]);
  });

  it("refuses an undated dependent instead of inventing a bar for it", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-11", "2026-08-11"), b: { start_date: null, target_date: null } },
    });
    expect(outcome.refused).toEqual([{ id: "b", reason: "undated" }]);
  });

  it("holds a dependent at its delivery floor rather than dragging it before the parts arrive", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-24", "2026-08-24"),
      after: span("2026-08-17", "2026-08-17"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-17", "2026-08-17"), b: span("2026-08-25", "2026-08-26") },
      floors: { b: "2026-08-20" },
    });
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-20", target_date: "2026-08-21" }]);
    expect(outcome.held).toEqual([{ id: "b", floor: "2026-08-20" }]);
  });

  it("lets a floor bind downwards only — nothing about a part arriving caps a later plan", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-11", "2026-08-11"), b: span("2026-08-12", "2026-08-12") },
      floors: { b: "2026-08-03" },
    });
    expect(outcome.held).toEqual([]);
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-13", target_date: "2026-08-13" }]);
  });

  it("steps a pushed dependent over a workspace closure", () => {
    const closed = new Set(["2026-08-13"]);
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b")],
      spans: { a: span("2026-08-11", "2026-08-11"), b: span("2026-08-12", "2026-08-12") },
      isHoliday: (iso) => closed.has(iso),
    });
    expect(outcome.moves).toEqual([{ id: "b", start_date: "2026-08-14", target_date: "2026-08-14" }]);
  });

  it("terminates on a dependency cycle instead of looping", () => {
    // The fork's own data contains these; `_topo_order` drops them server-side.
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b"), FS("b", "c"), FS("c", "b"), FS("c", "a")],
      spans: {
        a: span("2026-08-11", "2026-08-11"),
        b: span("2026-08-12", "2026-08-12"),
        c: span("2026-08-13", "2026-08-13"),
      },
    });
    // oxlint-disable-next-line unicorn/no-array-sort -- the array is ours alone; toSorted is ES2023 and this workspace targets earlier
    expect(outcome.moves.map((m) => m.id).sort()).toEqual(["b", "c"]);
  });

  it("never touches the origin — the caller is already writing that one", () => {
    const outcome = pushDependents({
      originId: "a",
      before: span("2026-08-10", "2026-08-10"),
      after: span("2026-08-11", "2026-08-11"),
      edges: [FS("a", "b"), FS("b", "a")],
      spans: { a: span("2026-08-11", "2026-08-11"), b: span("2026-08-12", "2026-08-12") },
    });
    expect(outcome.moves.map((m) => m.id)).not.toContain("a");
  });

  it("says nothing moved when the bar was given dates rather than moved", () => {
    const outcome = pushDependents({
      originId: "a",
      before: { start_date: null, target_date: null },
      after: span("2026-08-11", "2026-08-12"),
      edges: [FS("a", "b")],
      spans: { b: span("2026-08-13", "2026-08-13") },
    });
    expect(outcome.moves).toEqual([]);
  });
});

describe("describePush", () => {
  it("names what moved and what did not", () => {
    const sentence = describePush({
      finishDelta: 7,
      startDelta: 7,
      moves: [
        { id: "b", start_date: "2026-08-20", target_date: "2026-08-21" },
        { id: "c", start_date: "2026-08-24", target_date: "2026-08-25" },
      ],
      refused: [
        { id: "d", reason: "not-editable" },
        { id: "e", reason: "other-project" },
      ],
      held: [{ id: "f", floor: "2026-08-20" }],
    });
    expect(sentence).toContain("2 dependent items moved 7 working days later");
    expect(sentence).toContain("1 held at an expected delivery");
    expect(sentence).toContain("1 you may not edit");
    expect(sentence).toContain("1 in another project");
  });
});
