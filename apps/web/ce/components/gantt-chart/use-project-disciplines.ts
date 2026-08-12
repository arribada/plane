/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which discipline each of a project's work items needs, in one fetch shared by
 * every bar. Same shape as useProjectMilestones and useProjectRelations, and for
 * the same reason: the per-issue role endpoint is one request per row, which on
 * a forty-row plan is forty requests to decide a colour.
 *
 * It reads the portfolio's items endpoint, which already carries `disciplines`
 * alongside the sprint and module — so this needs no new server route. The
 * server enforces one discipline per item, so the array it sends has at most one
 * entry; taking the first is not a tie-break, it is the value.
 *
 * A failure resolves to "nobody has said", which draws every bar in the neutral
 * and names it "No discipline" in the legend. That is the same picture a project
 * nobody has filled in gives, and it is the right one: a colour dimension is not
 * worth emptying a timeline over.
 */
import { useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { bumpProjectRevision, useProjectRevision } from "./derived-revision";

export type TProjectDisciplines = Record<string, string>;

type Entry = { promise: Promise<TProjectDisciplines>; value: TProjectDisciplines | null };

const EMPTY: TProjectDisciplines = {};
const cache = new Map<string, Entry>();
const service = new ArribadaService();

export const invalidateProjectDisciplines = (workspaceSlug: string, projectId: string): void => {
  cache.delete(`${workspaceSlug}/${projectId}`);
  // Dropping the entry only helps the NEXT mount; this is what reaches the chart
  // already on screen. Same pairing as every sibling cache in this folder —
  // without it, setting a discipline left the bars painted by the old one until a
  // reload, which is the defect `derived-revision.ts` was written for.
  bumpProjectRevision(workspaceSlug, projectId);
};

export const useProjectDisciplines = (
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  /** Only fetched when the chart is actually coloured by discipline — this is a
   *  whole project's items, and nothing else on the timeline needs them. */
  enabled = true
): TProjectDisciplines => {
  const key = enabled && workspaceSlug && projectId ? `${workspaceSlug}/${projectId}` : null;
  const revision = useProjectRevision(workspaceSlug, projectId);
  const [value, setValue] = useState<TProjectDisciplines>(() => (key && cache.get(key)?.value) || EMPTY);

  useEffect(() => {
    if (!key || !workspaceSlug || !projectId) return undefined;
    let cancelled = false;

    let entry = cache.get(key);
    if (!entry) {
      entry = {
        value: null,
        promise: service
          .getProjectItems(workspaceSlug, projectId)
          .then((items) => {
            const map: TProjectDisciplines = {};
            for (const item of items) {
              const first = (item as { disciplines?: string[] }).disciplines?.[0];
              if (first) map[item.id] = first;
            }
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
