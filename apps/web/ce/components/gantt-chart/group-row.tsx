/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The header row for a gantt group. Rendered in both panes at exactly BLOCK_HEIGHT:
 * the sidebar and the chart map over the same id list, and the dependency arrows
 * compute their y from a row's index in it, so a header of any other height would
 * slide every arrow below it off its bar.
 */
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { getPositionFromDate } from "@/components/gantt-chart/views/helpers";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { GANTT_ROW_DRAG_INSTANCE } from "./band-drop";
import { useGanttGroups } from "./group-context";

type Props = {
  label: string;
  color?: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** What the band is worth, so folding it away costs nothing. */
  start: Date | null;
  end: Date | null;
  days: number;
  done: number;
  /** The band's own key, so a drop can say which band it landed on. */
  groupKey?: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
/** Inclusive of both ends, matching the sidebar: a sprint that starts and ends on
 *  the same day lasts one day, not zero. */
const daysBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
/** Below this the label would overrun both uprights and read as another row's. */
const LABEL_MIN_WIDTH = 150;

/** What the tooltip says on anything a work item can be dropped onto. One string
 *  because the two panes are two halves of the same row and must not describe
 *  the same gesture differently. */
const DROP_HINT = "Drop a work item here to move it into this band";

/**
 * Register a band row — either pane's — as somewhere a work item can be dropped.
 *
 * A HOOK RATHER THAN TWO COPIES, because the reported bug was that only one of
 * the two halves of a band row accepted a drop. The sidebar header did; the
 * chart-pane brace, which is the wider target and the one somebody dragging
 * across the timeline is actually looking at, was `aria-hidden` decoration with
 * no drop target on it at all. Two implementations is how they drifted apart in
 * the first place, so there is one.
 *
 * The whole payload goes to `assign`, not an id picked out here: a band cannot
 * tell a work item id from a synthetic row id, and `band-drop.ts` can. `assign`
 * is contracted not to reject — the `catch` is a backstop for a contract broken
 * later, not the normal path, because "the drop did nothing and said nothing" is
 * the exact defect this whole change is about.
 */
const useBandDropTarget = <T extends HTMLElement>(groupKey: string | undefined) => {
  const { assign } = useGanttGroups();
  const ref = useRef<T | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !assign || !groupKey) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => source?.data?.dragInstanceId === GANTT_ROW_DRAG_INSTANCE,
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false);
        void assign(source?.data ?? {}, groupKey).catch(() =>
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "The move did not stick",
            message: "Something went wrong filing that work item into the band.",
          })
        );
      },
    });
  }, [assign, groupKey]);

  return { ref, over, droppable: !!assign && !!groupKey };
};

