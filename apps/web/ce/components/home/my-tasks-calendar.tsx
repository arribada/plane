/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Month calendar for the Home "My tasks" widget. Each assigned work item is drawn as a
 * DURATION BAR spanning start_date → due date (a single day when it only has a due date),
 * coloured by its status. A bar that runs across a week boundary is clipped into a segment
 * per week, and segments are lane-packed so overlapping tasks stack instead of colliding.
 * Past-dated work shows on its real days, so overdue and in-flight work reads at a glance.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@plane/utils";
import type { TMyWorkItem } from "@/plane-web/types/arribada";

// Fallback bar colour when a work item has no state colour (old API, or no state).
const PRIORITY_COLOR: Record<TMyWorkItem["priority"], string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#60a5fa",
  none: "#9ca3af",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const localISO = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/** Midnight-local Date from a YYYY-MM-DD (or ISO) string, or null. */
const parseDay = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

type Props = {
  items: TMyWorkItem[];
  onOpenItem: (item: TMyWorkItem) => void;
  onSetDue: (item: TMyWorkItem, value: string | null) => void;
};

// A drawable piece of a task within one week: the columns it spans and whether those
// edges are the task's true ends (for rounding) or a clip at the week boundary.
type Segment = {
  item: TMyWorkItem;
  weekRow: number;
  startCol: number; // 0..6
  endCol: number; // 0..6, inclusive
  roundedStart: boolean;
  roundedEnd: boolean;
  lane: number;
};

