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

/** Mirrors the store's clamp. Kept here so the pure helper can be reasoned about
 *  — and tested — without importing a MobX store. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

/**
 * The scale to switch to so `days` fits in `availableWidth`.
 *
 * Not "the finest one that fits as-is" — that was the right answer before the zoom
 * existed, and it stopped being right the moment a scale could be stretched. Taking
 * the first that fits sent a 60-day project to the quarter scale at 300% (15px a
 * day) when the month scale at 96% gives it 19px a day and a header built for that
 * density.
 *
 * So: among the scales that can actually reach the width, the one needing the least
 * distortion. Measured on the log of the factor, because halving and doubling are
 * equally far from leaving it alone.
 */
export const viewThatFits = (days: number, availableWidth: number): TGanttViews => {
  const usable = Math.max(1, availableWidth - PADDING_PX * 2);
  const span = Math.max(1, days);

  let best: TGanttViews | null = null;
  let bestDistance = Infinity;
  for (const view of VIEWS_FINEST_FIRST) {
    const raw = usable / span / VIEW_DAY_WIDTH[view];
    // Below the floor this scale cannot be squeezed far enough to fit at all.
    if (raw < ZOOM_MIN) continue;
    const distance = Math.abs(Math.log(Math.min(raw, ZOOM_MAX)));
    // Strictly less, walked finest-first, so a tie keeps the finer scale.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = view;
    }
  }
  // Nothing can hold it — a decade at 5px a day is 18,000px. The coarsest scale is
  // still the closest thing to an answer, and it will scroll.
  return best ?? "quarter";
};

/** Where the scroll should land: the span's start, less the padding, never past 0. */
export const scrollLeftForSpan = (daysFromChartStart: number, dayWidth: number): number =>
  Math.max(0, daysFromChartStart * dayWidth - PADDING_PX);

/**
 * The zoom that makes `days` exactly fill `availableWidth` at the given scale.
 *
 * The three scales are coarse steps — 60, 20 and 5 pixels a day — so picking the
 * nearest one left a 20-day project drawn across a third of the screen. With a
 * multiplier on top, "fit" can mean fit. Clamped: a project of a single day would
 * otherwise ask for a 20x zoom and a header cell wider than the window.
 */
export const zoomToFill = (days: number, availableWidth: number, view: TGanttViews): number => {
  const usable = Math.max(1, availableWidth - PADDING_PX * 2);
  const wanted = usable / Math.max(1, days) / VIEW_DAY_WIDTH[view];
  return Math.min(Math.max(Number.isFinite(wanted) ? wanted : 1, ZOOM_MIN), ZOOM_MAX);
};
