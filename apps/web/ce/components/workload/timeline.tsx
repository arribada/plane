/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Workload as a timeline: one row per person, their work laid out in time across
 * every project, and the periods where two of their own items are live at once.
 *
 * Not built on the gantt-chart store: that machinery is a singleton per timeline
 * slot on the root store, it keys blocks by issue id — and here one issue with two
 * assignees has to be drawn on two different rows — and it has no notion of a
 * region of the chart being wrong. A person board is a different shape, so it gets
 * its own (self-contained, read-only) layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@plane/utils";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { projectColor } from "@/plane-web/components/portfolio/colors";
import {
  ArribadaService,
  type TWorkloadTimeline,
  type TWorkloadTimelineItem,
} from "@/plane-web/services/arribada.service";
import { SIDEBAR_WIDTH, WorkloadPersonRow } from "./person-row";
import {
  type TZoom,
  ZOOM_LEVELS,
  clamp,
  dayOffset,
  formatRange,
  monthBands,
  weekTicks,
  weekendBackground,
  zoomPx,
} from "./scale";

const TODAY_LINE = "rgba(220,38,38,0.75)";
const HOLIDAY_FILL = "rgba(120,135,160,0.22)";

export const WorkloadTimeline = observer(function WorkloadTimeline() {
  const { workspaceSlug } = useParams();
  const { setPeekIssue } = useIssueDetail();
  const service = useMemo(() => new ArribadaService(), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [data, setData] = useState<TWorkloadTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<TZoom>("weeks");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [includeEmpty, setIncludeEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceSlug) return undefined;
    setLoading(true);
    setError(null);
    service
      .getWorkloadTimeline(workspaceSlug.toString(), { includeEmpty })
      .then((payload) => {
        if (cancelled) return undefined;
        setData(payload);
        // Anyone with a clash opens expanded. A conflict the reader has to go
        // looking for is a conflict nobody acts on.
        setExpanded(
          Object.fromEntries((payload?.people ?? []).filter((p) => p.conflict_count > 0).map((p) => [p.user_id, true]))
        );
        return undefined;
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(typeof e?.error === "string" ? e.error : "Could not load the workload timeline.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, service, includeEmpty]);

  const px = zoomPx(zoom);
  const from = data?.window.from ?? "";
  const totalDays = data ? Math.max(1, dayOffset(data.window.to, data.window.from) + 1) : 1;
  const trackWidth = totalDays * px;

  const itemById = useMemo(() => {
    const map = new Map<string, TWorkloadTimelineItem>();
    for (const item of data?.items ?? []) map.set(item.id, item);
    return map;
  }, [data]);

  const bands = useMemo(() => (from ? monthBands(from, totalDays) : []), [from, totalDays]);
  const ticks = useMemo(() => (from ? weekTicks(from, totalDays) : []), [from, totalDays]);
  // At quarter zoom a Monday tick every 21px is unreadable, so thin them out.
  const tickStep = px >= 9 ? 1 : 4;

  const projects = useMemo(() => {
    const seen = new Map<string, { id: string; identifier: string; name: string; count: number }>();
    for (const item of data?.items ?? []) {
      const entry = seen.get(item.project_id);
      if (entry) entry.count += 1;
      else
        seen.set(item.project_id, {
          id: item.project_id,
          identifier: item.project_identifier,
          name: item.project_name,
          count: 1,
        });
    }
    // oxlint-disable-next-line unicorn/no-array-sort -- the spread is ours alone; toSorted is ES2023
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [data]);

  const totals = useMemo(() => {
    const people = data?.people ?? [];
    return {
      people: people.length,
      clashing: people.filter((p) => p.conflict_count > 0).length,
      conflicts: people.reduce((sum, p) => sum + p.conflict_count, 0),
      undated: people.reduce((sum, p) => sum + p.undated_count, 0),
      halfDated: people.reduce((sum, p) => sum + p.partial_count, 0),
    };
  }, [data]);

  const scrollToDay = useCallback(
    (iso: string, smooth = true) => {
      const node = scrollRef.current;
      if (!node || !from) return;
      const offset = clamp(dayOffset(iso, from), 0, totalDays);
      node.scrollTo({ left: Math.max(0, offset * px - 180), behavior: smooth ? "smooth" : "auto" });
    },
    [from, px, totalDays]
  );

  // Land on today rather than at the left edge, and keep doing so when the zoom
  // changes — otherwise zooming out drops the reader in last month.
  useEffect(() => {
    if (data?.today) scrollToDay(data.today, false);
  }, [data?.today, px, scrollToDay]);

  const openItem = useCallback(
    (item: TWorkloadTimelineItem) => {
      if (!workspaceSlug) return;
      setPeekIssue({ workspaceSlug: workspaceSlug.toString(), projectId: item.project_id, issueId: item.id });
    },
    [workspaceSlug, setPeekIssue]
  );

  const toggle = useCallback((userId: string) => {
    setExpanded((current) => ({ ...current, [userId]: !current[userId] }));
  }, []);

  if (loading)
    return (
      <div className="flex h-full items-center justify-center text-secondary">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );

  if (error || !data)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-13 text-secondary">
        <AlertTriangle className="size-5 text-danger-primary" />
        {error ?? "No workload data."}
      </div>
    );

  const todayOffset = dayOffset(data.today, from);

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col">
        {/* Toolbar */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-subtle px-4 py-2">
          <div className="flex items-center gap-2 text-12 text-secondary">
            <span className="tabular-nums">{formatRange(data.window.from, data.window.to)}</span>
            <span className="text-placeholder">·</span>
            <span>{totals.people} people</span>
            {totals.conflicts > 0 ? (
              <span className="inline-flex items-center gap-1 rounded bg-danger-subtle px-1.5 py-0.5 text-12 font-medium text-danger-primary">
                <AlertTriangle className="size-3" />
                {totals.conflicts} conflict{totals.conflicts === 1 ? "" : "s"} across {totals.clashing}{" "}
                {totals.clashing === 1 ? "person" : "people"}
              </span>
            ) : (
              <span className="text-placeholder">No overlapping work</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {data.hidden_people_count > 0 && !includeEmpty && (
              <button
                type="button"
                onClick={() => setIncludeEmpty(true)}
                className="cursor-pointer text-11 text-secondary underline decoration-dotted underline-offset-2 hover:text-primary"
              >
                {data.hidden_people_count} with no open work — show
              </button>
            )}
            {includeEmpty && (
              <button
                type="button"
                onClick={() => setIncludeEmpty(false)}
                className="cursor-pointer text-11 text-secondary underline decoration-dotted underline-offset-2 hover:text-primary"
              >
                Hide people with no open work
              </button>
            )}
            <div className="flex items-center gap-0.5 rounded-md border border-subtle p-0.5">
              {ZOOM_LEVELS.map((level) => (
                <button
                  key={level.key}
                  type="button"
                  onClick={() => setZoom(level.key)}
                  className={cn(
                    "cursor-pointer rounded px-2 py-0.5 text-11",
                    zoom === level.key ? "bg-layer-2 font-medium text-primary" : "text-secondary hover:text-primary"
                  )}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          {/* What each bar colour means. Without it "spot the person on two projects"
              is a guessing game. */}
          {projects.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
              {projects.slice(0, 14).map((project) => (
                <span key={project.id} className="flex items-center gap-1 text-10 text-secondary" title={project.name}>
                  <span
                    className="size-2 flex-shrink-0 rounded-sm"
                    style={{ backgroundColor: projectColor(project.id) }}
                  />
                  {project.identifier}
                </span>
              ))}
              {projects.length > 14 && <span className="text-10 text-placeholder">+{projects.length - 14} more</span>}
            </div>
          )}
        </div>

        {/* Caveats, stated rather than hidden: a board drawn from 40% of the work
            is a lie unless it says so. */}
        {(totals.undated > 0 || totals.halfDated > 0 || data.truncated) && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-subtle bg-warning-subtle px-4 py-1 text-11 text-warning-primary">
            {totals.undated > 0 && (
              <span>
                {totals.undated} open item{totals.undated === 1 ? "" : "s"} have no dates at all — nothing below can
                show them or check them for clashes.
              </span>
            )}
            {totals.halfDated > 0 && (
              <span>{totals.halfDated} have only one date, drawn as a marker and never counted as a clash.</span>
            )}
            {data.truncated && <span>Too many items to show them all — this window is incomplete.</span>}
          </div>
        )}

        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          <div className="relative min-w-full" style={{ width: SIDEBAR_WIDTH + trackWidth }}>
            {/* Header */}
            <div className="sticky top-0 z-30 flex border-b border-subtle bg-surface-1">
              <div
                className="sticky left-0 z-10 flex flex-shrink-0 items-end border-r border-subtle bg-surface-1 px-3 pb-1 text-11 font-medium tracking-wide text-secondary uppercase"
                style={{ width: SIDEBAR_WIDTH, height: 44 }}
              >
                Person
              </div>
              <div className="relative flex-shrink-0" style={{ width: trackWidth, height: 44 }}>
                {bands.map((band) => (
                  <div
                    key={band.key}
                    className="absolute top-0 h-6 overflow-hidden border-l border-subtle pl-1 text-11 leading-6 whitespace-nowrap text-secondary"
                    style={{ left: band.offset * px, width: band.days * px }}
                  >
                    {band.days * px > 44 ? band.label : ""}
                  </div>
                ))}
                {ticks
                  .filter((_, index) => index % tickStep === 0)
                  .map((tick) => (
                    <div
                      key={tick.offset}
                      className="absolute bottom-0 h-4 border-l border-subtle pl-0.5 text-10 leading-4 text-placeholder"
                      style={{ left: tick.offset * px }}
                    >
                      {px >= 9 ? tick.label : ""}
                    </div>
                  ))}
                {todayOffset >= 0 && todayOffset < totalDays && (
                  <div
                    className="absolute bottom-0 z-10 h-4 w-px"
                    style={{ left: todayOffset * px, backgroundColor: TODAY_LINE }}
                  >
                    <span
                      className="absolute bottom-0 left-0.5 rounded px-1 text-10 leading-4 font-medium whitespace-nowrap text-white"
                      style={{ backgroundColor: TODAY_LINE }}
                    >
                      today
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="relative">
              {/* One paint for weekends, holidays and the today line, behind every row. */}
              <div
                className="pointer-events-none absolute inset-y-0 z-0"
                style={{ left: SIDEBAR_WIDTH, width: trackWidth, ...weekendBackground(from, px) }}
              >
                {data.holidays.map((holiday) => {
                  const offset = dayOffset(holiday, from);
                  if (offset < 0 || offset >= totalDays) return null;
                  return (
                    <div
                      key={holiday}
                      className="absolute inset-y-0"
                      style={{ left: offset * px, width: Math.max(px, 2), backgroundColor: HOLIDAY_FILL }}
                    />
                  );
                })}
                {todayOffset >= 0 && todayOffset < totalDays && (
                  <div
                    className="absolute inset-y-0 w-px"
                    style={{ left: todayOffset * px, backgroundColor: TODAY_LINE }}
                  />
                )}
              </div>

              {data.people.length === 0 && (
                <div className="px-4 py-10 text-center text-13 text-secondary">
                  Nobody has dated work in this window.
                </div>
              )}

              {data.people.map((person) => (
                <WorkloadPersonRow
                  key={person.user_id}
                  person={person}
                  itemById={itemById}
                  from={from}
                  totalDays={totalDays}
                  px={px}
                  expanded={Boolean(expanded[person.user_id])}
                  onToggle={() => toggle(person.user_id)}
                  onFocusDate={scrollToDay}
                  onOpenItem={openItem}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* self-fetching and null until something is peeked, so it can mount unconditionally */}
      <IssuePeekOverview />
    </>
  );
});
