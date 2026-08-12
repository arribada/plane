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
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { useProjectRelations } from "@/plane-web/components/gantt-chart/use-project-relations";
import { useProjectSlack } from "@/plane-web/components/gantt-chart/use-project-slack";
import type { TIssueRelationEdge } from "@/plane-web/types/arribada";
import { edgeOf } from "../edges";
import { routeDependency, routeParentBracket } from "./routing";

const PARENT_COLOR = "#94a3b8"; // muted slate — hierarchy links, distinct from the coloured dependency arrows
const CRITICAL_COLOR = "#dc2626";

// How loud the arrows are when nothing is being pointed at. The bars are the
// subject of this chart; the arrows explain them. A dense plan drew ~40 of them at
// near-full strength over the bars, which is how a legible schedule turns into a
// ball of wool.
const RESTING = { opacity: 0.28, width: 1 };
const LOUD = { opacity: 0.95, width: 2 };
const MUTED = { opacity: 0.06, width: 1 };

// Arrow points predecessor -> successor. blocked_by is drawn reversed.
//
// blocked_by used to be red, and it is the relation everything actually uses — the
// planner writes every generated dependency as one — so a normal plan came out as a
// wall of red over its own bars. Red now means one thing only: the critical path,
// where a day lost is a day lost on the whole project.
const COLOR: Record<string, string> = {
  finish_before: "#3f76ff",
  start_before: "#eab308",
  blocked_by: "#64748b",
};

/**
 * `edges.ts` decides which end is the predecessor; this only keeps the shape the
 * drawing code already expects.
 *
 * The local ternary this replaces special-cased `blocked_by` alone, but
 * `finish_after` and `start_after` name the successor first as well — so an arrow
 * for either of those was drawn pointing back up its own chain. An arrow is the
 * one part of the chart a reader trusts to say which way the work flows.
 *
 * Null for a relation this fork does not schedule on (`relates_to`, `duplicate`)
 * and for a self-link; the caller skips those rather than drawing a line between
 * two rows that make no claim about each other.
 */
function edgeEndpoints(rel: TIssueRelationEdge): { from: string; to: string } | null {
  return edgeOf(rel);
}

export const TimelineDependencyPaths = observer(function TimelineDependencyPaths(_props: { isEpic?: boolean }) {
  const { workspaceSlug, projectId } = useParams();
  const store = useTimeLineChartStore();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  // Both shared with the overlay and the row ordering: one fetch of the graph, one
  // fetch of the slack, one answer each — instead of every consumer asking again.
  const edges = useProjectRelations(workspaceSlug?.toString(), projectId?.toString());
  const { critical } = useProjectSlack(workspaceSlug?.toString(), projectId?.toString());

  // Only the per-project issue gantt draws arrows; the portfolio has no projectId.
  if (!projectId || !store.currentViewData) return null;
  const blockIds = store.blockIds ?? [];
  if (!blockIds.length) return null;

  const indexById = new Map<string, number>(blockIds.map((id, i): [string, number] => [id, i]));
  const active = store.activeBlockId;
  const { dimDependencies } = store;

  // parent -> child hierarchy connectors (both must be visible + dated to have bars)
  const parentPaths = blockIds
    .map((childId, ci) => {
      const parentId = getIssueById(childId)?.parent_id;
      if (!parentId) return null;
      const pi = indexById.get(parentId);
      if (pi === undefined) return null;
      const child = store.getBlockById(childId);
      const parent = store.getBlockById(parentId);
      if (!child?.position || !parent?.position) return null;
      const x1 = parent.position.marginLeft;
      const y1 = pi * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
      const x2 = child.position.marginLeft;
      const y2 = ci * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
      return {
        key: `pc-${parentId}-${childId}`,
        d: routeParentBracket(x1, y1, x2, y2),
        cx: x2,
        cy: y2,
        from: parentId,
        to: childId,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const paths = edges
    .map((rel) => {
      const endpoints = edgeEndpoints(rel);
      if (!endpoints) return null;
      const { from, to } = endpoints;
      const src = store.getBlockById(from);
      const tgt = store.getBlockById(to);
      const si = indexById.get(from);
      const ti = indexById.get(to);
      if (!src?.position || !tgt?.position || si === undefined || ti === undefined) return null;
      // Which edge to leave from, where to drop, and how to come back round when
      // the two bars overlap, all live in routeDependency — see the note there
      // about the one-day gap.
      const arrow = routeDependency(
        {
          left: src.position.marginLeft,
          right: src.position.marginLeft + src.position.width,
          y: si * BLOCK_HEIGHT + BLOCK_HEIGHT / 2,
        },
        {
          left: tgt.position.marginLeft,
          right: tgt.position.marginLeft + tgt.position.width,
          y: ti * BLOCK_HEIGHT + BLOCK_HEIGHT / 2,
        },
        BLOCK_HEIGHT
      );
      return {
        key: `${from}-${to}-${rel.relation_type}`,
        d: arrow.d,
        color: COLOR[rel.relation_type] ?? "#94a3b8",
        from,
        to,
        isCritical: critical.has(from) && critical.has(to),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (!paths.length && !parentPaths.length) return null;

  return (
    <svg
      className="absolute top-0 left-0"
      style={{
        width: "100%",
        height: blockIds.length * BLOCK_HEIGHT,
        overflow: "visible",
        zIndex: 6,
        pointerEvents: "none",
      }}
    >
      <defs>
        {/* One marker per colour actually drawn, critical included — an arrowhead
            left in the relation's colour on a red line reads as a different arrow. */}
        {Object.entries({ ...COLOR, critical: CRITICAL_COLOR }).map(([t, c]) => (
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
      {/* parent -> child hierarchy: muted dashed bracket + a small ring on the child */}
      {parentPaths.map((p) => {
        const related = active && (p.from === active || p.to === active);
        const tone = related ? LOUD : active ? MUTED : RESTING;
        return (
          <g key={p.key} opacity={dimDependencies ? tone.opacity : Math.max(tone.opacity, related ? 0.9 : 0.6)}>
            <path d={p.d} fill="none" stroke={PARENT_COLOR} strokeWidth={tone.width} strokeDasharray="2 2" />
            <circle cx={p.cx} cy={p.cy} r={2.5} fill="none" stroke={PARENT_COLOR} strokeWidth={1} />
          </g>
        );
      })}
      {paths.map((p) => {
        const related = active && (p.from === active || p.to === active);
        // Three states, not two. An arrow touching the block under the cursor is
        // the answer to "what does this wait on"; everything else is context that
        // should get out of its way; and with nothing pointed at, all of it sits
        // back far enough to read the bars through.
        const tone = related ? LOUD : active ? MUTED : RESTING;
        const stroke = p.isCritical ? CRITICAL_COLOR : p.color;
        const markerType = p.isCritical
          ? "critical"
          : (Object.keys(COLOR).find((t) => COLOR[t] === p.color) ?? "finish_before");
        return (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={stroke}
            // The critical chain stays one step louder in every state: it is the
            // one set of links where slipping a day slips the delivery date.
            strokeWidth={p.isCritical ? tone.width + 0.75 : tone.width}
            markerEnd={`url(#arw-${markerType})`}
            opacity={dimDependencies ? tone.opacity : Math.max(tone.opacity, related ? 0.95 : 0.75)}
            style={{ pointerEvents: "stroke", transition: "opacity .12s, stroke-width .12s" }}
            onMouseEnter={() => store.updateActiveBlockId(p.from)}
            onMouseLeave={() => store.updateActiveBlockId(null)}
          />
        );
      })}
    </svg>
  );
});
