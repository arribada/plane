/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Expand, Maximize2, Minus, Plus, Settings2, Shrink } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// plane
import type { TGanttViews } from "@plane/types";
import { Row } from "@plane/ui";
// components
import { cn } from "@plane/utils";
import { VIEWS_LIST } from "@/components/gantt-chart/data";
import { isGroupRowId } from "@/plane-web/components/gantt-chart/grouping";
// helpers
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
//
import { GANTT_BREADCRUMBS_HEIGHT } from "../constants";

type Props = {
  blockIds: string[];
  fullScreenMode: boolean;
  handleChartView: (view: TGanttViews) => void;
  handleToday: () => void;
  /** Frame every dated block at once. Absent on charts that have no blocks to frame. */
  handleFitToBlocks?: () => void;
  loaderTitle: string;
  toggleFullScreenMode: () => void;
  showToday: boolean;
};

const toolButton =
  "flex items-center gap-1 rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover";

export const GanttChartHeader = observer(function GanttChartHeader(props: Props) {
  const { t } = useTranslation();
  const {
    blockIds,
    fullScreenMode,
    handleChartView,
    handleToday,
    handleFitToBlocks,
    loaderTitle,
    toggleFullScreenMode,
    showToday,
  } = props;
  // chart hook
  const { currentView, showWeekends, toggleShowWeekends, dimDependencies, toggleDimDependencies, zoom, setZoom } =
    useTimeLineChartStore();

  return (
    <Row
      className="relative flex w-full flex-shrink-0 flex-wrap items-center gap-2 bg-surface-1 py-2 whitespace-nowrap"
      // minHeight, not height: this row is flex-wrap, so below roughly 600px the
      // controls wrap onto a second line — and a fixed height meant that line
      // rendered OUTSIDE the box, painting over the chart. Growing is the correct
      // behaviour for a container whose children are allowed to wrap.
      style={{ minHeight: `${GANTT_BREADCRUMBS_HEIGHT}px` }}
    >
      <div className="ml-auto">
        <div className="ml-auto text-11 font-medium text-tertiary">
          {/* Group headers occupy a row but are not work items: counting them turned
              "37 work items" into 43 the moment grouping was switched on. */}
          {blockIds ? `${blockIds.filter((id) => !isGroupRowId(id)).length} ${loaderTitle}` : t("common.loading")}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Buttons, not clickable divs: this is how the chart's scale is steered, and
            it was unreachable without a mouse. aria-pressed says which one is on. */}
        {VIEWS_LIST.map((chartView: any) => (
          <button
            key={chartView?.key}
            type="button"
            aria-pressed={currentView === chartView?.key}
            className={cn(
              "cursor-pointer rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover",
              {
                "bg-layer-transparent-selected": currentView === chartView?.key,
              }
            )}
            onClick={() => handleChartView(chartView?.key)}
          >
            {t(chartView?.i18n_title)}
          </button>
        ))}
      </div>

      {showToday && (
        <button type="button" className={toolButton} onClick={handleToday}>
          {t("common.today")}
        </button>
      )}

      {/* Granularity between the three fixed scales. 60, 20 and 5 pixels a day are
          big steps — a fortnight and a quarter both land badly between two of them —
          so this stretches whichever scale is on. */}
      <div className="flex items-center rounded-md bg-layer-transparent">
        <button
          type="button"
          className="rounded-l-md p-1 px-1.5 hover:bg-layer-transparent-hover"
          onClick={() => setZoom(zoom / 1.25)}
          aria-label="Zoom out"
          title="Show more time in the same width"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          className="min-w-11 px-1 text-11 text-tertiary tabular-nums hover:text-primary"
          onClick={() => setZoom(1)}
          title="Back to this scale's own day width"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="rounded-r-md p-1 px-1.5 hover:bg-layer-transparent-hover"
          onClick={() => setZoom(zoom * 1.25)}
          aria-label="Zoom in"
          title="Spread the same time over more width"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {handleFitToBlocks && (
        <button
          type="button"
          className={toolButton}
          onClick={handleFitToBlocks}
          title="Frame the whole plan: pick the closest scale on which every dated item fits, and scroll to its first day"
        >
          <Maximize2 className="size-3.5" />
          Fit
        </button>
      )}

      {/* Display switches. A <details> rather than a popover library: it closes on
          Escape and on an outside click for free, and it is one element to style. */}
      <details className="group relative">
        <summary className={cn(toolButton, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
          <Settings2 className="size-3.5" />
          Display
        </summary>
        <div className="shadow-lg absolute right-0 z-30 mt-1 w-64 rounded-md border border-subtle bg-surface-1 p-1">
          <label className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-layer-transparent-hover">
            <input
              type="checkbox"
              checked={showWeekends}
              onChange={() => toggleShowWeekends()}
              className="mt-0.5 size-3.5 flex-shrink-0 text-accent-primary accent-current"
            />
            <span className="text-12 text-primary">
              Shade weekends
              <span className="block text-11 text-tertiary">
                A bar crossing a weekend is not two more days of work.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-layer-transparent-hover">
            <input
              type="checkbox"
              checked={dimDependencies}
              onChange={() => toggleDimDependencies()}
              className="mt-0.5 size-3.5 flex-shrink-0 text-accent-primary accent-current"
            />
            <span className="text-12 text-primary">
              Fade dependency arrows
              <span className="block text-11 text-tertiary">
                Keeps them out of the way until you point at an item, then lights up only the ones touching it.
              </span>
            </span>
          </label>
        </div>
      </details>

      <button
        type="button"
        className="flex items-center justify-center rounded-md border border-subtle bg-layer-transparent p-1 transition-all hover:bg-layer-transparent-hover"
        onClick={toggleFullScreenMode}
      >
        {fullScreenMode ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
      </button>
    </Row>
  );
});
