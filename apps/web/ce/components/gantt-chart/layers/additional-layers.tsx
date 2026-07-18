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
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type Props = {
  itemsContainerWidth: number;
  blockCount: number;
};

const DIAMOND = 7; // half-diagonal of a milestone marker
const BAR = 18; // visible bar height the progress fill sits inside

export const GanttAdditionalLayers: FC<Props> = observer(function GanttAdditionalLayers(props) {
  const { itemsContainerWidth, blockCount } = props;
  const { workspaceSlug, projectId } = useParams();
  const store = useTimeLineChartStore();
  const portfolio = usePortfolio();
  const service = useMemo(() => new ArribadaService(), []);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [baseline, setBaseline] = useState<Record<string, { start: string | null; target: string | null }>>({});

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug && projectId) {
      const ws = workspaceSlug.toString();
      const pid = projectId.toString();
      service
        .getProjectProgress(ws, pid)
        .then((rows) => {
          if (cancelled) return;
          const map: Record<string, number> = {};
          for (const r of rows || []) map[r.issue_id] = r.percent;
          setProgress(map);
        })
        .catch(() => {
          if (!cancelled) setProgress({});
        });
      service
        .getBaseline(ws, pid)
        .then((rows) => {
          if (cancelled) return;
          const map: Record<string, { start: string | null; target: string | null }> = {};
          for (const r of rows || []) map[r.issue_id] = { start: r.start_date, target: r.target_date };
          setBaseline(map);
        })
        .catch(() => {
          if (!cancelled) setBaseline({});
        });
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service]);

  const view = store.currentViewData;
  if (!view) return null;

  const height = Math.max(blockCount, 1) * BLOCK_HEIGHT;
  const blockIds = store.blockIds ?? [];

  // progress fills: a darker inset bar covering `percent` of each item's bar
  const fills: { x: number; y: number; w: number }[] = [];
  for (let i = 0; i < blockIds.length; i++) {
    const pct = progress[blockIds[i]];
    if (!pct) continue;
    const block = store.getBlockById(blockIds[i]);
    if (!block?.position || !block.position.width) continue;
    fills.push({
      x: block.position.marginLeft,
      y: i * BLOCK_HEIGHT + (BLOCK_HEIGHT - BAR) / 2,
      w: (block.position.width * Math.min(pct, 100)) / 100,
    });
  }

  // "today" marker
  const todayX = store.getPositionFromDateOnGantt(new Date(), 0);

  // weekend bands, day-accurate, only when a day column is wide enough to read
  const dayWidth: number = view.data?.dayWidth ?? 0;
  const bands: { x: number; w: number }[] = [];
  if (dayWidth >= 12 && view.data?.startDate) {
    const start = new Date(view.data.startDate);
    const days = Math.ceil(itemsContainerWidth / dayWidth) + 1;
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) bands.push({ x: i * dayWidth, w: dayWidth });
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

  // cross-project dependency arrows (portfolio "critical path" mode). Drawn only
  // between two currently-positioned bars; critical edges in red, cross-project in
  // purple dashed, in-project in grey. predecessor end -> successor start.
  const arrows: { path: string; hx: number; hy: number; color: string; width: number; dash?: string }[] = [];
  if (portfolio.showCriticalPath && portfolio.crossEdges.length) {
    const idx = new Map<string, number>();
    blockIds.forEach((id, i) => idx.set(id, i));
    for (const e of portfolio.crossEdges) {
      const ia = idx.get(e.from);
      const ib = idx.get(e.to);
      if (ia === undefined || ib === undefined) continue;
      const ba = store.getBlockById(e.from);
      const bb = store.getBlockById(e.to);
      if (!ba?.position || !bb?.position) continue;
      const x1 = ba.position.marginLeft + (ba.position.width ?? 0);
      const x2 = bb.position.marginLeft;
      const y1 = ia * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
      const y2 = ib * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
      const midx = Math.max(x1, x2) + 10;
      const color = e.critical ? "#ef4444" : e.cross_project ? "#8b5cf6" : "#94a3b8";
      arrows.push({
        path: `M ${x1} ${y1} H ${midx} V ${y2} H ${x2}`,
        hx: x2,
        hy: y2,
        color,
        width: e.critical ? 2 : 1.25,
        dash: e.cross_project && !e.critical ? "4 2" : undefined,
      });
    }
  }

  // milestones: zero-duration items (start === target) drawn as named diamonds
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
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: itemsContainerWidth, height, overflow: "visible", zIndex: 4 }}
    >
      {bands.map((b, i) => (
        <rect key={`wk-${i}`} x={b.x} y={0} width={b.w} height={height} className="fill-primary" opacity={0.035} />
      ))}
      {ghosts.map((g, i) => (
        <rect
          key={`bl-${i}`}
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
      {fills.map((f, i) => (
        <rect key={`pf-${i}`} x={f.x} y={f.y} width={f.w} height={BAR} rx={3} fill="#0f0f0f" opacity={0.22} />
      ))}
      {typeof todayX === "number" && (
        <line x1={todayX} y1={0} x2={todayX} y2={height} stroke="#ef4444" strokeWidth={1} opacity={0.7} />
      )}
      {arrows.map((a, i) => (
        <g key={`dep-${i}`}>
          <path d={a.path} fill="none" stroke={a.color} strokeWidth={a.width} strokeDasharray={a.dash} opacity={0.85} />
          <path d={`M ${a.hx} ${a.hy} l -5 -3 l 0 6 z`} fill={a.color} />
        </g>
      ))}
      {milestones.map((m, i) => (
        <g key={`ms-${i}`}>
          <path
            d={`M ${m.x} ${m.y - DIAMOND} L ${m.x + DIAMOND} ${m.y} L ${m.x} ${m.y + DIAMOND} L ${m.x - DIAMOND} ${m.y} Z`}
            fill="#f59e0b"
            stroke="#b45309"
            strokeWidth={1}
          />
          {m.name && (
            <text x={m.x + DIAMOND + 4} y={m.y + 3} fontSize={10} className="fill-secondary" style={{ fontWeight: 500 }}>
              {m.name.length > 28 ? m.name.slice(0, 28) + "…" : m.name}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
});
