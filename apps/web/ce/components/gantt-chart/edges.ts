/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which way a dependency points, and what kind of constraint it is.
 *
 * This is the client half of `_EDGE` in `plane/arribada/scheduling.py`, and it is
 * a table for the same reason that one is: Plane stores a relation as a pair of
 * ids plus a type, and THREE of the five types name the successor first. Written
 * out as a two-way ternary — "blocked_by means related→issue, everything else
 * means issue→related" — `finish_after` and `start_after` come out backwards,
 * which is an arrow drawn against the flow of the work and a cascade that pushes
 * the wrong end of the chain.
 *
 * FS (finish-to-start) — the successor starts after the predecessor FINISHES.
 * SS (start-to-start)  — the successor starts no earlier than the predecessor STARTS.
 * The difference matters to anything that moves dates: an FS successor follows the
 * predecessor's finish, an SS successor follows its start, and a resize moves only
 * one of those two.
 */
import type { TIssueRelationEdge } from "@/plane-web/types/arribada";

export type TEdgeKind = "FS" | "SS";

/** predecessor -> successor, with the kind of constraint the link imposes. */
export type TGraphEdge = { from: string; to: string; kind: TEdgeKind };

/** `[predecessor-is-, kind]` where `predecessor-is-` names which id of the pair
 *  is the predecessor. Mirrors the backend table exactly; keep them in step. */
const EDGE_TABLE: Record<string, { predecessor: "issue" | "related"; kind: TEdgeKind }> = {
  finish_before: { predecessor: "issue", kind: "FS" },
  finish_after: { predecessor: "related", kind: "FS" },
  blocked_by: { predecessor: "related", kind: "FS" },
  start_before: { predecessor: "issue", kind: "SS" },
  start_after: { predecessor: "related", kind: "SS" },
};

/**
 * One relation as a predecessor→successor edge, or null if it is not one.
 *
 * A relation type this fork does not schedule on — `relates_to`, `duplicate` —
 * is null rather than guessed at: it is a note between two items, not a
 * statement about when either happens, and treating it as one would move dates
 * nobody sequenced. Self-links are null for the obvious reason.
 *
 * Exported so that the places which need the ORIGINAL relation alongside its
 * direction — the arrow colours in `dependency-paths.tsx`, which key off
 * `relation_type` — can ask this table rather than keeping a private ternary.
 * Four such ternaries existed, and all four had the same fault.
 */
export const edgeOf = (relation: TIssueRelationEdge): TGraphEdge | null => {
  const spec = EDGE_TABLE[relation.relation_type];
  if (!spec) return null;
  const from = spec.predecessor === "issue" ? relation.issue_id : relation.related_issue_id;
  const to = spec.predecessor === "issue" ? relation.related_issue_id : relation.issue_id;
  if (!from || !to || from === to) return null;
  return { from, to, kind: spec.kind };
};

/** Normalise raw relations into predecessor→successor edges. */
export const graphEdges = (relations: readonly TIssueRelationEdge[]): TGraphEdge[] => {
  const out: TGraphEdge[] = [];
  for (const relation of relations) {
    const edge = edgeOf(relation);
    if (edge) out.push(edge);
  }
  return out;
};
