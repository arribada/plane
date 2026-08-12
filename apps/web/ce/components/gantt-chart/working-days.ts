/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Working-day arithmetic on ISO dates, for the client.
 *
 * The chart is drawn in calendar days but the plan is authored in WORKING days
 * everywhere else in this fork: `scheduling.plus_working_days` places a cascaded
 * successor, `_working_span` preserves a task's duration across a move, the slack
 * tails are counted in them, and the overlay shades weekends and workspace
 * holidays precisely so a reader can see that a bar spanning a Saturday is not
 * two more days of work. A shift measured in raw calendar days would contradict
 * every one of those and would routinely land a task on a Sunday.
 *
 * Two rules, taken from the backend so the two halves cannot drift:
 *
 *   * counting is ARITHMETIC, never a walk. One work item dated 9999-12-31 used
 *     to make the equivalent backend loop raise `OverflowError` and 500 the gantt
 *     permanently; see `weekdays_between` in scheduling.py. `weekdaysBetween`
 *     here is the same closed form.
 *   * stepping is BOUNDED. `addWorkingDays` walks — it has to, because a holiday
 *     set has no closed form — so it carries a hard step ceiling and its caller
 *     refuses spans beyond a plausible horizon rather than clamping silently.
 *
 * Dates are handled as integer epoch days, never as local `Date`s: `new
 * Date("2026-08-12").getDay()` answers in the reader's timezone and shifts the
 * weekday for anybody west of Greenwich, which would shade — and schedule — the
 * wrong column.
 */

const MS_PER_DAY = 86_400_000;

/** 1970-01-01 was a Thursday, so day 0 has weekday 4 with Sunday = 0. */
const weekdayOf = (epochDay: number): number => (((epochDay + 4) % 7) + 7) % 7;

/**
 * The epoch day of a `Date`'s LOCAL calendar day.
 *
 * The bridge for the parts of the chart that already hold a `Date` rather than an
 * ISO string — upstream's `views/helpers.ts` builds them with `new Date(year,
 * month, day)`, which is local midnight.
 *
 * `Date.UTC` of the local Y/M/D, NOT `getTime() / MS_PER_DAY`. Dividing the
 * timestamp counts real elapsed hours, and a clock change makes a day 23 or 25 of
 * them: from late March to late October a northern reader's `(now - jan1) / 7 days`
 * lands an hour short of the boundary and floors to the previous week, which is
 * exactly how the week-number ruler above the chart used to read one too low for
 * seven months of the year. Reading the calendar fields off the Date and rebuilding
 * them as UTC discards the offset entirely, so there is nothing left to drift.
 */
export const localEpochDay = (value: Date): number =>
  Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY);

/** Sunday = 0, for a `Date` read in its own local calendar. */
export const localWeekday = (value: Date): number => weekdayOf(localEpochDay(value));

/**
 * `yyyy-mm-dd` for the LOCAL calendar day of an instant.
 *
 * Derived from the two above rather than written out again, so there is one rule
 * in this file and not three. `workload/scale.ts:isoDay` is the same function for
 * the workload view and predates this one; converge them if that file is ever
 * opened for another reason.
 */
export const isoLocalDay = (value: Date): string => fromEpochDay(localEpochDay(value));

/**
 * Today, as the reader's own calendar day.
 *
 * The thing `new Date().toISOString().slice(0, 10)` is reaching for and does not
 * get: `toISOString` answers in UTC, so at UTC+13 the whole local morning is
 * stamped yesterday and at UTC-8 the local evening is stamped tomorrow. That is a
 * plan marked "past due" a day early on one side of the world and a day late on
 * the other, and an export named for a day nobody was having.
 */
export const todayIso = (): string => isoLocalDay(new Date());

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `yyyy-mm-dd` -> epoch day, or null if it is not a date this fork will plan on. */
export const toEpochDay = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const match = ISO.exec(iso.slice(0, 10));
  if (!match) return null;
  const [, year, month, day] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(ms)) return null;
  // Round-trip check: Date.UTC happily rolls 2026-02-31 into 3 March, and a date
  // that rolled is a typo, not a plan.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== Number(year) || back.getUTCMonth() + 1 !== Number(month)) return null;
  if (back.getUTCDate() !== Number(day)) return null;
  return Math.round(ms / MS_PER_DAY);
};

export const fromEpochDay = (epochDay: number): string => new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);

/** A day nobody works: Saturday, Sunday, or a day the workspace has closed. */
export const isNonWorking = (epochDay: number, isHoliday?: (iso: string) => boolean): boolean => {
  const weekday = weekdayOf(epochDay);
  if (weekday === 0 || weekday === 6) return true;
  return isHoliday ? isHoliday(fromEpochDay(epochDay)) : false;
};

/**
 * Mon–Fri days in the inclusive range, 0 when the range is empty.
 *
 * Holidays are NOT subtracted here — the caller that knows them does it, exactly
 * as `weekdays_between` leaves it to `_working_days_between` and
 * `_count_working_days`, which disagree about the floor on purpose. This function
 * has no floor: it is a count, not a duration.
 */
export const weekdaysBetween = (start: number, end: number): number => {
  if (end < start) return 0;
  const days = end - start + 1;
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  let count = weeks * 5;
  const first = weekdayOf(start);
  for (let offset = 0; offset < rest; offset += 1) {
    const weekday = (first + offset) % 7;
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
};

/** Working days in the inclusive range, weekends and closures both removed. */
export const workingDaysBetween = (start: number, end: number, holidays?: Iterable<number>): number => {
  if (end < start) return 0;
  let count = weekdaysBetween(start, end);
  if (holidays) {
    // Over the holiday SET, never over the range: the range can be decades, the
    // set is a couple of dozen days a year.
    for (const day of holidays) {
      if (day < start || day > end) continue;
      const weekday = weekdayOf(day);
      if (weekday !== 0 && weekday !== 6) count -= 1;
    }
  }
  return Math.max(0, count);
};

/**
 * Signed working days from `from` to `to`, counting the destination and not the
 * origin — so one working day forward is +1 and the same day is 0.
 */
export const workingDelta = (from: number, to: number, holidays?: Iterable<number>): number => {
  if (to === from) return 0;
  return to > from ? workingDaysBetween(from + 1, to, holidays) : -workingDaysBetween(to + 1, from, holidays);
};

/** How far `addWorkingDays` will ever step. ~55 years, which no drag reaches and
 *  no plausible plan spans; a row that needs more is bad data, and the caller
 *  refuses it rather than being handed a quietly clamped answer. */
export const MAX_WORKING_STEPS = 20_000;

/**
 * `count` working days after (or, negative, before) `day`.
 *
 * Returns null when the walk would exceed the ceiling, which is the honest answer
 * for a row dated in the year 9999: there IS no sensible date that far out, and
 * the alternative — clamping to `date.max` and writing it — is how a bad row
 * becomes a permanent one.
 */
export const addWorkingDays = (day: number, count: number, isHoliday?: (iso: string) => boolean): number | null => {
  if (count === 0) return day;
  if (!Number.isFinite(count) || Math.abs(count) > MAX_WORKING_STEPS) return null;
  const step = count > 0 ? 1 : -1;
  let remaining = Math.abs(count);
  let cursor = day;
  let guard = 0;
  while (remaining > 0) {
    guard += 1;
    if (guard > MAX_WORKING_STEPS) return null;
    cursor += step;
    if (!isNonWorking(cursor, isHoliday)) remaining -= 1;
  }
  return cursor;
};
