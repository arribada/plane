/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Fills the CE dependency stub: draws FS/SS/blocked dependency arrows on the gantt.
 * Reads bar positions from the timeline store and the relations from the fork's
 * bulk /api/arribada/ endpoint, so it needs no core changes and no N-per-issue fetch.
 * Only active in the per-project issue gantt (where a projectId route param exists).
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TIssueRelationEdge } from "@/plane-web/types/arribada";

const R = 6; // corner radius
const HEAD = 6; // arrowhead half-size

// Arrow points predecessor -> successor. blocked_by is drawn reversed.
const COLOR: Record<string, string> = {
  finish_before: "#3f76ff",
  start_before: "#eab308",
  blocked_by: "#dc2626",
};

function edgeEndpoints(rel: TIssueRelationEdge): { from: string; to: string } {
  if (rel.relation_type === "blocked_by") {
    return { from: rel.related_issue_id, to: rel.issue_id };
  }
  return { from: rel.issue_id, to: rel.related_issue_id };
}

// Orthogonal elbow with rounded corners, right edge of source -> left edge of target.
function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const down = y2 >= y1 ? 1 : -1;
  if (x2 >= x1 + 24) {
    const midX = Math.max(x1 + 12, x2 - 20);
    return `M ${x1} ${y1} H ${midX - R} a ${R} ${R} 0 0 ${down > 0 ? 1 : 0} ${R} ${down * R} V ${
      y2 - down * R
    } a ${R} ${R} 0 0 ${down > 0 ? 0 : 1} ${R} ${down * R} H ${x2}`;
  }
  // target is left of / near the source: loop under the source bar
  const backY = y1 + down * (BLOCK_HEIGHT / 2);
  return `M ${x1} ${y1} h 12 V ${backY} H ${x2 - 12} V ${y2} H ${x2}`;
}

export const TimelineDependencyPaths = observer(function TimelineDependencyPaths(_props: { isEpic?: boolean }) {
  const { workspaceSlug, projectId } = useParams();
  const store = useTimeLineChartStore();
  const service = useMemo(() => new ArribadaService(), []);
  const [edges, setEdges] = useState<TIssueRelationEdge[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug && projectId) {
      service
        .getProjectRelations(workspaceSlug.toString(), projectId.toString())
        .then((rows) => {
          if (!cancelled) setEdges(rows || []);
        })
        .catch(() => {
          if (!cancelled) setEdges([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service]);

  // Only the per-project issue gantt draws arrows; the portfolio has no projectId.
  if (!projectId || !store.currentViewData) return null;
  const blockIds = store.blockIds ?? [];
  if (!blockIds.length || !edges.length) return null;

  const indexById = new Map<string, number>(blockIds.map((id, i): [string, number] => [id, i]));
  const active = store.activeBlockId;

  const paths = edges
    .map((rel) => {
      const { from, to } = edgeEndpoints(rel);
      const src = store.getBlockById(from);
      const tgt = store.getBlockById(to);
      const si = indexById.get(from);
      const ti = indexById.get(to);
      if (!src?.position || !tgt?.position || si === undefined || ti === undefined) return null;
      const x1 = src.position.marginLeft + src.position.width;
      const y1 = si * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
      const x2 = tgt.position.marginLeft;
      const y2 = ti * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
      return {
        key: `${from}-${to}-${rel.relation_type}`,
        d: elbowPath(x1, y1, x2 - HEAD, y2),
        color: COLOR[rel.relation_type] ?? "#94a3b8",
        from,
        to,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (!paths.length) return null;

  return (
    <svg
      className="absolute left-0 top-0"
      style={{
        width: "100%",
        height: blockIds.length * BLOCK_HEIGHT,
        overflow: "visible",
        zIndex: 6,
        pointerEvents: "none",
      }}
    >
      <defs>
        {Object.entries(COLOR).map(([t, c]) => (
          <marker
            key={t}
            id={`arw-${t}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={c} />
          </marker>
        ))}
      </defs>
      {paths.map((p) => {
        const related = active && (p.from === active || p.to === active);
        const dimmed = active && !related;
        const markerType = Object.keys(COLOR).find((t) => COLOR[t] === p.color) ?? "finish_before";
        return (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={related ? 2 : 1.5}
            markerEnd={`url(#arw-${markerType})`}
            opacity={dimmed ? 0.15 : 0.9}
            style={{ pointerEvents: "stroke", transition: "opacity .12s" }}
            onMouseEnter={() => store.updateActiveBlockId(p.from)}
            onMouseLeave={() => store.updateActiveBlockId(null)}
          />
        );
      })}
    </svg>
  );
});
