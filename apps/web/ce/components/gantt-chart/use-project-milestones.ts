/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which of a project's work items are deliverables, in one fetch shared by every
 * bar. Same shape as useProjectRelations and for the same reason: one request per
 * bar would be a request per row, and two components asking independently is two
 * chances to disagree about the same answer.
 *
 * A milestone was inferred from a zero-day duration, which is wrong both ways: a
 * one-day bench test drew as a gate, and "PDR delivered" — a real funder
 * deliverable that spans the two days the review takes — drew as an ordinary bar.
 * The inference is kept as a fallback for projects nobody has marked up yet, so
 * nothing that used to show a diamond stops showing one.
 */
import { useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { bumpProjectRevision, useProjectRevision } from "./derived-revision";

export type TMilestoneKind = "gate" | "delivery" | "review";

export type TProjectMilestones = Record<
  string,
  {
    kind: TMilestoneKind;
    /** What a funder reads — the custom label if there is one, otherwise the work
     *  item's own name. Already resolved by the server. */
    label: string;
    /** The custom label alone, empty when nobody has written one. A form that
     *  edits it must prefill from THIS: prefilling from `label` would turn every
     *  mark into a custom label the first time anybody opened the box. */
    customLabel: string;
  }
>;

type Entry = { promise: Promise<TProjectMilestones>; value: TProjectMilestones | null };

const EMPTY: TProjectMilestones = {};
const cache = new Map<string, Entry>();
const service = new ArribadaService();

/** Drop the cached answer — somebody marked or unmarked an item. */
export const invalidateProjectMilestones = (workspaceSlug: string, projectId: string): void => {
  cache.delete(`${workspaceSlug}/${projectId}`);
  bumpProjectRevision(workspaceSlug, projectId);
};

export const useProjectMilestones = (
  workspaceSlug: string | undefined,
  projectId: string | undefined
): TProjectMilestones => {
  const key = workspaceSlug && projectId ? `${workspaceSlug}/${projectId}` : null;
  const revision = useProjectRevision(workspaceSlug, projectId);
  const [value, setValue] = useState<TProjectMilestones>(() => (key && cache.get(key)?.value) || EMPTY);

  useEffect(() => {
    if (!key || !workspaceSlug || !projectId) return undefined;
    let cancelled = false;

    let entry = cache.get(key);
    if (!entry) {
      entry = {
        value: null,
        // A failure resolves to "nothing marked" rather than rejecting: the chart
        // then falls back to the same-day inference, which is what it did before
        // this existed. A missing endpoint must not empty the timeline.
        promise: service
          .getProjectMilestones(workspaceSlug, projectId)
          .then((rows) => {
            const map: TProjectMilestones = {};
            for (const row of rows)
              map[row.issue_id] = {
                kind: row.kind,
                label: row.label,
                // Absent on an older server, where there was no way to set one
                // anyway — so "" is both the fallback and the truth.
                customLabel: row.custom_label ?? "",
              };
            return map;
          })
          .catch(() => {
            cache.delete(key);
            return EMPTY;
          }),
      };
      cache.set(key, entry);
    }

    entry.promise.then((resolved) => {
      const current = cache.get(key);
      if (current) current.value = resolved;
      if (!cancelled) setValue(resolved);
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [key, workspaceSlug, projectId, revision]);

  return value;
};
