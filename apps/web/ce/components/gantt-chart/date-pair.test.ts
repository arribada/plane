/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Setting one end of a work item's window past the other.
 *
 * Before this, the two date pickers clamped each other (`maxDate` on the start,
 * `minDate` on the end), so the day was greyed out and nothing said why —
 * the silent-failure class this fork spent a week removing, in a date picker
 * rather than in an HTTP catch. The rule now: accept the date, work out what it
 * implies, and let the caller ask.
 */
import { describe, expect, it } from "vitest";
import { resolveDatePairEdit } from "./date-pair";

const item = { start_date: "2026-08-10", target_date: "2026-08-12" }; // Mon → Wed, 3 working days

describe("resolveDatePairEdit", () => {
  it("writes the one field when the pair stays in order", () => {
    expect(resolveDatePairEdit("start_date", "2026-08-11", item)).toEqual({
      kind: "ok",
      patch: { start_date: "2026-08-11" },
    });
  });

  it("writes the one field when there is no partner to cross", () => {
    expect(resolveDatePairEdit("start_date", "2026-08-20", { target_date: null })).toEqual({
      kind: "no-pair",
      patch: { start_date: "2026-08-20" },
    });
  });

  it("never asks about clearing a date", () => {
    expect(resolveDatePairEdit("target_date", null, item)).toEqual({ kind: "ok", patch: { target_date: null } });
  });

  it("asks when a start would land after the end, and moves both keeping the duration", () => {
    const decision = resolveDatePairEdit("start_date", "2026-08-17", item);
    expect(decision.kind).toBe("shift");
    if (decision.kind !== "shift") return;
    // Three working days, counted the way `_working_days_between` counts them —
    // the same definition the budget charges by and the cascade preserves.
    expect(decision.duration).toBe(3);
    expect(decision.patch).toEqual({ start_date: "2026-08-17", target_date: "2026-08-19" });
    expect(decision.moving).toBe("target_date");
    expect(decision.movingFrom).toBe("2026-08-12");
  });

  it("does the mirror case — an end before the start shifts backwards", () => {
    // Fixing one direction only would leave the other silently blocked, which is
    // the bug.
    const decision = resolveDatePairEdit("target_date", "2026-08-05", item);
    expect(decision.kind).toBe("shift");
    if (decision.kind !== "shift") return;
    expect(decision.patch).toEqual({ start_date: "2026-08-03", target_date: "2026-08-05" });
    expect(decision.moving).toBe("start_date");
  });

  it("counts the preserved duration in working days, so a weekend is not two days of work", () => {
    // Fri → Mon is 2 working days. Moved to a Wednesday start it must end on the
    // Thursday, not four calendar days later.
    const friToMon = { start_date: "2026-08-14", target_date: "2026-08-17" };
    const decision = resolveDatePairEdit("start_date", "2026-08-19", friToMon);
    expect(decision.kind).toBe("shift");
    if (decision.kind !== "shift") return;
    expect(decision.duration).toBe(2);
    expect(decision.patch).toEqual({ start_date: "2026-08-19", target_date: "2026-08-20" });
  });

  it("floors a same-day item at one working day rather than zero", () => {
    const sameDay = { start_date: "2026-08-12", target_date: "2026-08-12" };
    const decision = resolveDatePairEdit("start_date", "2026-08-19", sameDay);
    expect(decision.kind).toBe("shift");
    if (decision.kind !== "shift") return;
    expect(decision.duration).toBe(1);
    expect(decision.patch).toEqual({ start_date: "2026-08-19", target_date: "2026-08-19" });
  });

  it("gives a half-dated item a one-day window rather than leaving it inverted", () => {
    // Only an end date, and a start chosen after it. There is no duration to
    // preserve — nobody ever said how long it takes — so it floors at one day at
    // the date that was actually chosen. Pinned because the alternative (keep the
    // end, refuse the start) would leave the pair inverted, which is the state
    // this whole file exists to prevent.
    const endOnly = { start_date: null, target_date: "2026-08-12" };
    const decision = resolveDatePairEdit("start_date", "2026-08-19", endOnly);
    expect(decision.kind).toBe("shift");
    if (decision.kind !== "shift") return;
    expect(decision.duration).toBe(1);
    expect(decision.patch).toEqual({ start_date: "2026-08-19", target_date: "2026-08-19" });
  });

  it("steps the moved end over a workspace closure", () => {
    // Three working days from Wed 19 Aug with the Thursday closed: Wed counts,
    // Thu does not, Fri is the second, the weekend does not, Mon 24 is the third.
    // Without the closure it would land on Fri 21 — the difference is the point.
    const closed = new Set(["2026-08-20"]);
    expect(resolveDatePairEdit("start_date", "2026-08-19", item).kind).toBe("shift");
    const plain = resolveDatePairEdit("start_date", "2026-08-19", item);
    if (plain.kind === "shift") expect(plain.patch.target_date).toBe("2026-08-21");

    const decision = resolveDatePairEdit("start_date", "2026-08-19", item, (iso) => closed.has(iso));
    expect(decision.kind).toBe("shift");
    if (decision.kind !== "shift") return;
    expect(decision.patch).toEqual({ start_date: "2026-08-19", target_date: "2026-08-24" });
  });
});
