/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Show everything": pick the timeline scale that puts the whole project on screen
 * at once. The three scales are fixed pixel-per-day steps, so this is a choice
 * between them rather than a free zoom — the finest one whose bars still fit.
 */
import type { IGanttBlock, TGanttViews } from "@plane/types";

/** Pixels per day at each scale, mirroring VIEWS_LIST in ../../gantt-chart/data. */
export const VIEW_DAY_WIDTH: Record<TGanttViews, number> = {
  week: 60,
  month: 20,
  quarter: 5,
};

/** Finest first: the answer is the first one that fits, so the plan is read at the
 *  most detail the screen allows rather than always zoomed out to quarters. */
const VIEWS_FINEST_FIRST: TGanttViews[] = ["week", "month", "quarter"];

/** A little air either side, so the first and last bars are not flush to the edge.
 *  In pixels rather than days on purpose: four days is 20px at the quarter scale and
 *  240px at the week scale, which was enough to push a fortnight-long project down a
 *  scale for padding it never needed. */
const PADDING_PX = 24;

export type TBlockSpan = { start: Date; end: Date; days: number };

const parse = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The window the blocks actually occupy. A block with only one of its two dates
 * still counts — it is on the chart, so leaving it out would scroll it off.
 * Returns null when nothing on the chart is dated at all.
 */
export const spanOfBlocks = (blocks: (IGanttBlock | undefined)[]): TBlockSpan | null => {
  let first: number | null = null;
  let last: number | null = null;

  for (const block of blocks) {
    if (!block) continue;
    for (const value of [block.start_date, block.target_date]) {
      const date = parse(value);
      if (!date) continue;
      const time = date.getTime();
      if (first === null || time < first) first = time;
      if (last === null || time > last) last = time;
    }
  }

  if (first === null || last === null) return null;
  const start = new Date(first);
  const end = new Date(last);
  return {
    start,
    end,
    // Inclusive of both ends: a one-day task spans one day, not zero.
    days: Math.round((last - first) / 86_400_000) + 1,
  };
};

/**
 * The scale to switch to so `days` fits in `availableWidth`.
 *
 * Falls through to the coarsest scale when even that is too small — a two-year
 * project cannot fit a laptop screen at 5px a day, and showing it at the coarsest
 * scale is still the closest thing to the answer.
 */
export const viewThatFits = (days: number, availableWidth: number): TGanttViews => {
  const needed = Math.max(1, days);
  const fits = VIEWS_FINEST_FIRST.find((view) => VIEW_DAY_WIDTH[view] * needed + PADDING_PX * 2 <= availableWidth);
  return fits ?? "quarter";
};

/** Where the scroll should land: the span's start, less the padding, never past 0. */
export const scrollLeftForSpan = (daysFromChartStart: number, dayWidth: number): number =>
  Math.max(0, daysFromChartStart * dayWidth - PADDING_PX);