export const MyTasksCalendar = ({ items, onOpenItem }: Props) => {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const todayISO = localISO(new Date());

  // 6-week grid starting on the Monday on/before the 1st.
  const { cells, gridStart } = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday = 0
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    const c = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
    return { cells: c, gridStart: start };
  }, [month]);

  const undatedCount = items.filter((i) => !i.target_date && !i.start_date).length;

  // Turn each task into per-week segments clipped to the visible grid, then lane-pack the
  // segments within each week so overlapping bars stack rather than sit on top of each other.
  const segmentsByWeek = useMemo(() => {
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridStart.getDate() + 41);

    const raw: Omit<Segment, "lane">[] = [];
    for (const item of items) {
      const s = parseDay(item.start_date) ?? parseDay(item.target_date);
      const e = parseDay(item.target_date) ?? parseDay(item.start_date);
      if (!s || !e) continue;
      // Guard against a start after the due date.
      const start = s <= e ? s : e;
      const end = s <= e ? e : s;
      // Skip if the whole span is outside the visible grid.
      if (end < gridStart || start > gridEnd) continue;

      const clampedStart = start < gridStart ? gridStart : start;
      const clampedEnd = end > gridEnd ? gridEnd : end;
      const startIdx = dayDiff(clampedStart, gridStart); // 0..41
      const endIdx = dayDiff(clampedEnd, gridStart);

      // Split into one segment per week row it crosses.
      for (let week = Math.floor(startIdx / 7); week <= Math.floor(endIdx / 7); week++) {
        const weekStartIdx = week * 7;
        const weekEndIdx = weekStartIdx + 6;
        const segStartIdx = Math.max(startIdx, weekStartIdx);
        const segEndIdx = Math.min(endIdx, weekEndIdx);
        raw.push({
          item,
          weekRow: week,
          startCol: segStartIdx - weekStartIdx,
          endCol: segEndIdx - weekStartIdx,
          // Only round the edge that is the task's real start/end (not a week clip).
          roundedStart: segStartIdx === startIdx && start >= gridStart,
          roundedEnd: segEndIdx === endIdx && end <= gridEnd,
        });
      }
    }

    // Lane-pack per week: earliest-start first, first lane whose last bar has ended.
    const byWeek: Segment[][] = Array.from({ length: 6 }, () => []);
    for (let week = 0; week < 6; week++) {
      const weekSegs = raw.filter((r) => r.weekRow === week).sort((a, b) => a.startCol - b.startCol);
      const laneEnds: number[] = []; // last endCol used per lane
      for (const seg of weekSegs) {
        let lane = laneEnds.findIndex((end) => end < seg.startCol);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(seg.endCol);
        } else {
          laneEnds[lane] = seg.endCol;
        }
        byWeek[week].push({ ...seg, lane });
      }
    }
    return byWeek;
  }, [items, gridStart]);

  const shift = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-13 font-semibold text-primary">
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="hover:bg-neutral-500/10 rounded p-1 text-secondary"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            className="hover:bg-neutral-500/10 rounded px-1.5 py-0.5 text-11 text-secondary"
          >
            Today
          </button>
          <button type="button" onClick={() => shift(1)} className="hover:bg-neutral-500/10 rounded p-1 text-secondary">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-subtle">
        <div className="grid grid-cols-7 bg-layer-2">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="bg-layer-1 px-1 py-1 text-center text-[10px] font-medium tracking-wide text-secondary/70 uppercase"
            >
              {w}
            </div>
          ))}
        </div>

        {Array.from({ length: 6 }, (_, week) => {
          const weekCells = cells.slice(week * 7, week * 7 + 7);
          const segs = segmentsByWeek[week];
          const laneCount = segs.reduce((max, s) => Math.max(max, s.lane + 1), 0);
          return (
            <div key={week} className="relative border-t border-subtle first:border-t-0">
              {/* Day-number cells (the background grid). */}
              <div className="grid grid-cols-7">
                {weekCells.map((d) => {
                  const iso = localISO(d);
                  const inMonth = d.getMonth() === month.getMonth();
                  const isToday = iso === todayISO;
                  return (
                    <div key={iso} className={cn("min-h-[76px] bg-layer-1 px-1 pt-1", !inMonth && "opacity-40")}>
                      <div className={cn("text-right text-[11px]", isToday ? "text-accent-primary" : "text-secondary/70")}>
                        {isToday ? (
                          <span className="inline-flex size-4 items-center justify-center rounded-full bg-accent-primary text-[10px] text-white">
                            {d.getDate()}
                          </span>
                        ) : (
                          d.getDate()
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Duration bars, spanning their day columns and stacked in lanes. Offset from
                  the top so they clear the day numbers. */}
              <div
                className="pointer-events-none absolute inset-x-0 top-6 grid grid-cols-7 gap-x-px gap-y-0.5 px-0.5"
                style={{ gridTemplateRows: `repeat(${Math.max(laneCount, 1)}, 16px)` }}
              >
                {segs.map((seg) => {
                  const color = seg.item.state_color || PRIORITY_COLOR[seg.item.priority];
                  return (
                    <button
                      key={`${seg.item.id}-${seg.startCol}`}
                      type="button"
                      onClick={() => onOpenItem(seg.item)}
                      title={`${seg.item.name} · ${seg.item.project_identifier}-${seg.item.sequence_id}${
                        seg.item.state_name ? ` · ${seg.item.state_name}` : ""
                      }`}
                      className={cn(
                        "pointer-events-auto flex h-4 min-w-0 items-center overflow-hidden px-1 text-[10px] font-medium text-white",
                        seg.roundedStart ? "rounded-l" : "",
                        seg.roundedEnd ? "rounded-r" : ""
                      )}
                      style={{
                        gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
                        gridRow: seg.lane + 1,
                        backgroundColor: color,
                      }}
                    >
                      {/* Only the first (rounded) segment carries the name, so a multi-week
                          bar does not repeat it in every week. */}
                      {seg.roundedStart && <span className="truncate">{seg.item.name}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {undatedCount > 0 && (
        <p className="mt-2 px-1 text-[11px] text-secondary/70">
          {undatedCount} task{undatedCount > 1 ? "s" : ""} with no date (set one in list view)
        </p>
      )}
    </div>
  );
};
