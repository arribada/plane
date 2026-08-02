/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One person's band in the workload timeline: their bars across every project,
 * their leave, and the periods where two of those bars are live at once.
 */
import { useMemo } from "react";
import { observer } from "mobx-react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@plane/utils";
import { projectColor, readableTextColor } from "@/plane-web/components/portfolio/colors";
import type { TWorkloadTimelineItem, TWorkloadTimelinePerson } from "@/plane-web/services/arribada.service";
import { clamp, dayOffset, formatRange, packLanes } from "./scale";

export const SIDEBAR_WIDTH = 268;

const BAR_HEIGHT_EXPANDED = 20;
const BAR_HEIGHT_COMPACT = 9;
const LANE_GAP = 3;
const ROW_PADDING = 7;
const MIN_ROW_HEIGHT = 38;

// Translucent, because the ribbon has to sit *over* the weekend shading and
// *under* the bars — but mixed from the danger token rather than from a literal.
// The hardcoded rgba(220,38,38,…) was a third red matching neither theme:
// --border-danger-strong resolves to #e7000b in light and #ff6467 in dark, and
// composited against the dark canvas the literal measured 1.11:1, so on the
// fork's own default theme the double-booked region was effectively not drawn.
// The redundant ring and the count badge meant nobody was misled — the warning
// was just doing a third of its job.
const CONFLICT_FILL = "color-mix(in srgb, var(--border-color-danger-strong) 16%, transparent)";
const CONFLICT_EDGE = "color-mix(in srgb, var(--border-color-danger-strong) 55%, transparent)";
const LEAVE_FILL = "rgba(120,135,160,0.28)";

type Props = {
  person: TWorkloadTimelinePerson;
  itemById: Map<string, TWorkloadTimelineItem>;
  /** Left edge of the chart, as an ISO day. Every offset is measured from here. */
  from: string;
  totalDays: number;
  px: number;
  expanded: boolean;
  onToggle: () => void;
  onFocusDate: (iso: string) => void;
  onOpenItem: (item: TWorkloadTimelineItem) => void;
};

const Initial = ({ person }: { person: TWorkloadTimelinePerson }) => (
  <span
    className="flex size-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-11 leading-none font-semibold text-white"
    style={
      person.avatar ? undefined : { backgroundColor: person.is_unassigned ? "#64748b" : projectColor(person.user_id) }
    }
    aria-hidden
  >
    {person.avatar ? (
      <img src={person.avatar} alt="" className="size-full object-cover" />
    ) : (
      (person.name || "?").charAt(0).toUpperCase()
    )}
  </span>
);

