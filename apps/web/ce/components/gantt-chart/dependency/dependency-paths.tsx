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
import { useGanttColorScale } from "../color-scale";
import { isDarkSurface } from "../palette";
import { criticalColor, linkEmphasis } from "../critical-path";
import { ganttDisplay } from "@/plane-web/store/gantt-display";
import { edgeOf } from "../edges";
import { routeDependency, routeParentBracket } from "./routing";

const PARENT_COLOR = "#94a3b8"; // muted slate — hierarchy links, distinct from the coloured dependency arrows

// How loud the arrows are when nothing is being pointed at. The bars are the
// subject of this chart; the arrows explain them. A dense plan drew ~40 of them at
// near-full strength over the bars, which is how a legible schedule turns into a
// ball of wool.
const RESTING = { opacity: 0.3, width: 1 };
const LOUD = { opacity: 0.95, width: 1.75 };
const MUTED = { opacity: 0.07, width: 1 };

const TONE = { loud: LOUD, resting: RESTING, quiet: MUTED } as const;

/**
 * How much thicker the critical chain is drawn than an ordinary link.
 *
 * It was +0.75 on top of a LOUD width of 2, i.e. a 2.75px line — and because the
 * arrowhead was a marker in the default `markerUnits="strokeWidth"`, its 6-unit
 * box was multiplied by that stroke into a **16.5px** head. On a chart whose bars
 * are 18px tall, the arrow between two of them was bigger than either. The head
 * is in user space now and this bump is half what it was: the chain is one step
 * louder than its neighbours, not louder than the plan.
 */
const CRITICAL_BUMP = 0.5;

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
  const colors = useGanttColorScale();

  // Only the per-project issue gantt draws arrows; the portfolio has no projectId.
  if (!projectId || !store.currentViewData) return null;
  const blockIds = store.blockIds ?? [];
  if (!blockIds.length) return null;

  const indexById = new Map<string, number>(blockIds.map((id, i): [string, number] => [id, i]));
  const active = store.activeBlockId;
  const { dimDependencies } = store;
  const dark = colors?.dark ?? isDarkSurface();
  const CRITICAL_COLOR = criticalColor(dark);
  // While the chain is the chart's subject, the links ALONG it are the picture —
  // they are what turns twenty ringed bars into one path. Everything else steps
  // back with the bars it connects.
  const focusChain = ganttDisplay.focusCriticalPath && critical.size > 0;

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
        // 7, not 6: the veil that de-emphasises off-chain bars sits at 6, and the
        // chain's own arrows are the thing it exists to reveal.
        zIndex: 7,
        pointerEvents: "none",
      }}
    >
      <defs>
        {/* One marker per colour actually drawn, critical included — an arrowhead
            left in the relation's colour on a red line reads as a different arrow.

            `markerUnits="userSpaceOnUse"` is the fix for the loudest thing on the
            chart. The default is `strokeWidth`, which MULTIPLIES the marker box by
            the line's width: at the 2.75px a hovered critical link used to draw
            at, a 6-unit head became 16.5px — nearly the height of a bar. The head
            is now 7×6px whatever the line does, and `refX` puts its TIP on the
            path's last point, which the router now guarantees is the bar's edge. */}
        {Object.entries({ ...COLOR, critical: CRITICAL_COLOR }).map(([t, c]) => (
          <marker
            key={t}
            id={`arw-${t}`}
            viewBox="0 0 7 6"
            refX="7"
            refY="3"
            markerWidth="7"
            markerHeight="6"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L7,3 L0,6 z" fill={c} />
          </marker>
        ))}
      </defs>
      {/* parent -> child hierarchy: muted dashed bracket + a small ring on the child */}
      {parentPaths.map((p) => {
        const related = !!active && (p.from === active || p.to === active);
        // A hierarchy bracket is never "on the chain" — it is not a temporal
        // link — so while the chain is focused it is context, always.
        const tone = TONE[linkEmphasis({ related, pointing: !!active, onChain: false, focused: focusChain })];
        return (
          <g key={p.key} opacity={dimDependencies ? tone.opacity : Math.max(tone.opacity, related ? 0.9 : 0.6)}>
            <path d={p.d} fill="none" stroke={PARENT_COLOR} strokeWidth={tone.width} strokeDasharray="2 2" />
            <circle cx={p.cx} cy={p.cy} r={2.5} fill="none" stroke={PARENT_COLOR} strokeWidth={1} />
          </g>
        );
      })}
      {paths.map((p) => {
        const related = !!active && (p.from === active || p.to === active);
        // Four inputs, one decision, and it lives in `critical-path.ts` so it can
        // be pinned by a test. An arrow touching the block under the cursor is the
        // answer to "what does this wait on" and beats everything; while the chain
        // is focused, a link along it is the subject and the rest is context; and
        // with nothing pointed at and nothing focused, all of it sits back far
        // enough to read the bars through.
        const tone = TONE[linkEmphasis({ related, pointing: !!active, onChain: p.isCritical, focused: focusChain })];
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
            strokeWidth={p.isCritical ? tone.width + CRITICAL_BUMP : tone.width}
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
