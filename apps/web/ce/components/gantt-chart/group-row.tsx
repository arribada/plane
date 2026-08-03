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
import { observer } from "mobx-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@plane/utils";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { getPositionFromDate } from "@/components/gantt-chart/views/helpers";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
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
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

export const GanttGroupHeader = observer(function GanttGroupHeader(props: Props) {
  const { label, color, count, collapsed, onToggle, start, end, days, done } = props;
  const complete = count > 0 ? Math.round((done / count) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      style={{ height: `${BLOCK_HEIGHT}px` }}
      className="flex w-full items-center gap-2 border-y-[0.5px] border-subtle bg-layer-2 px-3 text-left"
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

  let span: { left: number; width: number } | null = null;
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
      style={{ height: `${BLOCK_HEIGHT}px` }}
      className="relative w-full border-y-[0.5px] border-subtle bg-layer-2/40"
      aria-hidden
    >
      {span && (
        <div className="absolute inset-y-0 flex items-center" style={{ left: span.left, width: span.width }}>
          <span className="bg-tertiary/70 h-3 w-px shrink-0" />
          <span className="bg-tertiary/40 h-px flex-1" />
          <span className="bg-tertiary/70 h-3 w-px shrink-0" />
        </div>
      )}
    </div>
  );
});
