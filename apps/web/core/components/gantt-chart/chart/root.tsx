/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
// plane imports
// components
import type { ChartDataType, IBlockUpdateData, IBlockUpdateDependencyData, TGanttViews } from "@plane/types";
import { cn } from "@plane/utils";
import { GanttChartHeader, GanttChartMainContent } from "@/components/gantt-chart";
// helpers
// hooks
import { useUserProfile } from "@/hooks/store/user";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
//
import {
  scrollLeftForSpan,
  spanOfBlocks,
  VIEW_DAY_WIDTH,
  viewThatFits,
  zoomToFill,
} from "@/plane-web/components/gantt-chart/fit-to-blocks";
import { GANTT_SIDEBAR_COLLAPSED_WIDTH } from "../constants";
import { currentViewDataWithView } from "../data";
import type { IMonthBlock, IMonthView, IWeekBlock } from "../views";
import { getNumberOfDaysBetweenTwoDates, monthView, quarterView, weekView } from "../views";

type ChartViewRootProps = {
  border: boolean;
  title: string;
  loaderTitle: string;
  blockIds: string[];
  blockUpdateHandler: (block: any, payload: IBlockUpdateData) => void;
  blockToRender: (data: any) => React.ReactNode;
  sidebarToRender: (props: any) => React.ReactNode;
  enableBlockLeftResize: boolean | ((blockId: string) => boolean);
  enableBlockRightResize: boolean | ((blockId: string) => boolean);
  enableBlockMove: boolean | ((blockId: string) => boolean);
  enableReorder: boolean | ((blockId: string) => boolean);
  enableAddBlock: boolean | ((blockId: string) => boolean);
  enableSelection: boolean | ((blockId: string) => boolean);
  enableDependency: boolean | ((blockId: string) => boolean);
  bottomSpacing: boolean;
  showAllBlocks: boolean;
  loadMoreBlocks?: () => void;
  updateBlockDates?: (updates: IBlockUpdateDependencyData[]) => Promise<void>;
  canLoadMoreBlocks?: boolean;
  quickAdd?: React.ReactNode | undefined;
  showToday: boolean;
  isEpic?: boolean;
};

const timelineViewHelpers = {
  week: weekView,
  month: monthView,
  quarter: quarterView,
};

// kept at module scope: it only reads the DOM and captures nothing from the component
const updateCurrentLeftScrollPosition = (width: number) => {
  const scrollContainer = document.querySelector("#gantt-container") as HTMLDivElement;
  if (!scrollContainer) return;

  scrollContainer.scrollLeft = width + scrollContainer?.scrollLeft;
};

