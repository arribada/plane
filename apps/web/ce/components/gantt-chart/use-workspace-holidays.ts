/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The days nobody works, for drawing.
 *
 * Two sources arrive together and are deliberately kept apart in the payload: the
 * organisation's own closures (a lab shutdown, the week between Christmas and New
 * Year) which are decisions and apply to everyone, and the statutory holidays of
 * a country, which are law and differ between the two this team works from.
 *
 * The chart needs them because the planner already respects them. Without this
 * the assistant steps over a shutdown and the chart then draws that plan on a
 * calendar pretending the shutdown does not exist — two halves of the product
 * disagreeing about what a working day is, which is worse than neither knowing.
 *
 * One fetch per workspace, shared by every chart, same module-cache shape as the
 * timeline's other derived reads.
 */
import { useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";

/** ISO date -> the name to show on hover. */
export type TNonWorkingDays = Record<string, string>;

const EMPTY: TNonWorkingDays = {};
const cache = new Map<string, { promise: Promise<TNonWorkingDays>; value: TNonWorkingDays | null }>();
const service = new ArribadaService();

export const useWorkspaceHolidays = (workspaceSlug: string | undefined): TNonWorkingDays => {
  const [value, setValue] = useState<TNonWorkingDays>(
    () => (workspaceSlug && cache.get(workspaceSlug)?.value) || EMPTY
  );

  useEffect(() => {
    if (!workspaceSlug) return undefined;
    let cancelled = false;

    let entry = cache.get(workspaceSlug);
    if (!entry) {
      entry = {
        value: null,
        // A failure resolves to "no holidays known" rather than rejecting. Losing
        // the shading is a poorer chart; losing the chart is a broken page.
        promise: service
          .getCalendar(workspaceSlug)
          .then((payload) => {
            const days: TNonWorkingDays = {};
            for (const row of payload?.statutory ?? []) days[row.date] = row.name;
            // The workspace's own closures last, so a hand-entered name wins over
            // a statutory one on the same date — somebody typed it for a reason.
            for (const row of payload?.days ?? []) days[row.date] = row.name;
            return days;
          })
          .catch(() => {
            cache.delete(workspaceSlug);
            return EMPTY;
          }),
      };
      cache.set(workspaceSlug, entry);
    }

    entry.promise.then((resolved) => {
      const current = cache.get(workspaceSlug);
      if (current) current.value = resolved;
      if (!cancelled) setValue(resolved);
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  return value;
};
