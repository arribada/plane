/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One fetch of a project's slack, shared by the arrows (which use the critical
 * flag) and the overlay (which draws the tail). Same shape as useProjectRelations
 * and for the same reason: two components asking independently is two identical
 * round trips and two chances to disagree about the same graph.
 */
import { useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";

export type TIssueSlack = { free: number; total: number; critical: boolean };

export type TProjectSlack = {
  /**
   * The critical chain, derived from zero total float rather than from the
   * endpoint's `issue_ids`.
   *
   * The two disagree, and the float is right. `issue_ids` comes from a
   * longest-path walk that sums durations; on a real project the dates are
   * whatever people set, so the longest chain can contain a task with a gap
   * after it — which has room to move and is therefore not critical. On a live
   * 37-task project the longest path claimed 20 critical tasks where only 7 have
   * no slack at all.
   *
   * Reading both would put two answers on the same screen: arrows painting 20
   * bars red while the tails show room on 13 of them.
   */
  critical: Set<string>;
  byIssue: Record<string, TIssueSlack>;
};

type Entry = { promise: Promise<TProjectSlack>; value: TProjectSlack | null };

const EMPTY: TProjectSlack = { critical: new Set(), byIssue: {} };
const cache = new Map<string, Entry>();
const service = new ArribadaService();

/** Drop the cached answer — the dates it was derived from have changed. */
export const invalidateProjectSlack = (workspaceSlug: string, projectId: string): void => {
  cache.delete(`${workspaceSlug}/${projectId}`);
};

export const useProjectSlack = (workspaceSlug: string | undefined, projectId: string | undefined): TProjectSlack => {
  const key = workspaceSlug && projectId ? `${workspaceSlug}/${projectId}` : null;
  const [value, setValue] = useState<TProjectSlack>(() => (key && cache.get(key)?.value) || EMPTY);

  useEffect(() => {
    if (!key || !workspaceSlug || !projectId) return undefined;
    let cancelled = false;

    let entry = cache.get(key);
    if (!entry) {
      entry = {
        value: null,
        // A failure resolves to "no slack known" rather than rejecting: no tails
        // and no highlighting is a poorer chart, not a broken one, and dropping
        // the entry means the next mount tries again.
        promise: service
          .getCriticalPath(workspaceSlug, projectId)
          .then((res) => {
            const byIssue = (res?.slack ?? {}) as Record<string, TIssueSlack>;
            const fromSlack = Object.entries(byIssue)
              .filter(([, v]) => v.critical)
              .map(([id]) => id);
            return {
              // Fall back to the longest-path answer only when the server is old
              // enough not to send slack at all.
              critical: new Set(fromSlack.length > 0 ? fromSlack : (res?.issue_ids ?? [])),
              byIssue,
            };
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
      if (!cancelled) setValue(resolved);
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [key, workspaceSlug, projectId]);

  return value;
};