export const ChartViewRoot = observer(function ChartViewRoot(props: ChartViewRootProps) {
  const {
    border,
    title,
    blockIds,
    loadMoreBlocks,
    loaderTitle,
    blockUpdateHandler,
    sidebarToRender,
    blockToRender,
    canLoadMoreBlocks,
    enableBlockLeftResize,
    enableBlockRightResize,
    enableBlockMove,
    enableReorder,
    enableAddBlock,
    enableSelection,
    enableDependency,
    bottomSpacing,
    showAllBlocks,
    quickAdd,
    showToday,
    updateBlockDates,
    isEpic = false,
  } = props;
  // states
  const [itemsContainerWidth, setItemsContainerWidth] = useState(0);
  const [fullScreenMode, setFullScreenMode] = useState(false);
  // hooks
  const {
    currentView,
    currentViewData,
    renderView,
    updateCurrentView,
    updateCurrentViewData,
    updateRenderView,
    updateAllBlocksOnChartChangeWhileDragging,
    sidebarWidth,
    isSidebarCollapsed,
    getBlockById,
    zoom,
    setZoom,
    getDateFromPositionOnGantt,
  } = useTimeLineChartStore();
  const { data } = useUserProfile();
  const startOfWeek = data?.start_of_the_week;
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  const updateCurrentViewRenderPayload = (
    side: null | "left" | "right",
    view: TGanttViews,
    targetDate?: Date,
    zoomOverride?: number
  ) => {
    const selectedCurrentView: TGanttViews = view;
    const base: ChartDataType | undefined =
      selectedCurrentView && selectedCurrentView === currentViewData?.key
        ? currentViewData
        : currentViewDataWithView(view);

    if (base === undefined) return;

    // Always derived from the scale's own pixels-per-day rather than from whatever
    // is on screen, so applying the zoom twice cannot compound. The generators only
    // read dayWidth to multiply a width, and they copy rather than mutate, so a
    // scaled clone is all a continuous zoom needs.
    const factor = zoomOverride ?? zoom;
    const selectedCurrentViewData: ChartDataType = {
      ...base,
      data: { ...base.data, dayWidth: Math.max(1, Math.round(VIEW_DAY_WIDTH[view] * factor * 100) / 100) },
    };

    const currentViewHelpers = timelineViewHelpers[selectedCurrentView];
    const currentRender = currentViewHelpers.generateChart(selectedCurrentViewData, side, targetDate, startOfWeek);
    const mergeRenderPayloads = currentViewHelpers.mergeRenderPayloads as (
      a: IWeekBlock[] | IMonthView | IMonthBlock[],
      b: IWeekBlock[] | IMonthView | IMonthBlock[]
    ) => IWeekBlock[] | IMonthView | IMonthBlock[];

    // updating the prevData, currentData and nextData
    if (currentRender.payload) {
      updateCurrentViewData(currentRender.state);

      if (side === "left") {
        updateCurrentView(selectedCurrentView);
        updateRenderView(mergeRenderPayloads(currentRender.payload, renderView));
        updateItemsContainerWidth(currentRender.scrollWidth);
        if (!targetDate) updateCurrentLeftScrollPosition(currentRender.scrollWidth);
        updateAllBlocksOnChartChangeWhileDragging(currentRender.scrollWidth);
        setItemsContainerWidth(itemsContainerWidth + currentRender.scrollWidth);
      } else if (side === "right") {
        updateCurrentView(view);
        updateRenderView(mergeRenderPayloads(renderView, currentRender.payload));
        setItemsContainerWidth(itemsContainerWidth + currentRender.scrollWidth);
      } else {
        updateCurrentView(view);
        updateRenderView(currentRender.payload);
        setItemsContainerWidth(currentRender.scrollWidth);
        setTimeout(() => {
          handleScrollToCurrentSelectedDate(currentRender.state, currentRender.state.data.currentDate);
        }, 50);
      }
    }

    return currentRender.state;
  };

  const handleToday = () => updateCurrentViewRenderPayload(null, currentView);

  /**
   * Frame the whole plan: switch to the finest scale on which every dated block
   * fits, re-centre the chart on the work rather than on today, and scroll to its
   * first day. Without this, a project starting three months out opens on an empty
   * stretch of calendar with the bars somewhere off to the right.
   */
  const handleFitToBlocks = () => {
    const span = spanOfBlocks((blockIds ?? []).map((id) => getBlockById(id)));
    if (!span) return;

    const scrollContainer = document.querySelector("#gantt-container") as HTMLDivElement | null;
    const available = Math.max(240, (scrollContainer?.clientWidth ?? 0) - sidebarPaneWidth);
    const view = viewThatFits(span.days, available);
    // With a continuous zoom, "fit" can mean fit — fill the width rather than
    // settle for whichever of the three fixed steps happened to be closest.
    const factor = zoomToFill(span.days, available, view);
    // Fit generates and scrolls itself below; tell the zoom effect to stand down.
    // Only when the value actually changes: React bails out of a no-op state
    // update, so the effect never runs to clear the flag, and it would then eat
    // the next real zoom press — press Fit twice, then "+", and nothing moved.
    if (factor !== zoom) {
      zoomHandledElsewhere.current = true;
      setZoom(factor);
    }

    // Rebuild the chart around the span's midpoint so the generated window
    // contains it — generating around today would put a distant project outside
    // the rendered range, and no amount of scrolling would reach it.
    const middle = new Date((span.start.getTime() + span.end.getTime()) / 2);
    const state = updateCurrentViewRenderPayload(null, view, middle, factor);
    if (!state) return;

    // After the payload lands: put the span's first day at the left edge. The
    // generator schedules its own centring scroll on a 50ms timeout, so this has
    // to run after it or it would be overwritten.
    setTimeout(() => {
      const container = document.querySelector("#gantt-container") as HTMLDivElement | null;
      if (!container) return;
      const offset = getNumberOfDaysBetweenTwoDates(state.data.startDate, span.start);
      container.scrollLeft = scrollLeftForSpan(offset, VIEW_DAY_WIDTH[view] * factor);
    }, 80);
  };

  // handling the scroll positioning from left and right
  useEffect(() => {
    handleToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The date sitting in the middle of the viewport right now. */
  const dateAtViewportCentre = (): Date | undefined => {
    const container = document.querySelector("#gantt-container") as HTMLDivElement | null;
    if (!container || !currentViewData) return undefined;
    const centre = container.scrollLeft + (container.clientWidth - sidebarPaneWidth) / 2;
    return getDateFromPositionOnGantt(Math.max(0, centre), 0);
  };

  // A zoom change re-renders the chart at a new pixels-per-day. Two things it must
  // not do: jump back to today (it did, because a null-side rebuild scrolls to
  // `currentDate`), and fight "Fit", which sets the zoom itself and then places its
  // own scroll — the effect ran afterwards and undid it, which is why Fit could
  // never reach a project more than a few months out.
  const firstZoom = useRef(true);
  const zoomHandledElsewhere = useRef(false);
  useEffect(() => {
    if (firstZoom.current) {
      firstZoom.current = false;
      return;
    }
    if (zoomHandledElsewhere.current) {
      zoomHandledElsewhere.current = false;
      return;
    }
    // Re-centre on what the viewer was looking at, not on today.
    updateCurrentViewRenderPayload(null, currentView, dateAtViewportCentre());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const updateItemsContainerWidth = (width: number) => {
    const scrollContainer = document.querySelector("#gantt-container") as HTMLDivElement;
    if (!scrollContainer) return;
    setItemsContainerWidth(width + scrollContainer?.scrollLeft);
  };

  const handleScrollToCurrentSelectedDate = (currentState: ChartDataType, date: Date) => {
    const scrollContainer = document.querySelector("#gantt-container") as HTMLDivElement;
    if (!scrollContainer) return;

    const clientVisibleWidth: number = scrollContainer?.clientWidth;
    let scrollWidth: number = 0;
    let daysDifference: number = 0;
    daysDifference = getNumberOfDaysBetweenTwoDates(currentState.data.startDate, date);

    scrollWidth =
      Math.abs(daysDifference) * currentState.data.dayWidth -
      (clientVisibleWidth / 2 - currentState.data.dayWidth) +
      sidebarPaneWidth / 2;

    scrollContainer.scrollLeft = scrollWidth;
  };

  const portalContainer = document.getElementById("full-screen-portal") as HTMLElement;

  const content = (
    <div
      className={cn("shadow relative flex h-full flex-col rounded-xs bg-surface-1 select-none", {
        "inset-0 z-[25] bg-surface-1": fullScreenMode,
        "border-[0.5px] border-subtle": border,
      })}
    >
      <GanttChartHeader
        blockIds={blockIds}
        fullScreenMode={fullScreenMode}
        toggleFullScreenMode={() => setFullScreenMode((prevData) => !prevData)}
        handleChartView={(key) => updateCurrentViewRenderPayload(null, key)}
        handleToday={handleToday}
        handleFitToBlocks={handleFitToBlocks}
        loaderTitle={loaderTitle}
        showToday={showToday}
      />
      <GanttChartMainContent
        blockIds={blockIds}
        loadMoreBlocks={loadMoreBlocks}
        canLoadMoreBlocks={canLoadMoreBlocks}
        blockToRender={blockToRender}
        blockUpdateHandler={blockUpdateHandler}
        bottomSpacing={bottomSpacing}
        enableBlockLeftResize={enableBlockLeftResize}
        enableBlockMove={enableBlockMove}
        enableBlockRightResize={enableBlockRightResize}
        enableReorder={enableReorder}
        enableSelection={enableSelection}
        enableAddBlock={enableAddBlock}
        enableDependency={enableDependency}
        itemsContainerWidth={itemsContainerWidth}
        showAllBlocks={showAllBlocks}
        sidebarToRender={sidebarToRender}
        title={title}
        updateCurrentViewRenderPayload={updateCurrentViewRenderPayload}
        quickAdd={quickAdd}
        updateBlockDates={updateBlockDates}
        isEpic={isEpic}
      />
    </div>
  );

  return fullScreenMode && portalContainer ? createPortal(content, portalContainer) : content;
});
