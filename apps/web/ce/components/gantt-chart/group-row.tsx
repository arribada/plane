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

type Props = {
  label: string;
  color?: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
};

export const GanttGroupHeader = observer(function GanttGroupHeader(props: Props) {
  const { label, color, count, collapsed, onToggle } = props;
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
    </button>
  );
});

/** The chart-pane counterpart: a full-width band so the group reads across the whole
 *  timeline, with nothing in it — the sidebar already carries the name. */
export function GanttGroupBand() {
  return (
    <div
      style={{ height: `${BLOCK_HEIGHT}px` }}
      className="w-full border-y-[0.5px] border-subtle bg-layer-2/40"
      aria-hidden
    />
  );
}
