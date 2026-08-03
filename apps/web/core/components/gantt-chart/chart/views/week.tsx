/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane utils
import { cn } from "@plane/utils";
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import {
  dayNumberStep,
  showsDayNumber,
  showsWeekday,
  weekBandLabels,
} from "@/plane-web/components/gantt-chart/header-density";
//
import { GANTT_SIDEBAR_COLLAPSED_WIDTH, HEADER_HEIGHT } from "../../constants";
import type { IWeekBlock } from "../../views";

/** A week label needs about this much room before it stops being a smudge. */
const WEEK_LABEL_MIN_WIDTH = 34;

type TMonthRun = { key: string; blocks: IWeekBlock[] };

/**
 * Consecutive weeks that belong to the same month, so the month is named once.
 *
 * Each week used to carry its own copy of the month title, which is why a
 * six-week August printed "Aug 2026" six times across the top and the year read
 * as six different months. A week that straddles the turn belongs to the month
 * it STARTS in — the same rule the chart already uses for `startMonth`, so the
 * band lines up with the data rather than with a second opinion about it.
 */
const toMonthRuns = (blocks: IWeekBlock[]): TMonthRun[] => {
  const runs: TMonthRun[] = [];
  for (const block of blocks) {
    const key = `${block?.startYear}-${block?.startMonth}`;
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.blocks.push(block);
    else runs.push({ key, blocks: [block] });
  }
  return runs;
};

export const WeekChartView = observer(function WeekChartView(_props: any) {
  const { currentViewData, renderView, sidebarWidth, isSidebarCollapsed, showWeekends } = useTimeLineChartStore();
  const weekBlocks: IWeekBlock[] = renderView;
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  // How much label a cell of this width can carry. Cell widths and the day count
  // are untouched — this only decides what gets painted inside them.
  const dayWidth = currentViewData?.data.dayWidth;
  const dayStep = dayNumberStep(dayWidth);
  const anyWeekday = showsWeekday(dayWidth, false);
  const today = new Date();

  const runs = toMonthRuns(weekBlocks ?? []);
  const weekWidth = dayWidth === undefined ? undefined : dayWidth * 7;
  // The week number only earns its place once the month above it is no longer
  // fighting for the same pixels — which is exactly what grouping just freed.
  const showWeekNumbers = weekWidth !== undefined && weekWidth >= WEEK_LABEL_MIN_WIDTH;

  const dayCell = (weekDay: IWeekBlock["children"] extends (infer D)[] | undefined ? D : never) => {
    // The weekday letter is the first thing to go, and it can go per cell:
    // today's pill is ~8px hungrier than a bare number, and letting that one
    // column overflow while its neighbours look fine reads as a rendering glitch
    // rather than a choice. When it is only today that has given up its letter,
    // its number stays right-aligned with everyone else's rather than hopping to
    // the middle of the column.
    const withWeekday = showsWeekday(dayWidth, weekDay.today);
    return (
      <div
        key={`sub-title-${weekDay.date.toString()}`}
        className={cn(
          "flex flex-shrink-0 p-1 text-center capitalize outline-[0.25px] outline-subtle-1",
          withWeekday ? "justify-between" : anyWeekday ? "justify-end" : "justify-center",
          {
            // Once the letter is gone the shading is what still says "weekend",
            // so it belongs in the strip too and not only in the columns below.
            "bg-surface-2": showWeekends && ["sat", "sun"].includes(weekDay?.dayData?.shortTitle),
            "bg-accent-primary/20": weekDay.today,
          }
        )}
        style={{ width: `${dayWidth}px` }}
      >
        {withWeekday && (
          <div className="space-x-1 text-11 font-medium text-placeholder">{weekDay.dayData.abbreviation}</div>
        )}
        {/* Thinned, never clipped: an empty cell keeps the column rhythm and its
            gridline, it just carries no number. */}
        {showsDayNumber(weekDay.date, dayStep, today) && (
          <div className="space-x-1 text-11 font-medium text-secondary tabular-nums">
            <span className={cn({ "rounded-sm bg-accent-primary px-1 text-on-color": weekDay.today })}>
              {weekDay.date.getDate()}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`absolute top-0 left-0 flex h-max min-h-full w-max`}>
      {currentViewData &&
        runs.map((run) => {
          const first = run.blocks[0];
          const runWidth = dayWidth === undefined ? undefined : dayWidth * run.blocks.length * 7;
          // Measured against the RUN, not one week: a month-wide band has room
          // for "Aug 2026" where a week-wide one had to fall back to "Aug".
          const band = weekBandLabels(
            runWidth,
            first?.title,
            first?.startMonth,
            first?.startYear,
            undefined,
            undefined
          );
          return (
            <div key={`month-run-${run.key}`} className="relative flex flex-col outline-[0.25px] outline-subtle-1">
              {/** Header Div */}
              <div
                className="sticky top-0 z-[5] w-full flex-shrink-0 bg-surface-1 outline-[1px] outline-subtle-1"
                style={{ height: `${HEADER_HEIGHT}px` }}
              >
                {/** One month title for the whole run, with the week numbers behind it. */}
                <div className="relative h-7 w-full">
                  <div className="absolute inset-0 flex">
                    {run.blocks.map((block) => (
                      <div
                        key={`week-tick-${block?.startDate.toString()}`}
                        className="flex flex-shrink-0 items-center justify-center border-l-[0.5px] border-subtle first:border-l-0"
                        style={{ width: `${(block?.children?.length ?? 7) * (dayWidth ?? 0)}px` }}
                      >
                        {showWeekNumbers && (
                          <span className="text-10 text-placeholder tabular-nums">{block?.weekData?.shortTitle}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Pinned to the left edge and opaque, so it stays readable over
                      the week ticks while the run scrolls past underneath. */}
                  <div
                    className="sticky z-[1] m-1 inline-flex items-center bg-surface-1 px-3 py-1 text-13 font-medium whitespace-nowrap text-primary capitalize"
                    style={{ left: `${sidebarPaneWidth}px` }}
                  >
                    {band.title}
                  </div>
                </div>

                {/** Days Sub title */}
                <div className="flex h-5 w-full border-t-[0.5px] border-subtle">
                  {run.blocks.map((block) => block?.children?.map((weekDay) => dayCell(weekDay)))}
                </div>
              </div>

              {/** Day Columns */}
              <div className="flex h-full w-full flex-grow bg-surface-1">
                {run.blocks.map((block) =>
                  block?.children?.map((weekDay) => (
                    <div
                      key={`column-${weekDay.date.toString()}`}
                      className={cn("h-full overflow-hidden outline-[0.25px] outline-subtle", {
                        "bg-accent-primary/20": weekDay.today,
                      })}
                      style={{ width: `${dayWidth}px` }}
                    >
                      {showWeekends && ["sat", "sun"].includes(weekDay?.dayData?.shortTitle) && (
                        <div className="h-full bg-surface-2 outline-[0.25px] outline-strong" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
});
