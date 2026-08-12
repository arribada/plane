/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChartDataType, IGanttBlock } from "@plane/types";
import { addDaysToDate, findTotalDaysInRange, getDate } from "@plane/utils";
import { localEpochDay, localWeekday } from "@/plane-web/components/gantt-chart/working-days";
import { DEFAULT_BLOCK_WIDTH } from "../constants";

/**
 * Generates Date by using Day, month and Year
 * @param day
 * @param month
 * @param year
 * @returns
 */
export const generateDate = (day: number, month: number, year: number) => new Date(year, month, day);

/**
 * Returns number of days in month
 * @param month
 * @param year
 * @returns
 */
export const getNumberOfDaysInMonth = (month: number, year: number) => {
  const date = new Date(year, month + 1, 0);

  return date.getDate();
};

/**
 * Returns week number from date
 *
 * Counted in whole CALENDAR days, via `working-days.ts`, and not by dividing a
 * span of milliseconds. The original did the latter, and a millisecond span is not
 * a multiple of a day once a clock change falls inside it: from the spring change
 * in late March to the autumn one in late October, the elapsed time since the
 * year's first week start is one hour short of a whole number of weeks, the
 * quotient lands just under the boundary, and `Math.floor` gives the PREVIOUS
 * week. The ruler above the chart therefore read one too low for seven months of
 * every year, for every reader whose zone observes summer time.
 *
 * The week rule itself is unchanged and is upstream's: weeks start on Sunday, and
 * week 1 is the one containing 1 January.
 *
 * @param date
 * @returns
 */
export const getWeekNumberByDate = (date: Date) => {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);

  // Back up from 1 January to the Sunday that starts its week. Both operands are
  // integer day counts, so this is exact.
  const firstWeekStart = localEpochDay(firstDayOfYear) - localWeekday(firstDayOfYear);

  return Math.floor((localEpochDay(date) - firstWeekStart) / 7) + 1;
};

/**
 * Returns number of days between two dates
 * @param startDate
 * @param endDate
 * @returns
 */
export const getNumberOfDaysBetweenTwoDates = (startDate: Date, endDate: Date) => {
  let daysDifference: number = 0;
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  const timeDifference: number = startDate.getTime() - endDate.getTime();
  daysDifference = Math.round(timeDifference / (1000 * 60 * 60 * 24));

  return daysDifference;
};

/**
 * returns a date corresponding to the position on the timeline chart
 * @param position
 * @param chartData
 * @param offsetDays
 * @returns
 */
export const getDateFromPositionOnGantt = (position: number, chartData: ChartDataType, offsetDays = 0) => {
  const numberOfDaysSinceStart = Math.round(position / chartData.data.dayWidth) + offsetDays;

  const newDate = addDaysToDate(chartData.data.startDate, numberOfDaysSinceStart);

  // (Removed a bare `if (!newDate) undefined;` that evaluated an expression and
  // threw it away. It read as a guard and was not one — the function already
  // returns `newDate` on the next line, undefined included.)
  return newDate;
};

/**
 * returns the  position and width of the block on the timeline chart from startDate and EndDate
 * @param chartData
 * @param itemData
 * @returns
 */
export const getItemPositionWidth = (chartData: ChartDataType, itemData: IGanttBlock) => {
  let scrollPosition: number = 0;
  let scrollWidth: number = DEFAULT_BLOCK_WIDTH;

  const { startDate: chartStartDate } = chartData.data;
  const { start_date, target_date } = itemData;

  const itemStartDate = getDate(start_date);
  const itemTargetDate = getDate(target_date);

  chartStartDate.setHours(0, 0, 0, 0);
  itemStartDate?.setHours(0, 0, 0, 0);
  itemTargetDate?.setHours(0, 0, 0, 0);

  if (!itemStartDate && !itemTargetDate) return;

  // get scroll position from the number of days and width of each day
  scrollPosition = itemStartDate
    ? getPositionFromDate(chartData, itemStartDate, 0)
    : getPositionFromDate(chartData, itemTargetDate!, -1 * DEFAULT_BLOCK_WIDTH + chartData.data.dayWidth);

  if (itemStartDate && itemTargetDate) {
    // get width of block
    const widthTimeDifference: number = itemStartDate.getTime() - itemTargetDate.getTime();
    // ROUNDED, never floored. Both operands are LOCAL midnight, so the quotient is
    // a whole number of days only when no clock change falls inside the span. Across
    // an autumn fall-back the day is 25 hours long and the quotient is -10.0417 for
    // an eleven-column bar; `Math.floor` rounds away from zero to -11 and the bar is
    // drawn one column too wide. That width is not cosmetic — `getUpdatedPositionAfterDrag`
    // turns `marginLeft + width` back into `target_date`, and `handleMouseUp` in
    // use-gantt-resizable.ts fires it for a plain click as well as a drag, so merely
    // opening a bar's peek used to push its target date a day later, and again on the
    // next click, permanently. `workload/scale.ts:dayOffset` rounds for the same reason.
    const widthDaysDifference: number = Math.abs(Math.round(widthTimeDifference / (1000 * 60 * 60 * 24)));
    scrollWidth = (widthDaysDifference + 1) * chartData.data.dayWidth;
  }

  return { marginLeft: scrollPosition, width: scrollWidth };
};

export const getPositionFromDate = (chartData: ChartDataType, date: string | Date, offsetWidth: number) => {
  const currDate = getDate(date);

  const { startDate: chartStartDate } = chartData.data;

  if (!currDate || !chartStartDate) return 0;

  chartStartDate.setHours(0, 0, 0, 0);
  currDate.setHours(0, 0, 0, 0);

  // get number of days from chart start date to block's start date
  const positionDaysDifference = Math.round(findTotalDaysInRange(chartStartDate, currDate, false) ?? 0);

  if (!positionDaysDifference) return 0;

  // get scroll position from the number of days and width of each day
  return positionDaysDifference * chartData.data.dayWidth + offsetWidth;
};