export const GanttGroupHeader = observer(function GanttGroupHeader(props: Props) {
  const { label, color, count, collapsed, onToggle, start, end, days, done, groupKey } = props;
  const complete = count > 0 ? Math.round((done / count) * 100) : 0;
  // Dropping a work item on the header moves it into the band. Registered on the
  // same payload the sidebar's reorder drag emits, so an item is dragged the one
  // way people already drag them — and only where the context offers an `assign`,
  // which is sprint and module. See base-gantt-root for why not the others.
  const { ref, over, droppable } = useBandDropTarget<HTMLButtonElement>(groupKey);

  return (
    <button
      type="button"
      ref={ref}
      onClick={onToggle}
      aria-expanded={!collapsed}
      style={{ height: `${BLOCK_HEIGHT}px` }}
      className={cn(
        "flex w-full items-center gap-2 border-y-[0.5px] border-subtle bg-layer-2 px-3 text-left",
        over && "outline outline-2 -outline-offset-2 outline-accent-strong"
      )}
      title={droppable ? DROP_HINT : undefined}
    >
      {collapsed ? (
        <ChevronRight className="size-3.5 flex-shrink-0 text-tertiary" />
      ) : (
        <ChevronDown className="size-3.5 flex-shrink-0 text-tertiary" />
      )}
      {color && <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      <span className={cn("truncate text-12 font-semibold text-primary")}>{label}</span>
      <span className="flex-shrink-0 rounded-full bg-layer-1 px-1.5 text-11 text-secondary">{count}</span>

      <span className="flex-grow" />

      {/* The band's own numbers. A collapsed group would otherwise be a name and a
          count, which is not enough to decide whether to open it again. */}
      {start && end && (
        <span className="flex-shrink-0 text-11 whitespace-nowrap text-tertiary" title="When this band runs">
          {short(start)} – {short(end)}
          <span className="ml-1 tabular-nums">({days} d)</span>
        </span>
      )}
      <span
        className="flex w-16 flex-shrink-0 items-center gap-1"
        title={`${done} of ${count} finished`}
        aria-label={`${complete}% finished`}
      >
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-layer-1">
          <span className="block h-full rounded-full bg-success-primary" style={{ width: `${complete}%` }} />
        </span>
        <span className="text-11 text-tertiary tabular-nums">{complete}%</span>
      </span>
    </button>
  );
});

/**
 * The chart-pane counterpart: the group's span drawn as a brace.
 *
 * It used to be an empty full-width band, which said only "a group starts here"
 * — so the one question a reader actually has, *when* does this sprint run,
 * could only be answered by tracing its members' bars by eye. Worse, a task tied
 * to the end of a sprint was drawn with a dependency arrow, which reads as "this
 * task waits for that task" when it means "this waits for the sprint to close".
 *
 * A brace says it directly: two uprights at the sprint's first start and last
 * end, a hairline between them. It is not a bar — a bar would compete with the
 * work items for the same visual weight and invite someone to try dragging it.
 */
export const GanttGroupBand = observer(function GanttGroupBand({ groupKey }: { groupKey: string }) {
  const { byKey } = useGanttGroups();
  const store = useTimeLineChartStore();
  const group = byKey.get(groupKey);
  const chart = store.currentViewData;
  /**
   * The same drop target as the sidebar header, on the same hook.
   *
   * This half is the one the report was actually about: "en la déposant sur la
   * case sprint". Somebody dragging a row across the timeline is looking at the
   * CHART, and this row spans its full width — the sidebar header is a 300px
   * sliver at the far left. It had no drop target at all, so the obvious target
   * was the one that did nothing, and the gesture read as unimplemented.
   *
   * One hook rather than a second registration, because two implementations of
   * the same drop are how the two panes drifted apart to begin with.
   */
  const { ref, over, droppable } = useBandDropTarget<HTMLDivElement>(groupKey);

  let span: { left: number; width: number } | null = null;
  // Only worth printing once the brace is wide enough to hold it; on a narrow one
  // the text would run past both uprights and read as belonging to the next row.
  const label =
    group?.start && group?.end
      ? `${short(group.start)} – ${short(group.end)} · ${daysBetween(group.start, group.end)} d`
      : null;
  if (group?.start && group?.end && chart) {
    const left = getPositionFromDate(chart, group.start, 0);
    const right = getPositionFromDate(chart, group.end, 0) + chart.data.dayWidth;
    // A one-day sprint would otherwise be two uprights on top of each other.
    if (Number.isFinite(left) && Number.isFinite(right)) {
      span = { left, width: Math.max(right - left, 2) };
    }
  }

  return (
    <div
      ref={ref}
      style={{ height: `${BLOCK_HEIGHT}px` }}
      className={cn(
        "relative w-full border-y-[0.5px] border-subtle bg-layer-2/40",
        // The affordance has to be on the half being aimed at. Same treatment as
        // the sidebar header so one gesture does not look like two features.
        over && "outline outline-2 -outline-offset-2 outline-accent-strong"
      )}
      title={droppable ? DROP_HINT : undefined}
      // Still hidden from assistive tech: this row is a visual restatement of the
      // sidebar header, which carries the accessible name, the expand/collapse
      // control and the same drop. Announcing it twice would be worse than not
      // announcing the duplicate at all.
      aria-hidden
    >
      {span && (
        <div className="absolute inset-y-0 flex items-center" style={{ left: span.left, width: span.width }}>
          {/* Hairlines at 40% opacity were invisible against the chart: the brace
              was drawing correctly and still answered nothing, because nobody
              could see it. Uprights at full weight, a dashed rule between. */}
          <span className="bg-tertiary h-4 w-0.5 shrink-0 rounded-full" />
          <span className="border-tertiary/60 h-0 flex-1 border-t border-dashed" />
          <span className="bg-tertiary h-4 w-0.5 shrink-0 rounded-full" />
          {/* The dates ride on the brace itself. The sidebar carries them too, but
              a reader asking when a sprint runs is looking at the chart, and its
              row was the one place on screen that did not say. */}
          {label && span.width >= LABEL_MIN_WIDTH && (
            <span className="absolute left-1.5 text-10 whitespace-nowrap text-tertiary tabular-nums">{label}</span>
          )}
        </div>
      )}
    </div>
  );
});
