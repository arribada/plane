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
import { observer } from "mobx-react";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

type Props = {
  itemsContainerWidth: number;
  blockCount: number;
};

const DIAMOND = 7; // half-diagonal of a milestone marker

export const GanttAdditionalLayers: FC<Props> = observer(function GanttAdditionalLayers(props) {
  const { itemsContainerWidth, blockCount } = props;
  const store = useTimeLineChartStore();
  const view = store.currentViewData;
  if (!view) return null;

  const height = Math.max(blockCount, 1) * BLOCK_HEIGHT;
  const blockIds = store.blockIds ?? [];

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

  // milestones: zero-duration items (start === target) drawn as diamonds
  const milestones: { x: number; y: number }[] = [];
  for (let i = 0; i < blockIds.length; i++) {
    const block = store.getBlockById(blockIds[i]);
    if (!block?.position || !block.start_date || !block.target_date) continue;
    if (block.start_date !== block.target_date) continue;
    milestones.push({ x: block.position.marginLeft, y: i * BLOCK_HEIGHT + BLOCK_HEIGHT / 2 });
  }

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: itemsContainerWidth, height, overflow: "visible", zIndex: 4 }}
    >
      {bands.map((b, i) => (
        <rect key={`wk-${i}`} x={b.x} y={0} width={b.w} height={height} className="fill-primary" opacity={0.035} />
      ))}
      {typeof todayX === "number" && (
        <line x1={todayX} y1={0} x2={todayX} y2={height} stroke="#ef4444" strokeWidth={1} opacity={0.7} />
      )}
      {milestones.map((m, i) => (
        <path
          key={`ms-${i}`}
          d={`M ${m.x} ${m.y - DIAMOND} L ${m.x + DIAMOND} ${m.y} L ${m.x} ${m.y + DIAMOND} L ${m.x - DIAMOND} ${m.y} Z`}
          fill="#f59e0b"
          stroke="#b45309"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
});
