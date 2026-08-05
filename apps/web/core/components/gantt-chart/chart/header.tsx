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
import { SavedOrderMenu } from "@/plane-web/components/gantt-chart/saved-order";
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
  /** Controls the chart's owner puts at the head of the toolbar — what is shown,
   *  and the state of the plan itself. Rendered as direct children of the toolbar
   *  row, so a fragment of several `<div>` groups wraps group by group rather than
   *  as one indivisible block. */
  toolbarLeading?: React.ReactNode;
  /** Owner-supplied actions, rendered inside the last group beside Saved order and
   *  Display, because that is where "get this out of here" belongs. */
  toolbarActions?: React.ReactNode;
};

/** Grows a control's tap area six pixels up and six pixels down without moving
 *  or resizing anything that is drawn.
 *
 *  Everything in this toolbar is between 16 and 24 pixels tall, because it is a
 *  dense row of secondary controls and it should look like one. A finger is not
 *  16 pixels wide. Padding would have been the obvious fix, but padding paints:
 *  each of these buttons has a hover background, and inflating them would turn
 *  the toolbar into a second header. An empty ::after belongs to its button, so
 *  a tap anywhere in it is a tap on the button, and it draws nothing.
 *
 *  Vertical only. Adjacent controls here sit half a gap apart, so widening the
 *  areas sideways would stack one button's target on top of its neighbour's —
 *  worse than a small target is a target that fires the button next to it. The
 *  row's gap-y is 12px for the same reason: two of these areas meeting between
 *  two wrapped lines must not overlap either. */
const touchArea = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";

const toolButton = `flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover ${touchArea}`;

/** A hairline between two groups of controls.
 *
 *  Exported because half of this row's groups are handed in through
 *  `toolbarLeading`, and a separator only reads as one if both sides of the row
 *  draw the same thing. Decorative: the grouping is visual, and a screen reader
 *  gets nothing from a pipe character. */
