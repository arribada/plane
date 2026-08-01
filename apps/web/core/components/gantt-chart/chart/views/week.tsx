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

export const WeekChartView = observer(function WeekChartView(_props: any) {
  const { currentViewData, renderView, sidebarWidth, isSidebarCollapsed, showWeekends } = useTimeLineChartStore();
  const weekBlocks: IWeekBlock[] = renderView;
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  // How much label a cell of this width can carry. Cell widths and the day count
  // are untouched — this only decides what gets painted inside them.
  const dayWidth = currentViewData?.data.dayWidth;
  const bandWidth = dayWidth === undefined ? undefined : dayWidth * 7;
  const dayStep = dayNumberStep(dayWidth);
  const anyWeekday = showsWeekday(dayWidth, false);
  const today = new Date();

  return (
    <div className={`absolute top-0 left-0 flex h-max min-h-full w-max`}>
      {currentViewData &&
        weekBlocks?.map((block) => {
          const band = weekBandLabels(
            bandWidth,
            block?.title,
            block?.startMonth,
            block?.startYear,
            block?.weekData?.title,
            block?.weekData?.shortTitle
          );
          return (
            <div
              key={`month-${block?.startDate.toString()}-${block?.endDate.toString()}`}
              className="relative flex flex-col outline-[0.25px] outline-subtle-1"
            >
              {/** Header Div */}
              <div
                className="sticky top-0 z-[5] w-full flex-shrink-0 bg-surface-1 outline-[1px] outline-subtle-1"
                style={{
                  height: `${HEADER_HEIGHT}px`,
                }}
              >
                {/** Main Months Title */}
                <div className="inline-flex h-7 w-full justify-between">
                  <div
                    className="sticky z-[1] m-1 flex items-center bg-surface-1 px-3 py-1 text-13 font-medium whitespace-nowrap text-primary capitalize"
                    style={{
                      left: `${sidebarPaneWidth}px`,
                    }}
                  >
                    {band.title}
                  </div>
                  {band.side && (
                    <div className="sticky px-3 py-2 text-11 whitespace-nowrap text-placeholder capitalize">
                      {band.side}
                    </div>
                  )}
                </div>
                {/** Days Sub title */}
                <div className="flex h-5 w-full border-t-[0.5px] border-subtle">
                  {block?.children?.map((weekDay) => {
                    // The weekday letter is the first thing to go, and it can go
                    // per cell: today's pill is ~8px hungrier than a bare number,
                    // and letting that one column overflow while its neighbours
                    // look fine reads as a rendering glitch rather than a choice.
                    // When it is only today that has given up its letter, its
                    // number stays right-aligned with everyone else's rather than
                    // hopping to the middle of the column.
                    const withWeekday = showsWeekday(dayWidth, weekDay.today);
                    return (
                      <div
                        key={`sub-title-${weekDay.date.toString()}`}
                        className={cn(
                          "flex flex-shrink-0 p-1 text-center capitalize outline-[0.25px] outline-subtle-1",
                          withWeekday ? "justify-between" : anyWeekday ? "justify-end" : "justify-center",
                          {
                            // Once the letter is gone the shading is what still
                            // says "weekend", so it belongs in the strip too and
                            // not only in the columns below.
                            "bg-surface-2": showWeekends && ["sat", "sun"].includes(weekDay?.dayData?.shortTitle),
                            "bg-accent-primary/20": weekDay.today,
                          }
                        )}
                        style={{ width: `${currentViewData?.data.dayWidth}px` }}
                      >
                        {withWeekday && (
                          <div className="space-x-1 text-11 font-medium text-placeholder">
                            {weekDay.dayData.abbreviation}
                          </div>
                        )}
                        {/* Thinned, never clipped: an empty cell keeps the column
                            rhythm and its gridline, it just carries no number. */}
                        {showsDayNumber(weekDay.date, dayStep, today) && (
                          <div className="space-x-1 text-11 font-medium text-secondary tabular-nums">
                            <span
                              className={cn({
                                "rounded-sm bg-accent-primary px-1 text-on-color": weekDay.today,
                              })}
                            >
                              {weekDay.date.getDate()}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/** Day Columns */}
              <div className="flex h-full w-full flex-grow bg-surface-1">
                {block?.children?.map((weekDay) => (
                  <div
                    key={`column-${weekDay.date.toString()}`}
                    className={cn("h-full overflow-hidden outline-[0.25px] outline-subtle", {
                      "bg-accent-primary/20": weekDay.today,
                    })}
                    style={{ width: `${currentViewData?.data.dayWidth}px` }}
                  >
                    {showWeekends && ["sat", "sun"].includes(weekDay?.dayData?.shortTitle) && (
                      <div className="h-full bg-surface-2 outline-[0.25px] outline-strong" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
});
