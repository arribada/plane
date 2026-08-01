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
import { monthRowLabel, quarterBandLabels } from "@/plane-web/components/gantt-chart/header-density";
//
import { GANTT_SIDEBAR_COLLAPSED_WIDTH, HEADER_HEIGHT } from "../../constants";
import type { IMonthBlock, IQuarterMonthBlock } from "../../views";
import { groupMonthsToQuarters } from "../../views";

export const QuarterChartView = observer(function QuarterChartView(_props: any) {
  const { currentViewData, renderView, sidebarWidth, isSidebarCollapsed } = useTimeLineChartStore();
  const monthBlocks: IMonthBlock[] = renderView;

  const quarterBlocks: IQuarterMonthBlock[] = groupMonthsToQuarters(monthBlocks);
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  // Only what is painted changes with the zoom; every width below is as it was.
  const dayWidth = currentViewData?.data.dayWidth;

  return (
    <div className={`absolute top-0 left-0 flex h-max min-h-full w-max`}>
      {currentViewData &&
        quarterBlocks?.map((quarterBlock) => {
          const quarterDays = quarterBlock.children.reduce((days, monthBlock) => days + monthBlock.days, 0);
          const band = quarterBandLabels(
            dayWidth === undefined ? undefined : quarterDays * dayWidth,
            quarterBlock?.title,
            quarterBlock?.shortTitle,
            quarterBlock.today
          );
          return (
            <div
              key={`month-${quarterBlock.quarterNumber}-${quarterBlock.year}`}
              className="relative flex flex-col outline-[0.25px] outline-subtle-1"
            >
              {/** Header Div */}
              <div
                className="sticky top-0 z-[5] w-full flex-shrink-0 bg-surface-1 outline-[1px] outline-subtle-1"
                style={{
                  height: `${HEADER_HEIGHT}px`,
                }}
              >
                {/** Main Quarter Title */}
                <div className="inline-flex h-7 w-full justify-between">
                  <div
                    className="sticky z-[1] my-1 flex items-center bg-surface-1 px-3 py-1 text-14 font-medium whitespace-nowrap text-primary capitalize"
                    style={{
                      left: `${sidebarPaneWidth}px`,
                    }}
                  >
                    {band.title}
                    {band.current && (
                      <span className={cn("ml-2 rounded-sm bg-accent-primary px-1 text-9 font-medium text-on-color")}>
                        Current
                      </span>
                    )}
                  </div>
                  {band.side && (
                    <div className="sticky px-3 py-2 text-11 whitespace-nowrap text-placeholder capitalize">
                      {band.side}
                    </div>
                  )}
                </div>
                {/** Months Sub title */}
                <div className="flex h-5 w-full border-t-[0.5px] border-subtle">
                  {quarterBlock?.children?.map((monthBlock) => {
                    // A 28-day February at the zoom floor is 35px wide and a
                    // px-2 "Feb" pill is 40px, so the pill tightens rather than
                    // bleeding into January and March.
                    const label = monthRowLabel(dayWidth === undefined ? undefined : monthBlock.days * dayWidth);
                    return (
                      <div
                        key={`sub-title-${monthBlock.month}-${monthBlock.year}`}
                        className={cn(
                          "flex flex-shrink-0 justify-center text-center capitalize outline-[0.25px] outline-subtle-1",
                          {
                            "bg-accent-primary/20": monthBlock.today,
                          }
                        )}
                        style={{ width: `${currentViewData?.data.dayWidth * monthBlock.days}px` }}
                      >
                        {label !== "none" && (
                          <div className="flex h-full items-center justify-center space-x-1 text-11 font-medium text-secondary">
                            <span
                              className={cn({
                                "rounded-lg bg-accent-primary text-on-color": monthBlock.today,
                                "px-2": monthBlock.today && label === "full",
                                "px-1": monthBlock.today && label === "tight",
                              })}
                            >
                              {monthBlock.monthData.shortTitle}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/** Month Columns */}
              <div className="flex h-full w-full flex-grow">
                {quarterBlock?.children?.map((monthBlock) => (
                  <div
                    key={`column-${monthBlock.month}-${monthBlock.year}`}
                    className={cn("h-full overflow-hidden outline-[0.25px] outline-subtle", {
                      "bg-accent-primary/20": monthBlock.today,
                    })}
                    style={{ width: `${currentViewData?.data.dayWidth * monthBlock.days}px` }}
                  />
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
});