export const WorkloadPersonRow = observer(function WorkloadPersonRow({
  person,
  itemById,
  from,
  totalDays,
  px,
  expanded,
  onToggle,
  onFocusDate,
  onOpenItem,
}: Props) {
  const trackWidth = totalDays * px;

  const layout = useMemo(() => {
    const bars = person.item_ids
      .map((id) => itemById.get(id))
      .filter((item): item is TWorkloadTimelineItem => Boolean(item))
      .map((item) => {
        // An item with one date only is a marker, not a bar: we know when it lands,
        // not how long it takes. Drawing it as a span would invent a duration.
        const partial = !item.start_date || !item.target_date;
        const startIso = item.start_date ?? item.target_date ?? from;
        const endIso = item.target_date ?? item.start_date ?? from;
        const rawStart = dayOffset(startIso, from);
        const rawEnd = dayOffset(endIso, from);
        const startIndex = clamp(Math.min(rawStart, rawEnd), 0, Math.max(0, totalDays - 1));
        const endIndex = clamp(Math.max(rawStart, rawEnd), startIndex, Math.max(0, totalDays - 1));
        return {
          id: item.id,
          item,
          partial,
          startIndex,
          endIndex,
          clippedStart: rawStart < 0,
          clippedEnd: rawEnd > totalDays - 1,
        };
      });
    const { laneOf, laneCount } = packLanes(bars);
    const conflicted = new Set<string>();
    for (const overlap of person.overlaps) for (const id of overlap.issue_ids) conflicted.add(id);
    return { bars, laneOf, laneCount, conflicted };
  }, [person.item_ids, person.overlaps, itemById, from, totalDays]);

  const barHeight = expanded ? BAR_HEIGHT_EXPANDED : BAR_HEIGHT_COMPACT;
  const rowHeight = Math.max(
    MIN_ROW_HEIGHT,
    ROW_PADDING * 2 + layout.laneCount * barHeight + Math.max(0, layout.laneCount - 1) * LANE_GAP
  );

  const hasConflict = person.conflict_count > 0;

  return (
    <>
      <div className="flex border-b border-subtle" style={{ minHeight: rowHeight }}>
        {/* Sidebar. Sticky so the name stays readable however far right you scroll. */}
        <div
          className={cn(
            "sticky left-0 z-20 flex flex-shrink-0 items-start gap-2 border-r border-subtle bg-surface-1 px-2.5 py-2",
            hasConflict && "bg-danger-subtle"
          )}
          style={{ width: SIDEBAR_WIDTH, minHeight: rowHeight }}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            title={expanded ? "Collapse" : "Expand — show task names and conflicts"}
            className="mt-0.5 flex size-4 flex-shrink-0 cursor-pointer items-center justify-center rounded text-secondary hover:bg-layer-transparent-hover"
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <Initial person={person} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-13 font-medium text-primary" title={person.email || person.name}>
                {person.name}
              </span>
              {!person.is_active_member && !person.is_unassigned && (
                <span className="flex-shrink-0 text-10 text-placeholder" title="No longer an active workspace member">
                  inactive
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-10 leading-none text-placeholder">
              {hasConflict && (
                <button
                  type="button"
                  onClick={() => {
                    if (!expanded) onToggle();
                    onFocusDate(person.overlaps[0].start);
                  }}
                  title="Jump to the first clash"
                  className="inline-flex cursor-pointer items-center gap-1 rounded bg-danger-primary px-1.5 py-0.5 text-10 font-semibold text-white"
                >
                  <AlertTriangle className="size-2.5" />
                  {person.conflict_count} conflict{person.conflict_count === 1 ? "" : "s"}
                </button>
              )}
              <span title="Items placed on this row. Ones with only a single date are drawn as a hatched marker, not a bar, and are never counted as a clash.">
                {layout.bars.length} drawn
              </span>
              {person.is_unassigned && (
                <span
                  className="text-warning-primary"
                  title="Dated work with no assignee. Never checked for clashes — work nobody owns is not one pair of hands."
                >
                  nobody owns these
                </span>
              )}
              {person.undated_count > 0 && (
                <span
                  className="text-warning-primary"
                  title={`${person.undated_count} open item(s) have no dates at all, so nothing here can show them or check them for clashes`}
                >
                  {person.undated_count} undated
                </span>
              )}
              {person.partial_count > 0 && (
                <span title="Open items with only one of the two dates. A duration cannot be inferred from one date, so these are never checked for clashes.">
                  {person.partial_count} half-dated
                </span>
              )}
              {person.days_per_week < 5 && (
                <span title="Smallest week any project's roster records for this person">
                  {person.days_per_week} d/wk
                </span>
              )}
              {person.roles.slice(0, 2).map((role) => (
                <span key={role} className="truncate">
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Track */}
        <div className="relative flex-shrink-0" style={{ width: trackWidth, minHeight: rowHeight }}>
          {person.leave.map((span) => {
            const start = clamp(dayOffset(span.start, from), 0, Math.max(0, totalDays - 1));
            const end = clamp(dayOffset(span.end, from), start, Math.max(0, totalDays - 1));
            if (dayOffset(span.end, from) < 0 || dayOffset(span.start, from) > totalDays - 1) return null;
            return (
              <div
                key={`${span.start}-${span.end}`}
                className="absolute inset-y-0 z-0"
                title={`${person.name} is on leave ${formatRange(span.start, span.end)} — days in here are not counted as a clash`}
                style={{
                  left: start * px,
                  width: Math.max((end - start + 1) * px, 2),
                  backgroundImage: `repeating-linear-gradient(45deg, ${LEAVE_FILL}, ${LEAVE_FILL} 4px, transparent 4px, transparent 8px)`,
                }}
              />
            );
          })}

          {person.overlaps.map((overlap) => {
            const start = clamp(dayOffset(overlap.start, from), 0, Math.max(0, totalDays - 1));
            const end = clamp(dayOffset(overlap.end, from), start, Math.max(0, totalDays - 1));
            const names = overlap.issue_ids
              .map((id) => itemById.get(id))
              .filter((item): item is TWorkloadTimelineItem => Boolean(item))
              .map((item) => `${item.project_identifier}-${item.sequence_id} ${item.name}`);
            return (
              <div
                key={`${overlap.start}-${overlap.end}`}
                className="absolute inset-y-0 z-0"
                title={`${person.name} is on ${overlap.issue_ids.length} things at once, ${formatRange(overlap.start, overlap.end)} — ${overlap.days} working day${overlap.days === 1 ? "" : "s"}\n\n${names.join("\n")}`}
                style={{
                  left: start * px,
                  width: Math.max((end - start + 1) * px, 3),
                  backgroundColor: CONFLICT_FILL,
                  borderLeft: `1px solid ${CONFLICT_EDGE}`,
                  borderRight: `1px solid ${CONFLICT_EDGE}`,
                }}
              />
            );
          })}

          {layout.bars.map((bar) => {
            const color = projectColor(bar.item.project_id);
            const width = Math.max((bar.endIndex - bar.startIndex + 1) * px, bar.partial ? 8 : 4);
            const isConflicted = layout.conflicted.has(bar.id);
            const range =
              bar.item.start_date && bar.item.target_date
                ? formatRange(bar.item.start_date, bar.item.target_date)
                : bar.item.start_date
                  ? `starts ${formatRange(bar.item.start_date, bar.item.start_date)}, no target date`
                  : `due ${formatRange(bar.item.target_date ?? from, bar.item.target_date ?? from)}, no start date`;
            return (
              <button
                key={bar.id}
                type="button"
                onClick={() => onOpenItem(bar.item)}
                title={`${bar.item.project_identifier}-${bar.item.sequence_id} · ${bar.item.name}\n${bar.item.project_name}\n${range}${isConflicted ? "\n\nOverlaps another of this person's items." : ""}`}
                className={cn(
                  "absolute z-10 flex cursor-pointer items-center overflow-hidden rounded px-1 text-left",
                  isConflicted && "ring-2 ring-danger-strong",
                  bar.clippedStart && "rounded-l-none",
                  bar.clippedEnd && "rounded-r-none"
                )}
                style={{
                  left: bar.startIndex * px,
                  width,
                  top: ROW_PADDING + (layout.laneOf[bar.id] ?? 0) * (barHeight + LANE_GAP),
                  height: barHeight,
                  ...(bar.partial
                    ? {
                        // Hatched, the way the portfolio draws a derived project bar:
                        // this is a date we have, not a span we know.
                        backgroundImage: `repeating-linear-gradient(45deg, ${color}, ${color} 4px, transparent 4px, transparent 8px)`,
                        border: `1px dashed ${color}`,
                      }
                    : { backgroundColor: color }),
                }}
              >
                {expanded && width > 46 && !bar.partial && (
                  <span className="truncate text-11 leading-none" style={{ color: readableTextColor(color) }}>
                    {bar.item.project_identifier}-{bar.item.sequence_id} {bar.item.name}
                  </span>
                )}
              </button>
            );
          })}

          {layout.bars.length === 0 && (
            <span className="absolute top-1/2 left-2 -translate-y-1/2 text-11 text-placeholder">
              {person.assigned > 0
                ? `${person.assigned} open item${person.assigned === 1 ? "" : "s"}, none of them dated in this window`
                : "No open work"}
            </span>
          )}
        </div>
      </div>

      {/* Which tasks collide, spelled out. Sticky-left so it stays readable when the
          chart is scrolled months to the right. */}
      {expanded && hasConflict && (
        <div className="relative border-b border-subtle" style={{ width: SIDEBAR_WIDTH + trackWidth }}>
          <div className="sticky left-0 w-fit max-w-[760px] min-w-0 px-3 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-11 font-medium text-danger-primary">
              <AlertTriangle className="size-3" />
              {person.conflict_count} conflict{person.conflict_count === 1 ? "" : "s"} · {person.conflict_days} working
              day{person.conflict_days === 1 ? "" : "s"} double-booked
            </div>
            <div className="flex flex-col gap-1.5">
              {person.overlaps.map((overlap) => (
                <div key={`${overlap.start}-${overlap.end}`} className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onFocusDate(overlap.start)}
                    className="cursor-pointer rounded bg-danger-subtle px-1.5 py-0.5 text-11 whitespace-nowrap text-danger-primary tabular-nums"
                    title="Scroll the chart here"
                  >
                    {formatRange(overlap.start, overlap.end)} · {overlap.days}d
                  </button>
                  {overlap.issue_ids.map((id) => {
                    const item = itemById.get(id);
                    if (!item) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onOpenItem(item)}
                        className="flex max-w-[240px] cursor-pointer items-center gap-1 rounded border border-subtle px-1.5 py-0.5 text-11 text-secondary hover:bg-layer-transparent-hover"
                        title={`${item.project_name} · ${item.name}`}
                      >
                        <span
                          className="size-1.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: projectColor(item.project_id) }}
                        />
                        <span className="truncate">
                          {item.project_identifier}-{item.sequence_id} {item.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
});
