/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The calendar the push is measured in. Everything downstream — how far a chain
 * moves, what a "same duration" shift means when a date is dragged past its
 * partner — is this arithmetic, so it is pinned before any of it.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_WORKING_STEPS,
  addWorkingDays,
  fromEpochDay,
  isNonWorking,
  localEpochDay,
  localWeekday,
  toEpochDay,
  weekdaysBetween,
  workingDaysBetween,
  workingDelta,
} from "./working-days";

// 2026-08-10 is a Monday; the week runs Mon 10 → Sun 16.
const MON = toEpochDay("2026-08-10") as number;
const FRI = toEpochDay("2026-08-14") as number;
const SAT = toEpochDay("2026-08-15") as number;
const NEXT_MON = toEpochDay("2026-08-17") as number;

describe("toEpochDay", () => {
  it("reads an ISO date", () => {
    expect(fromEpochDay(toEpochDay("2026-08-10") as number)).toBe("2026-08-10");
  });

  it("refuses a date that is not one", () => {
    // Date.UTC would roll this into 3 March, and a date that rolls is a typo,
    // not a plan.
    expect(toEpochDay("2026-02-31")).toBeNull();
    expect(toEpochDay("not-a-date")).toBeNull();
    expect(toEpochDay(null)).toBeNull();
    expect(toEpochDay(undefined)).toBeNull();
  });

  it("ignores a time suffix rather than choking on it", () => {
    expect(toEpochDay("2026-08-10T00:00:00Z")).toBe(MON);
  });

  it("reads the weekday from the date itself, not from the reader's timezone", () => {
    // The whole reason this file works in epoch days: `new Date("2026-08-15")`
    // is UTC midnight, and `.getDay()` on it answers in local time — which moves
    // the day for anybody west of Greenwich and would shade the wrong column.
    expect(isNonWorking(SAT)).toBe(true);
    expect(isNonWorking(MON)).toBe(false);
  });
});

describe("weekdaysBetween", () => {
  it("counts an inclusive Mon–Fri week as five", () => {
    expect(weekdaysBetween(MON, FRI)).toBe(5);
  });

  it("is zero on an empty range rather than one", () => {
    // Deliberately unfloored: this is a COUNT. The floor belongs to whoever is
    // asking for a duration — see `_working_days_between` server-side.
    expect(weekdaysBetween(FRI, MON)).toBe(0);
  });

  it("does not count a weekend", () => {
    expect(weekdaysBetween(SAT, SAT + 1)).toBe(0);
    expect(weekdaysBetween(MON, NEXT_MON)).toBe(6);
  });

  it("is exact at a distance no walk could survive", () => {
    // The date bomb, in the client's calendar. A row dated in the year 9999 must
    // produce a number, not a hang and not an overflow.
    const far = toEpochDay("9999-12-31") as number;
    expect(weekdaysBetween(MON, far)).toBeGreaterThan(2_000_000);
  });
});

describe("workingDaysBetween", () => {
  it("subtracts a holiday, but only one that falls on a weekday", () => {
    const wednesday = toEpochDay("2026-08-12") as number;
    expect(workingDaysBetween(MON, FRI, [wednesday])).toBe(4);
    expect(workingDaysBetween(MON, FRI, [SAT])).toBe(5);
  });
});

describe("workingDelta", () => {
  it("is +1 from Friday to the following Monday", () => {
    expect(workingDelta(FRI, NEXT_MON)).toBe(1);
  });

  it("is signed", () => {
    expect(workingDelta(NEXT_MON, FRI)).toBe(-1);
    expect(workingDelta(MON, MON)).toBe(0);
  });

  it("counts a whole week as five, not seven", () => {
    expect(workingDelta(MON, NEXT_MON)).toBe(5);
  });
});

describe("addWorkingDays", () => {
  it("steps over the weekend", () => {
    expect(fromEpochDay(addWorkingDays(FRI, 1) as number)).toBe("2026-08-17");
  });

  it("round-trips with workingDelta", () => {
    for (const n of [1, 3, 5, 12, -1, -4, -10]) {
      const landed = addWorkingDays(MON, n) as number;
      expect(workingDelta(MON, landed)).toBe(n);
    }
  });

  it("steps over a workspace closure as well as a weekend", () => {
    const closed = new Set(["2026-08-11"]);
    expect(fromEpochDay(addWorkingDays(MON, 1, (iso) => closed.has(iso)) as number)).toBe("2026-08-12");
  });

  it("refuses rather than clamping when the walk is beyond any plan", () => {
    // The date-bomb lesson: a silently clamped date is how a bad row becomes a
    // permanent one. The caller turns this null into a named refusal.
    expect(addWorkingDays(MON, MAX_WORKING_STEPS + 1)).toBeNull();
    expect(addWorkingDays(MON, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("localEpochDay", () => {
  it("reads the calendar day off a local Date, not the hours since the epoch", () => {
    // The chart's own helpers build Dates as `new Date(year, month, day)` — local
    // midnight — so this is the bridge from that half of the codebase into the
    // epoch-day arithmetic the rest of the fork uses.
    expect(fromEpochDay(localEpochDay(new Date(2026, 7, 10)))).toBe("2026-08-10");
    expect(fromEpochDay(localEpochDay(new Date(2026, 0, 1)))).toBe("2026-01-01");
    expect(fromEpochDay(localEpochDay(new Date(2026, 11, 31)))).toBe("2026-12-31");
  });

  it("steps by exactly one across a clock change", () => {
    // The reason it exists. Dividing `getTime()` by a day counts real hours, and
    // one of these days is 23 or 25 of them wherever summer time is observed; the
    // answer would jump by 0 or 2 instead of 1 and the whole ruler above the chart
    // would slide a column. Walked over the whole year so no zone's transition —
    // northern, southern, or a half-hour offset — falls between the samples.
    const jumps: string[] = [];
    for (let offset = 1; offset < 365; offset += 1) {
      const day = new Date(2026, 0, 1 + offset);
      const previous = new Date(2026, 0, offset);
      const step = localEpochDay(day) - localEpochDay(previous);
      if (step !== 1) jumps.push(`${day.toDateString()} stepped ${step}`);
    }
    expect(jumps).toEqual([]);
  });

  it("agrees with toEpochDay for the same calendar day", () => {
    expect(localEpochDay(new Date(2026, 9, 25))).toBe(toEpochDay("2026-10-25"));
    expect(localEpochDay(new Date(2026, 2, 29))).toBe(toEpochDay("2026-03-29"));
  });
});

describe("localWeekday", () => {
  it("answers in the local calendar, Sunday first", () => {
    expect(localWeekday(new Date(2026, 7, 9))).toBe(0); // Sunday
    expect(localWeekday(new Date(2026, 7, 10))).toBe(1); // Monday
    expect(localWeekday(new Date(2026, 7, 15))).toBe(6); // Saturday
  });

  it("matches the Date's own getDay for every day of the year", () => {
    const disagreements: string[] = [];
    for (let offset = 0; offset < 365; offset += 1) {
      const day = new Date(2026, 0, 1 + offset);
      if (localWeekday(day) !== day.getDay()) disagreements.push(day.toDateString());
    }
    expect(disagreements).toEqual([]);
  });
});
