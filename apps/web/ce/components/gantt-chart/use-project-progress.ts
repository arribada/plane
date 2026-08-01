/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Per-issue completion, fetched once per project and read by every bar.
 *
 * The server computes it (a parent's share of completed children; 0 or 100 for a
 * leaf), so this is a lookup, not a calculation. Cached at module scope for the
 * same reason the relations and the slack are: one bar asking is one round trip,
 * and forty bars asking is still one.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type Entry = { promise: Promise<Record<string, number>>; value: Record<string, number> | null };

const EMPTY: Record<string, number> = {};
const cache = new Map<string, Entry>();
const service = new ArribadaService();

/** Drop the cached answer — sub-item states have changed. */
export const invalidateProjectProgress = (workspaceSlug: string, projectId: string): void => {
  cache.delete(`${workspaceSlug}/${projectId}`);
};

/** 0–100 for one issue; 0 when the project has not answered yet. */
export const useProjectProgress = (issueId: string): number => {
  const { workspaceSlug, projectId } = useParams();
  const key = workspaceSlug && projectId ? `${workspaceSlug}/${projectId}` : null;
  const [byIssue, setByIssue] = useState<Record<string, number>>(() => (key && cache.get(key)?.value) || EMPTY);

  useEffect(() => {
    if (!key || !workspaceSlug || !projectId) return undefined;
    let cancelled = false;

    let entry = cache.get(key);
    if (!entry) {
      entry = {
        value: null,
        // A failure means no fills — a plainer chart, not a broken one. Dropping
        // the entry lets the next mount try again.
        promise: service
          .getProjectProgress(workspaceSlug.toString(), projectId.toString())
          .then((rows) => {
            const map: Record<string, number> = {};
            for (const row of rows || []) map[row.issue_id] = row.percent;
            return map;
          })
          .catch(() => {
            cache.delete(key);
            return EMPTY;
          }),
      };
      cache.set(key, entry);
    }

    const pending = entry;
    void pending.promise.then((resolved) => {
      pending.value = resolved;
      if (!cancelled) setByIssue(resolved);
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [key, workspaceSlug, projectId]);

  return byIssue[issueId] ?? 0;
};
