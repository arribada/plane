/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Fills the CE additional-layers stub with the touches that make a plain bar
 * chart read as a real gantt: a "today" line, milestone diamonds for
 * zero-duration items, and faint weekend shading. Additive overlay only — it
 * reads bar positions from the timeline store and draws on top, so no bar
 * renderer is touched.
 */
import type { FC } from "react";
import { useContext, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { GANTT_TIMELINE_TYPE } from "@plane/types";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { useWorkspaceHolidays } from "../use-workspace-holidays";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { useProjectSlack } from "@/plane-web/components/gantt-chart/use-project-slack";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { getBaselineShared } from "../baseline-request";

type Props = {
  itemsContainerWidth: number;
  blockCount: number;
};

const DIAMOND = 7; // half-diagonal of a milestone marker
const BAR = 18; // visible bar height the progress fill sits inside

/**
 * Cross-project dependency arrows, in their own observer.
 *
 * Split out because of ONE line: these arrows dim the ones you are not pointing
 * at, which means reading `store.activeBlockId` — and `block-row.tsx` writes that
 * on `onMouseEnter` and `onMouseLeave`. Read from the parent, it made moving the
 * mouse across a single bar recompute the ENTIRE overlay: weekend bands, holiday
 * bands, ghost bars, slack tails, milestones, all of it, for every block on the
 * chart, several times a second.
 *
 * MobX tracks whatever a component reads while it renders, so moving the read
 * down here is the whole fix: a hover now re-renders the arrows and nothing else,
 * and on a project gantt — where these arrows never draw — it re-renders nothing
 * at all, because the parent no longer mounts this component.
 *
 * Everything below is the code that used to live inline, unchanged.
 */
const DependencyArrows: FC<{ blockIds: string[] }> = observer(function DependencyArrows({ blockIds }) {
  const store = useTimeLineChartStore();
  const portfolio = usePortfolio();
  const active = store.activeBlockId;

  // Drawn whenever there are edges. Gating them on the critical-path switch meant a
  // portfolio of six projects showed no dependencies until somebody pressed a button
  // whose label promises something else entirely.
  if (!portfolio.crossEdges.length) return null;

  // Drawn only between two currently-positioned bars; critical edges in red,
  // cross-project in purple dashed, in-project in grey. predecessor end ->
  // successor start.
  const arrows: {
    path: string;
    hx: number;
    hy: number;
    color: string;
    width: number;
    dash?: string;
    opacity: number;
    from: string;
    to: string;
  }[] = [];
  const idx = new Map<string, number>();
  blockIds.forEach((id, i) => idx.set(id, i));
  for (const e of portfolio.crossEdges) {
    const ia = idx.get(e.from);
    const ib = idx.get(e.to);
    if (ia === undefined || ib === undefined) continue;
    const ba = store.getBlockById(e.from);
    const bb = store.getBlockById(e.to);
    if (!ba?.position || !bb?.position) continue;
    const x1 = ba.position.marginLeft + (ba.position.width ?? 0); // predecessor end
    const x2 = bb.position.marginLeft; // successor start
    const y1 = ia * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
    const y2 = ib * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
    // Rounded elbow: drop just before the successor's start, then arrive pointing
    // into it. Square corners at this density read as a circuit diagram.
    const midx = Math.max(x1 + 8, x2 - 10);
    const r = Math.min(5, Math.abs(y2 - y1) / 2, Math.max(0, midx - x1));
    const down = y2 >= y1 ? 1 : -1;
    const path =
      r > 1
        ? `M ${x1} ${y1} H ${midx - r} a ${r} ${r} 0 0 ${down > 0 ? 1 : 0} ${r} ${down * r} V ${y2 - down * r} a ${r} ${r} 0 0 ${down > 0 ? 0 : 1} ${r} ${down * r} H ${x2}`
        : `M ${x1} ${y1} H ${midx} V ${y2} H ${x2}`;
    // Red is the critical chain and nothing else; a cross-project link is dashed
    // because crossing a project boundary is a fact about the link, not a severity.
    const highlighted = portfolio.showCriticalPath && e.critical;
    const related = active === e.from || active === e.to;
    const color = highlighted ? "#ef4444" : e.cross_project ? "#8b5cf6" : "#94a3b8";
    arrows.push({
      path,
      hx: x2,
      hy: y2,
      color,
      width: highlighted ? 2 : related ? 1.75 : 1,
      dash: e.cross_project && !highlighted ? "4 2" : undefined,
      // Same three states as the project gantt: at rest they sit back far enough
      // to read the bars through, and pointing at one bar lights only its own.
      opacity: related ? 0.95 : active ? 0.08 : highlighted ? 0.85 : 0.32,
      from: e.from,
      to: e.to,
    });
  }

  return (
    <>
      {arrows.map((a) => (
        // The "fade dependency arrows" switch applies here too, so the portfolio
        // and the per-project chart answer it the same way.
        <g
          key={`dep-${a.from}-${a.to}`}
          opacity={store.dimDependencies ? a.opacity : Math.max(a.opacity, 0.7)}
          style={{ transition: "opacity .12s" }}
        >
          <path d={a.path} fill="none" stroke={a.color} strokeWidth={a.width} strokeDasharray={a.dash} />
          <path d={`M ${a.hx} ${a.hy} l -5 -3 l 0 6 z`} fill={a.color} />
        </g>
      ))}
    </>
  );
});

export const GanttAdditionalLayers: FC<Props> = observer(function GanttAdditionalLayers(props) {
  const { itemsContainerWidth, blockCount } = props;
  const { workspaceSlug, projectId } = useParams();
  const store = useTimeLineChartStore();
  // Shared with the arrows, which colour the critical chain from the same answer.
  const { byIssue: slackByIssue } = useProjectSlack(workspaceSlug?.toString(), projectId?.toString());
  // This overlay is shared by every gantt (issues/cycles/modules); the portfolio-only
  // critical-path arrows must render solely in the portfolio's PROJECT timeline slot.
  const isPortfolio = useContext(TimeLineTypeContext) === GANTT_TIMELINE_TYPE.PROJECT;
  const [baseline, setBaseline] = useState<Record<string, { start: string | null; target: string | null }>>({});

  // Which promised plan the ghosts draw; empty means the newest.
  const selectedBaseline = store.selectedBaselineId;

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug && projectId) {
      const ws = workspaceSlug.toString();
      const pid = projectId.toString();
      // Whichever snapshot the reader picked, the newest by default. An entry
      // whose work item was deleted has a null id and no bar to sit behind — the
      // baseline still records it, and the report is where that shows.
      //
      // Shared with BaselinePicker, which mounts beside this and used to make the
      // byte-identical request in the same commit.
      getBaselineShared(ws, pid, selectedBaseline || undefined)
        .then((payload) => {
          if (cancelled) return;
          const map: Record<string, { start: string | null; target: string | null }> = {};
          for (const r of payload?.entries ?? []) {
            if (r.issue_id) map[r.issue_id] = { start: r.start_date, target: r.target_date };
          }
          setBaseline(map);
          return undefined;
        })
        .catch(() => {
          // No ghosts to draw. This is an SVG overlay with nowhere to put a
          // sentence, so the reporting is delegated to BaselinePicker beside the
          // chart: it makes the same request, and when it fails it renders a
          // "Baselines unavailable" chip that says the ghost bars are missing for
          // that reason rather than because nothing was ever frozen.
          if (!cancelled) setBaseline({});
        });
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, selectedBaseline]);

  // ABOVE the early return: this is a hook, and calling it only on the renders
  // where currentViewData exists changes the hook count between renders, which
  // React answers with "Rendered more hooks than during the previous render" —
  // a crash, not a warning.
  const holidays = useWorkspaceHolidays(workspaceSlug?.toString());

  const view = store.currentViewData;
  if (!view) return null;

  const height = Math.max(blockCount, 1) * BLOCK_HEIGHT;
  const blockIds = store.blockIds ?? [];
  const dayWidthForTails: number = view.data?.dayWidth ?? 0;

  // Progress fills moved into the bar itself (IssueGanttBlock): drawn here they sat
  // in an overlay at zIndex 4, underneath bars that are opaque now the 50% veil is
  // gone — so they were computed on every render and never seen.

  // Slack tails: a hairline continuing past a bar to where it could still finish
  // without moving anything else. This is what turns dates into a decision — "four
  // days of room here" is actionable, "runs 5-18 January" is not — and it is the
  // one thing MS Project and Primavera report that the modern tools dropped.
  //
  // Free float, not total: total float would draw a tail into space the successors
  // are already using, which reads as more room than there is.
  const tails: { x: number; y: number; w: number; days: number }[] = [];
  if (dayWidthForTails > 0) {
    for (let i = 0; i < blockIds.length; i++) {
      const info = slackByIssue[blockIds[i]];
      if (!info || info.free <= 0) continue;
      const block = store.getBlockById(blockIds[i]);
      if (!block?.position?.width) continue;
      // Working days, so the tail has to skip weekends the same way the bars do.
      const calendarDays = info.free + Math.floor(info.free / 5) * 2;
      tails.push({
        x: block.position.marginLeft + block.position.width,
        y: i * BLOCK_HEIGHT + BLOCK_HEIGHT / 2,
        w: calendarDays * dayWidthForTails,
        days: info.free,
      });
    }
  }

  // "today" marker
  const todayX = store.getPositionFromDateOnGantt(new Date(), 0);

  // weekend bands, day-accurate, only when a day column is wide enough to read
  const dayWidth: number = view.data?.dayWidth ?? 0;
  const bands: { x: number; w: number }[] = [];
  const holidayBands: { x: number; w: number; name: string }[] = [];
  // Respects the display switch. Without this, turning weekends off cleared them
  // from the header strip and left them shaded across the bars.
  if (store.showWeekends && dayWidth >= 12 && view.data?.startDate) {
    const start = new Date(view.data.startDate);
    const days = Math.ceil(itemsContainerWidth / dayWidth) + 1;
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) {
        bands.push({ x: i * dayWidth, w: dayWidth });
        continue;
      }
      // A public holiday or a workspace closure, shaded like a weekend because it
      // IS one as far as the plan is concerned. The planner already steps over
      // these; without drawing them the chart shows that plan on a calendar
      // pretending they do not exist.
      //
      // Local date parts, never toISOString: that shifts the day for anyone east
      // of Greenwich and would shade the wrong column.
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const name = holidays[iso];
      if (name) holidayBands.push({ x: i * dayWidth, w: dayWidth, name });
    }
  }

  // ghost bars: the captured baseline, drawn as a hollow outline behind the live bar
  const ghosts: { x: number; y: number; w: number }[] = [];
  for (let i = 0; i < blockIds.length; i++) {
    const b = baseline[blockIds[i]];
    if (!b || (!b.start && !b.target)) continue;
    const x1 = store.getPositionFromDateOnGantt(b.start ?? b.target ?? "", 0);
    const x2 = store.getPositionFromDateOnGantt(b.target ?? b.start ?? "", 0);
    if (typeof x1 !== "number" || typeof x2 !== "number") continue;
    ghosts.push({ x: x1, y: i * BLOCK_HEIGHT + (BLOCK_HEIGHT - BAR) / 2 - 5, w: Math.max(x2 - x1, 3) });
  }

  // milestones: zero-duration items (start === target) drawn as named diamonds
  // Ids the bar renderer should not draw at all: a diamond replaces the bar, it
  // does not decorate it, and a 3px sliver poking out from under it reads as a bug.
  const milestones: { x: number; y: number; name: string }[] = [];
  for (let i = 0; i < blockIds.length; i++) {
    const block = store.getBlockById(blockIds[i]);
    if (!block?.position || !block.start_date || !block.target_date) continue;
    if (block.start_date !== block.target_date) continue;
    const name = (block as { name?: string })?.name ?? (block as { data?: { name?: string } })?.data?.name ?? "";
    milestones.push({ x: block.position.marginLeft, y: i * BLOCK_HEIGHT + BLOCK_HEIGHT / 2, name });
  }

  return (
    <svg
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: itemsContainerWidth, height, overflow: "visible", zIndex: 4 }}
    >
      {bands.map((b) => (
        <rect key={`wk-${b.x}`} x={b.x} y={0} width={b.w} height={height} className="fill-primary" opacity={0.035} />
      ))}
      {/* A shade darker than a weekend, and it carries its name: "why is nothing
          happening that week" is answerable by hovering rather than by asking. */}
      {holidayBands.map((b) => (
        <rect key={`hol-${b.x}`} x={b.x} y={0} width={b.w} height={height} className="fill-primary" opacity={0.07}>
          <title>{b.name}</title>
        </rect>
      ))}
      {ghosts.map((g) => (
        <rect
          key={`bl-${g.x}-${g.y}`}
          x={g.x}
          y={g.y}
          width={g.w}
          height={5}
          rx={2}
          fill="none"
          stroke="#64748b"
          strokeWidth={1}
          strokeDasharray="3 2"
          opacity={0.75}
        />
      ))}
      {tails.map((t) => (
        <g key={`sl-${t.x}-${t.y}`} opacity={0.75}>
          <line x1={t.x} y1={t.y} x2={t.x + t.w} y2={t.y} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 2" />
          {/* End cap, so a tail reads as a bounded amount of room rather than as a
              line that trails off. */}
          <line x1={t.x + t.w} y1={t.y - 4} x2={t.x + t.w} y2={t.y + 4} stroke="#94a3b8" strokeWidth={1.5} />
          {t.w > 26 && (
            <text x={t.x + 4} y={t.y - 4} fontSize={9} className="fill-tertiary">
              +{t.days}d
            </text>
          )}
        </g>
      ))}
      {typeof todayX === "number" && (
        <g>
          {/* Dashed and capped. A plain hairline was easy to mistake for a month
              gridline, and easier still to lose now the bars carry full colour. */}
          <line
            x1={todayX}
            y1={0}
            x2={todayX}
            y2={height}
            stroke="#ef4444"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.85}
          />
          <circle cx={todayX} cy={3} r={3} fill="#ef4444" />
        </g>
      )}
      {isPortfolio && <DependencyArrows blockIds={blockIds} />}
      {milestones.map((m) => (
        <g key={`ms-${m.x}-${m.y}`}>
          <path
            d={`M ${m.x} ${m.y - DIAMOND} L ${m.x + DIAMOND} ${m.y} L ${m.x} ${m.y + DIAMOND} L ${m.x - DIAMOND} ${m.y} Z`}
            fill="#f59e0b"
            stroke="#b45309"
            strokeWidth={1}
          />
          {m.name && (
            <text
              x={m.x + DIAMOND + 4}
              y={m.y + 3}
              fontSize={10}
              className="fill-secondary"
              style={{ fontWeight: 500 }}
            >
              {m.name.length > 28 ? m.name.slice(0, 28) + "…" : m.name}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
});
