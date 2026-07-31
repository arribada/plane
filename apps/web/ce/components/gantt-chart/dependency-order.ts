/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Order the rows along the dependency graph: everything a task waits on sits above
 * it. On a plan the schedule produced, ordering by start date gets close — a
 * successor cannot start before its predecessor finishes. It stops being the same
 * answer the moment two tasks share a start date, or somebody drags a bar, or a
 * chain has slack in it; and it never says which of two same-day tasks feeds the
 * other. This does.
 */
import type { TIssueRelationEdge } from "@/plane-web/types/arribada";

/** predecessor -> successor, matching the direction the arrows are drawn. */
const edgeEndpoints = (rel: TIssueRelationEdge): { from: string; to: string } =>
  rel.relation_type === "blocked_by"
    ? { from: rel.related_issue_id, to: rel.issue_id }
    : { from: rel.issue_id, to: rel.related_issue_id };

/**
 * Kahn's algorithm, with the incoming order as the tie-break.
 *
 * Two guarantees matter more than the sort itself. A cycle cannot drop rows: the
 * ids left over when no node has an in-degree of zero are appended in their
 * original order, so a project that has managed to make A wait on B and B wait on A
 * still draws every bar. And an id that appears in no edge keeps its place relative
 * to its neighbours rather than being swept to one end.
 */
export const orderByDependency = (ids: string[], edges: TIssueRelationEdge[]): string[] => {
  const present = new Set(ids);
  const position = new Map(ids.map((id, index) => [id, index] as const));

  const successors = new Map<string, string[]>();
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0] as const));

  for (const edge of edges) {
    const { from, to } = edgeEndpoints(edge);
    // Edges to rows that are filtered out or on another page are not constraints
    // on what is drawn, and counting them would leave those rows stuck at zero.
    if (!present.has(from) || !present.has(to) || from === to) continue;
    const list = successors.get(from);
    if (list) {
      if (list.includes(to)) continue; // the same pair can arrive twice
      list.push(to);
    } else {
      successors.set(from, [to]);
    }
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  // Ready set kept sorted by original position, so among tasks that could all run
  // next the chart keeps the order the display filter asked for.
  const ready = ids.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  const placed = new Set<string>();

  while (ready.length > 0) {
    // oxlint-disable-next-line unicorn/no-array-sort -- `ready` is ours alone
    ready.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    const next = ready.shift() as string;
    ordered.push(next);
    placed.add(next);
    for (const successor of successors.get(next) ?? []) {
      const remaining = (inDegree.get(successor) ?? 0) - 1;
      inDegree.set(successor, remaining);
      if (remaining === 0) ready.push(successor);
    }
  }

  // Whatever a cycle swallowed, in the order it arrived. Losing rows would be far
  // worse than showing them in an order the graph cannot justify.
  for (const id of ids) if (!placed.has(id)) ordered.push(id);

  return ordered;
};
