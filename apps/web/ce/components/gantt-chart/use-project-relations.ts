/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One fetch of a project's dependency edges, shared by everything that needs them:
 * the arrows draw from it, and ordering the rows along the graph reads the same
 * edges. Two components asking independently is two identical round trips and two
 * chances for them to disagree about what the graph is.
 */
import { useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { bumpProjectRevision, useProjectRevision } from "./derived-revision";
import type { TIssueRelationEdge } from "@/plane-web/types/arribada";

type Entry = { promise: Promise<TIssueRelationEdge[]>; edges: TIssueRelationEdge[] | null };

// Module scope so a second caller mounting in the same render gets the first one's
// in-flight promise rather than starting its own.
const cache = new Map<string, Entry>();
const service = new ArribadaService();

/** Drop a project's cached edges — call after anything that rewrites them. */
export const invalidateProjectRelations = (workspaceSlug: string, projectId: string): void => {
  cache.delete(`${workspaceSlug}/${projectId}`);
  // Dropping the entry only helps the NEXT mount; this is what reaches the
  // components already on screen.
  bumpProjectRevision(workspaceSlug, projectId);
};

export const useProjectRelations = (
  workspaceSlug: string | undefined,
  projectId: string | undefined
): TIssueRelationEdge[] => {
  const key = workspaceSlug && projectId ? `${workspaceSlug}/${projectId}` : null;
  const revision = useProjectRevision(workspaceSlug, projectId);
  const [edges, setEdges] = useState<TIssueRelationEdge[]>(() => (key && cache.get(key)?.edges) || []);

  useEffect(() => {
    if (!key || !workspaceSlug || !projectId) return undefined;
    let cancelled = false;

    let entry = cache.get(key);
    if (!entry) {
      entry = {
        edges: null,
        // A failure resolves to an empty graph rather than rejecting: no arrows and
        // no reordering is a worse chart, not a broken one, and the next mount will
        // try again because the failed entry is dropped.
        promise: service
          .getProjectRelations(workspaceSlug, projectId)
          .then((rows) => rows || [])
          .catch(() => {
            cache.delete(key);
            return [] as TIssueRelationEdge[];
          }),
      };
      cache.set(key, entry);
    }

    const pending = entry;
    void pending.promise.then((rows) => {
      pending.edges = rows;
      if (!cancelled) setEdges(rows);
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [key, workspaceSlug, projectId, revision]);

  return edges;
};