export function GanttToolbarDivider() {
  return <div className="h-4 w-px flex-shrink-0 bg-layer-3" aria-hidden />;
}

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
    toolbarLeading,
    toolbarActions,
  } = props;
  // chart hook
  const { currentView, showWeekends, toggleShowWeekends, dimDependencies, toggleDimDependencies, zoom, setZoom } =
    useTimeLineChartStore();

  return (
    <Row
      // Two children only, and they cannot collide: the count truncates, the
      // toolbar wraps. Everything that steers the chart lives in the second one —
      // including the controls the owner passes in, which used to be an absolutely
      // positioned overlay floating over this row. An overlay takes part in no
      // layout, so it did not push the count aside, it simply covered it, and no
      // amount of flex tuning in here could have separated them.
      className="relative flex w-full flex-shrink-0 items-center gap-x-3 bg-surface-1 py-2"
      // minHeight, not height: the toolbar wraps, and a fixed height meant the
      // second line rendered OUTSIDE the box, painting over the chart. Growing is
      // the correct behaviour for a container whose children are allowed to wrap.
      style={{ minHeight: `${GANTT_BREADCRUMBS_HEIGHT}px` }}
    >
      {/* A label, not a control: it sits apart from the buttons, and it is the one
          thing in the row allowed to give ground — min-w-0 so it may shrink past
          its text, truncate so it cuts itself short rather than pushing into
          anybody. */}
      <div className="min-w-0 shrink truncate text-11 font-medium text-tertiary">
        {/* Group headers occupy a row but are not work items: counting them turned
            "37 work items" into 43 the moment grouping was switched on. */}
        {blockIds ? `${blockIds.filter((id) => !isGroupRowId(id)).length} ${loaderTitle}` : t("common.loading")}
      </div>

      {/* The controls, in four groups separated by a hairline: what is shown, the
          plan (both handed in), the time scale, then output and options. Each group
          is flex-shrink-0 and whitespace-nowrap, so a narrow chart moves whole
          groups onto the next line instead of splitting one down the middle.

          No min-w-0 here, deliberately: without it a flex item's automatic minimum
          is its min-content — the widest single group — so when the row runs out of
          width the count above is squeezed and truncated first, and a group is
          never cut in half. */}
      <div className="flex flex-1 flex-wrap items-center justify-end gap-x-2 gap-y-3">
        {toolbarLeading}
        {toolbarLeading && <GanttToolbarDivider />}

        {/* Time scale: which unit, where in it, and how tightly it is packed.
            This group alone is about 420px of atomic controls, which is wider
            than a phone — so unlike its neighbours it is allowed to wrap inside
            itself, and it therefore cannot be flex-shrink-0. That costs nothing
            on a wide chart: flex only shrinks an item once it is alone on a line
            and still does not fit, so on a desktop this group behaves exactly as
            it did, and on a phone it breaks between its own sub-groups instead
            of pushing the page sideways. */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-3 whitespace-nowrap">
          {/* Buttons, not clickable divs: this is how the chart's scale is steered, and
              it was unreachable without a mouse. aria-pressed says which one is on.
              Boxed together because they are one choice of three, not three switches. */}
          <div className="flex items-center gap-0.5 rounded-md bg-layer-3 p-0.5">
            {VIEWS_LIST.map((chartView: any) => (
              <button
                key={chartView?.key}
                type="button"
                aria-pressed={currentView === chartView?.key}
                className={cn(
                  "cursor-pointer rounded-sm px-2 py-0.5 text-11 hover:bg-layer-transparent-hover",
                  touchArea,
                  {
                    "bg-layer-transparent-active hover:bg-layer-transparent-active": currentView === chartView?.key,
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
          <div className="flex flex-shrink-0 items-center rounded-md bg-layer-3">
            <button
              type="button"
              className={cn("rounded-l-md p-1 px-1.5 hover:bg-layer-transparent-hover", touchArea)}
              onClick={() => setZoom(zoom / 1.25)}
              aria-label="Zoom out"
              title="Show more time in the same width"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              className={cn("min-w-11 px-1 text-11 text-tertiary tabular-nums hover:text-primary", touchArea)}
              onClick={() => setZoom(1)}
              title="Back to this scale's own day width"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={cn("rounded-r-md p-1 px-1.5 hover:bg-layer-transparent-hover", touchArea)}
              onClick={() => setZoom(zoom * 1.25)}
              aria-label="Zoom in"
              title="Spread the same time over more width"
            >
              <Plus className="size-3.5" />
            </button>
          </div>

          {/* Beside the zoom rather than in the Display menu: it is the same question
              — how much time is on screen — answered in one press.
              "Fit" alone said nothing about what it fits, and the sentence that
              did was in a title attribute, which a touch screen never shows. The
              label now names the thing; the full sentence is the accessible name
              and the desktop tooltip. */}
          {handleFitToBlocks && (
            <button
              type="button"
              className={toolButton}
              onClick={handleFitToBlocks}
              // Begins with the words on the button, so voice control still
              // reaches it by what it says.
              aria-label="Fit whole plan: pick the closest scale on which every dated item fits, and scroll to its first day"
              title="Frame the whole plan: pick the closest scale on which every dated item fits, and scroll to its first day"
            >
              <Maximize2 className="size-3.5" />
              Fit whole plan
            </button>
          )}
        </div>

        <GanttToolbarDivider />

        {/* Output and options: what leaves this chart, and how it is drawn. */}
        <div className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
          <SavedOrderMenu visibleIssueIds={(blockIds ?? []).filter((id) => !isGroupRowId(id))} />

          {toolbarActions}

          {/* Display switches. A <details> rather than a popover library: it closes on
              Escape and on an outside click for free, and it is one element to style. */}
          <details className="group relative flex-shrink-0">
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
            className={cn(
              "flex items-center justify-center rounded-md border border-subtle bg-layer-transparent p-1 transition-all hover:bg-layer-transparent-hover",
              touchArea
            )}
            onClick={toggleFullScreenMode}
            aria-label={fullScreenMode ? "Leave full screen" : "Fill the window with this timeline"}
            title={fullScreenMode ? "Leave full screen" : "Fill the window with this timeline"}
          >
            {fullScreenMode ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </Row>
  );
});
