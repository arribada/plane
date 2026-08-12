/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The width of a gantt bar is a WRITTEN value, not a drawn one.
 *
 * `base-timeline.store.ts:getUpdatedPositionAfterDrag` turns `marginLeft + width`
 * back into `target_date`, and `handleMouseUp` in `use-gantt-resizable.ts` fires it
 * for a plain click as well as for a real drag — the listener is armed by
 * `onMouseDown` and has no "did anything move?" guard. So an off-by-one in this
 * geometry is not a cosmetic column: it is a date that walks forward one day every
 * time somebody clicks the bar to read it.
 *
 * These tests are worth little at UTC, which is the one offset where the arithmetic
 * is exact. CI pins a western and an eastern timezone for exactly that reason; see
 * `.github/workflows/arribada-build.yml`.
 */
import type { ChartDataType, IGanttBlock } from "@plane/types";
import { describe, expect, it } from "vitest";
import { toEpochDay } from "@/plane-web/components/gantt-chart/working-days";
import { getItemPositionWidth, getWeekNumberByDate } from "./helpers";

const DAY_WIDTH = 20;

const chart = (): ChartDataType => ({
  key: "week",
  i18n_title: "week",
  data: {
    startDate: new Date("2026-01-01T00:00:00"),
    currentDate: new Date("2026-01-01T00:00:00"),
    endDate: new Date("2027-01-01T00:00:00"),
    approxFilterRange: 6,
    dayWidth: DAY_WIDTH,
  },
});

const block = (start: string, target: string): IGanttBlock => ({
  data: {},
  id: "block-1",
  name: "block",
  sort_order: 1,
  start_date: start,
  target_date: target,
});

/** Columns a bar covering `start`..`target` inclusive must occupy. */
const expectedColumns = (start: string, target: string): number => {
  const from = toEpochDay(start);
  const to = toEpochDay(target);
  if (from === null || to === null) throw new Error(`unparseable range ${start}..${target}`);
  return to - from + 1;
};

describe("getItemPositionWidth", () => {
  it("draws a bar spanning the October clock change at its true width", () => {
    // The northern-hemisphere fall-back. Between these two local midnights there
    // are 11 days and 25 hours' worth of them west of the date line, so the naive
    // quotient is -10.0417 and `Math.floor` rounds AWAY from zero to -11 — a bar
    // one column too wide, which `getUpdatedPositionAfterDrag` then writes back as
    // 31 October.
    const result = getItemPositionWidth(chart(), block("2026-10-20", "2026-10-30"));

    expect(result).toBeDefined();
    expect(result?.width).toBe(expectedColumns("2026-10-20", "2026-10-30") * DAY_WIDTH);
    expect(result?.width).toBe(11 * DAY_WIDTH);
  });

  it("draws a bar spanning the US fall-back at its true width", () => {
    // A week later than Europe's, so a suite pinned to one western zone catches
    // whichever of the two its own rules put inside the span.
    const result = getItemPositionWidth(chart(), block("2026-10-25", "2026-11-05"));

    expect(result?.width).toBe(expectedColumns("2026-10-25", "2026-11-05") * DAY_WIDTH);
  });

  it("draws a bar spanning the spring transition at its true width", () => {
    // The 23-hour day rounds the right way even under floor, so this one passed
    // before the fix too. It is here so a future change that swaps the rounding for
    // something clever has to keep both directions honest.
    const result = getItemPositionWidth(chart(), block("2026-03-20", "2026-03-30"));

    expect(result?.width).toBe(expectedColumns("2026-03-20", "2026-03-30") * DAY_WIDTH);
  });

  it("agrees with the calendar for every start date in the year", () => {
    // The exhaustive form, so no transition anywhere in the reader's zone — northern
    // or southern, half-hour offsets included — can hide in a gap between hand-picked
    // dates. An eleven-day bar is eleven columns on all 365 of them.
    const failures: string[] = [];

    const first = toEpochDay("2026-01-01");
    if (first === null) throw new Error("unparseable epoch");

    for (let offset = 0; offset < 365; offset += 1) {
      const startDay = first + offset;
      const start = new Date(startDay * 86_400_000).toISOString().slice(0, 10);
      const target = new Date((startDay + 10) * 86_400_000).toISOString().slice(0, 10);

      const width = getItemPositionWidth(chart(), block(start, target))?.width;
      if (width !== 11 * DAY_WIDTH) failures.push(`${start}..${target} => ${width}`);
    }

    expect(failures).toEqual([]);
  });

  it("gives a one-day task a single column", () => {
    const result = getItemPositionWidth(chart(), block("2026-10-25", "2026-10-25"));

    expect(result?.width).toBe(DAY_WIDTH);
  });
});

describe("getWeekNumberByDate", () => {
  it("puts 1 January in week 1 and the following Sunday in week 2", () => {
    expect(getWeekNumberByDate(new Date(2026, 0, 1))).toBe(1);
    expect(getWeekNumberByDate(new Date(2026, 0, 3))).toBe(1);
    // 4 January 2026 is a Sunday, and upstream's rule starts weeks on Sunday.
    expect(getWeekNumberByDate(new Date(2026, 0, 4))).toBe(2);
  });

  it("advances by exactly one, on Sundays and only on Sundays, all year", () => {
    // A property rather than a table, and one that does not restate the formula:
    // whatever the numbering, it must step at week boundaries and nowhere else.
    //
    // The old implementation divided a span of MILLISECONDS by a week. Once summer
    // time is in force the span from the year's first week start is an hour short
    // of a whole number of weeks, so on every Sunday between the spring and autumn
    // changes the quotient fell just under the boundary and the ruler above the
    // chart read one week too low — thirty-four Sundays a year in California, and
    // the same fault from late March to late October in Europe. It then caught up
    // on the Monday, so the number was not merely wrong, it stepped on the wrong
    // day.
    const wrongSteps: string[] = [];

    for (let offset = 1; offset < 365; offset += 1) {
      const day = new Date(2026, 0, 1 + offset);
      const previous = new Date(2026, 0, offset);
      const step = getWeekNumberByDate(day) - getWeekNumberByDate(previous);
      const expected = day.getDay() === 0 ? 1 : 0;
      if (step !== expected) wrongSteps.push(`${day.toDateString()} stepped ${step}, expected ${expected}`);
    }

    expect(wrongSteps).toEqual([]);
  });
});
