/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a folded parent's sub-tasks cover, drawn behind the parent's own bar.
 *
 * THE DECISION THIS IMPLEMENTS: a parent's bar always spans the parent's own
 * dates, folded or not. It is tempting to re-span a collapsed parent to its
 * children's envelope — every other gantt does — but the bar on this chart is
 * draggable and resizable, and a bar that means "my children" has no defined
 * answer to being dragged: does it move every child, proportionally, or clamp
 * them? Until that question has a product answer, a summary bar would be a
 * control that quietly does the wrong thing, and `start_date`/`target_date` are
 * fields somebody typed in and can see in the side panel. So the bar keeps
 * meaning exactly one thing.
 *
 * That leaves the honest gap: children can run outside the parent's dates, and
 * folding them would hide it. This band is the answer — a low-contrast range
 * behind the bar, only while the children are folded AND only when they reach
 * outside it. On a well-formed plan, where a parent already spans its children,
 * nothing is drawn at all.
 */
import { observer } from "mobx-react";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { getPositionFromDate } from "@/components/gantt-chart/views/helpers";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { useGanttGroups } from "./group-context";

export const SubtaskRollupBand = observer(function SubtaskRollupBand({ blockId }: { blockId: string }) {
  const { subtasks } = useGanttGroups();
  const store = useTimeLineChartStore();
  const chart = store.currentViewData;

  const rollup = subtasks.enabled && subtasks.isCollapsed(blockId) ? subtasks.rollupOf(blockId) : null;
  if (!rollup || !chart) return null;

  const left = getPositionFromDate(chart, rollup.start, 0);
  const right = getPositionFromDate(chart, rollup.end, 0) + chart.data.dayWidth;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  return (
    <div
      className="pointer-events-none absolute top-0 flex items-center"
      style={{ height: `${BLOCK_HEIGHT}px`, left: `${left}px`, width: `${Math.max(right - left, 4)}px` }}
      aria-hidden
    >
      <span className="border-tertiary/70 bg-tertiary/10 h-5 w-full rounded-sm border border-dashed" />
    </div>
  );
});
