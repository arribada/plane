/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Geometry for the workload timeline: turning ISO dates into pixels, and packing
 * a person's overlapping bars into lanes so none of them hides another.
 */

const DAY_MS = 86_400_000;

/**
 * Local midnight for an ISO date.
 *
 * Deliberately NOT `new Date(iso)`, which parses a bare date as UTC and then
 * renders it in local time — west of Greenwich every bar would start a day early.
 */
export const parseDay = (iso: string): Date => new Date(`${iso}T00:00:00`);

/** ISO day for a Date, in the LOCAL calendar (toISOString would shift the day). */
export const isoDay = (value: Date): string => {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
};

/**
 * Whole days between two ISO dates. Rounded rather than floored because a clock
 * change makes one of the days 23 or 25 hours long, and an off-by-one there would
 * slide half the board by a column twice a year.
 */
export const dayOffset = (iso: string, from: string): number =>
  Math.round((parseDay(iso).getTime() - parseDay(from).getTime()) / DAY_MS);

export const addDays = (iso: string, days: number): string => {
  const value = parseDay(iso);
  value.setDate(value.getDate() + days);
  return isoDay(value);
};

export type TZoom = "quarter" | "weeks" | "days";

// Pixels per day. The whole view is laid out from this one number.
export const ZOOM_LEVELS: { key: TZoom; px: number; label: string }[] = [
  { key: "quarter", px: 3, label: "Quarter" },
  { key: "weeks", px: 9, label: "Weeks" },
  { key: "days", px: 26, label: "Days" },
];

export const zoomPx = (zoom: TZoom): number => ZOOM_LEVELS.find((z) => z.key === zoom)?.px ?? 9;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type TBand = { key: string; label: string; offset: number; days: number };

/** One band per calendar month covered by the window, clipped to its edges. */
export const monthBands = (from: string, totalDays: number): TBand[] => {
  const bands: TBand[] = [];
  let cursor = 0;
  // Bounded by totalDays, which the server caps — but the loop advances by at
  // least one day per pass regardless, so it cannot stall on a bad date.
  while (cursor < totalDays) {
    const day = parseDay(addDays(from, cursor));
    const daysInMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    const days = Math.max(1, Math.min(daysInMonth - day.getDate() + 1, totalDays - cursor));
    bands.push({
      key: `${day.getFullYear()}-${day.getMonth()}`,
      label: `${MONTHS[day.getMonth()]} ${day.getFullYear()}`,
      offset: cursor,
      days,
    });
    cursor += days;
  }
  return bands;
};

/** Day offsets of every Monday in the window, with its date for the tick label. */
export const weekTicks = (from: string, totalDays: number): { offset: number; label: string }[] => {
  const out: { offset: number; label: string }[] = [];
  for (let index = 0; index < totalDays; index++) {
    const day = parseDay(addDays(from, index));
    if (day.getDay() === 1) out.push({ offset: index, label: `${day.getDate()}` });
  }
  return out;
};

/**
 * Saturday/Sunday shading as one repeating gradient rather than two divs per week.
 * The period is exactly a week, so the whole background is a single paint.
 */
export const weekendBackground = (
  from: string,
  px: number
): { backgroundImage: string; backgroundPosition: string } => {
  const shade = "rgba(120,135,160,0.10)";
  const week = 7 * px;
  const toSaturday = (6 - parseDay(from).getDay() + 7) % 7;
  return {
    backgroundImage: `repeating-linear-gradient(to right, ${shade} 0px, ${shade} ${2 * px}px, transparent ${2 * px}px, transparent ${week}px)`,
    backgroundPosition: `${toSaturday * px}px 0`,
  };
};

export type TLaneBar = { id: string; startIndex: number; endIndex: number };

/**
 * Greedy lane packing: the first lane whose last bar has already finished.
 *
 * A person is one row, but two of their tasks running at once cannot share one
 * line — drawn on top of each other, the second one is simply invisible, which is
 * the exact thing this view exists to show. So the row grows a lane instead. A
 * tall person row is itself the signal.
 *
 * `endIndex` is INCLUSIVE, so a lane is free only from the day after its last bar
 * ends — `end < start`, never `end <= start`.
 */
export const packLanes = (bars: TLaneBar[]): { laneOf: Record<string, number>; laneCount: number } => {
  const lastEnd: number[] = [];
  const laneOf: Record<string, number> = {};
  // toSorted is ES2023 and this workspace targets earlier; the spread already made
  // a fresh array, so sorting it in place mutates nothing the caller holds.
  // oxlint-disable-next-line unicorn/no-array-sort
  const ordered = [...bars].sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
  for (const bar of ordered) {
    let lane = lastEnd.findIndex((end) => end < bar.startIndex);
    if (lane === -1) {
      lane = lastEnd.length;
      lastEnd.push(bar.endIndex);
    } else {
      lastEnd[lane] = bar.endIndex;
    }
    laneOf[bar.id] = lane;
  }
  return { laneOf, laneCount: Math.max(1, lastEnd.length) };
};

/** The year, but only when it is not the current one — "4 Jan" vs "4 Jan 2027". */
const yearSuffix = (value: Date): string =>
  value.getFullYear() === new Date().getFullYear() ? "" : ` ${value.getFullYear()}`;

/** "5–7 Aug" / "28 Jul – 4 Aug" / "28 Dec 2026 – 4 Jan 2027". */
export const formatRange = (startIso: string, endIso: string): string => {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (startIso === endIso) return `${start.getDate()} ${MONTHS[start.getMonth()]}${yearSuffix(start)}`;
  if (sameMonth) return `${start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}${yearSuffix(end)}`;
  return `${start.getDate()} ${MONTHS[start.getMonth()]}${yearSuffix(start)} – ${end.getDate()} ${MONTHS[end.getMonth()]}${yearSuffix(end)}`;
};

export const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);
