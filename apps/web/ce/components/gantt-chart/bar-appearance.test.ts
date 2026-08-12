/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * How a work-item timeline bar is drawn, given a work item and its state group.
 *
 * `barLook` had no tests, which is how `done` came to mean two different state
 * groups at once for as long as it did: `completed` and `cancelled` both
 * answered it, so `blocks.tsx` drew the same 45° hatch and the same ✓ on
 * delivered work and on abandoned work. The reasoning was that the toggle asks
 * "what is still ahead of me" and neither is — which is true of the toggle and
 * not true of the tick.
 *
 * Plane groups every state into one of five: `backlog`, `unstarted` (Todo),
 * `started` (In progress), `completed` (Done) and `cancelled`. All five are
 * exercised here, including the three that are deliberately drawn plain.
 */
import { describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { barLook, readableOn } from "./bar-appearance";

const FILL = "#386be2";
const issue = (fields: Partial<TIssue> = {}) => ({ id: "i1", ...fields }) as TIssue;

/** A fixed "today" so the overdue assertions do not drift with the wall clock —
 *  and a LOCAL date, because the whole reason this suite runs under two
 *  non-UTC zones is that `midnight()` is local and a UTC-only run proves
 *  nothing about the people reading this chart. */
const TODAY = new Date(2026, 8, 15); // 15 Sept 2026, local

describe("the five state groups", () => {
  it("calls only `completed` finished", () => {
    expect(barLook(issue(), FILL, "completed", TODAY).done).toBe(true);
    for (const group of ["backlog", "unstarted", "started", "cancelled", undefined, null])
      expect(barLook(issue(), FILL, group, TODAY).done).toBe(false);
  });

  it("calls only `cancelled` cancelled", () => {
    expect(barLook(issue(), FILL, "cancelled", TODAY).cancelled).toBe(true);
    for (const group of ["backlog", "unstarted", "started", "completed", undefined, null])
      expect(barLook(issue(), FILL, group, TODAY).cancelled).toBe(false);
  });

  it("gives backlog, todo and in-progress no treatment at all", () => {
    // Restraint, stated as a test. They are the ordinary run of work, `state` is
    // already a colour-by axis carrying the team's own colours, and a default
    // that is marked is not a default. See the note at the bottom of palette.ts.
    for (const group of ["backlog", "unstarted", "started"]) {
      const look = barLook(issue(), FILL, group, TODAY);
      expect(look.done).toBe(false);
      expect(look.cancelled).toBe(false);
    }
  });
});

describe("overdue", () => {
  const late = { start_date: "2026-09-01", target_date: "2026-09-10" };

  it("marks work that is past its date and still expected", () => {
    expect(barLook(issue(late), FILL, "started", TODAY).overdue).toBe(true);
    expect(barLook(issue(late), FILL, "backlog", TODAY).overdue).toBe(true);
  });

  it("does not mark finished work overdue", () => {
    expect(barLook(issue(late), FILL, "completed", TODAY).overdue).toBe(false);
  });

  it("does not mark CANCELLED work overdue — nobody is waiting for it", () => {
    // The trap in splitting `done` in two: `overdue: !done && …` would have
    // turned every abandoned item red the moment `done` stopped covering
    // `cancelled`, on a board whose red ring means "this is late".
    expect(barLook(issue(late), FILL, "cancelled", TODAY).overdue).toBe(false);
  });

  it("says nothing about an item with no target date", () => {
    expect(barLook(issue({ start_date: "2026-09-01" }), FILL, "started", TODAY).overdue).toBe(false);
    expect(barLook(undefined, FILL, "started", TODAY).overdue).toBe(false);
  });

  /**
   * PINNED, NOT ENDORSED — and found by this file rather than by a report.
   *
   * `midnight()` does `new Date("2026-09-15")`, which the spec parses as UTC
   * midnight, and then `setHours(0,0,0,0)`, which moves it to local midnight of
   * whatever LOCAL date that instant falls on. West of Greenwich that is the day
   * BEFORE, so an item due today draws the red "past its due date" ring for
   * every reader in the Americas — and only for them, which is why nobody sitting
   * in Europe has ever seen it.
   *
   * The suite runs under `America/Los_Angeles` and `Pacific/Auckland` precisely
   * to catch this class, so the two zones are asserted apart rather than the
   * difference being averaged away. Left as it is because changing when the
   * overdue ring appears is a behaviour change nobody asked for in a pass about
   * state colours; it is reported instead. The fix is to read a `YYYY-MM-DD` as
   * a local calendar date rather than an instant.
   */
  it("is a day early west of Greenwich, and right east of it (a pre-existing defect)", () => {
    const dueToday = barLook(issue({ target_date: "2026-09-15" }), FILL, "started", TODAY).overdue;
    const westOfUtc = new Date(2026, 8, 15).getTimezoneOffset() > 0;
    expect(dueToday).toBe(westOfUtc);
  });
});

describe("milestones", () => {
  it("takes the project's own marks when the project has any", () => {
    expect(barLook(issue(), FILL, "started", TODAY, true).milestone).toBe(true);
    // A three-day item somebody marked IS a deliverable; the same-day guess would
    // have said no.
    expect(
      barLook(issue({ start_date: "2026-09-01", target_date: "2026-09-04" }), FILL, "started", TODAY, false).milestone
    ).toBe(false);
  });

  it("falls back to the same-day guess only where nobody has marked anything", () => {
    const sameDay = { start_date: "2026-09-01", target_date: "2026-09-01" };
    expect(barLook(issue(sameDay), FILL, "started", TODAY).milestone).toBe(true);
    expect(
      barLook(issue({ start_date: "2026-09-01", target_date: "2026-09-04" }), FILL, "started", TODAY).milestone
    ).toBe(false);
  });
});

describe("the label colour", () => {
  it("is chosen by luminance rather than by theme", () => {
    // A bar can be any colour a team picked for a label, so the text pairing
    // cannot come from the theme.
    expect(readableOn("#ffffff")).toBe("#111827");
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(barLook(issue(), "#ffffff", "started", TODAY).text).toBe("#111827");
  });

  it("keeps dark text on a colour it cannot parse rather than making the label vanish", () => {
    // Every comparison against NaN is false, which silently chose white text and
    // erased the label on a pale bar.
    expect(readableOn("rebeccapurple")).toBe("#111827");
    expect(readableOn("#12345")).toBe("#111827");
  });
});
