/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Per-person workload: how much active work each member carries, what's overdue,
 * and what's due this week. Reveals over-allocation across a small team on many
 * projects at a glance.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type Row = {
  user_id: string;
  name: string;
  email: string;
  avatar: string | null;
  assigned: number;
  overdue: number;
  due_week: number;
  points: number;
};

export const WorkloadRoot = observer(function WorkloadRoot() {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const service = useMemo(() => new ArribadaService(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug) {
      setLoading(true);
      service
        .getWorkload(workspaceSlug.toString())
        .then((r) => {
          if (!cancelled) setRows(r || []);
          return undefined;
        })
        .catch(() => {
          if (!cancelled) setRows([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, service]);

  const maxAssigned = Math.max(1, ...rows.map((r) => r.assigned));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-secondary">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-primary">Workload</h2>
        <span className="text-13 text-secondary">Active work per person</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-subtle">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-subtle bg-layer-1 px-4 py-2 text-11 font-medium tracking-wide text-secondary uppercase">
          <span>Person</span>
          <span className="text-right">Overdue</span>
          <span className="text-right">Due 7d</span>
          <span className="text-right">Points</span>
        </div>
        {rows.length === 0 && <div className="px-4 py-6 text-center text-13 text-secondary">No members found.</div>}
        {rows.map((r) => (
          <button
            key={r.user_id}
            type="button"
            onClick={() => router.push(`/${workspaceSlug}/profile/${r.user_id}/assigned`)}
            title={`Open ${r.name}'s assigned work items`}
            className="grid w-full cursor-pointer grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-subtle px-4 py-2.5 text-left last:border-b-0 hover:bg-layer-transparent-hover"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-13 font-medium text-primary">{r.name}</span>
                <span className="flex-shrink-0 text-11 text-placeholder">{r.assigned} active</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-layer-2">
                <div
                  className={cn("h-full rounded-full", r.overdue > 0 ? "bg-danger-primary" : "bg-accent-primary")}
                  style={{ width: `${(r.assigned / maxAssigned) * 100}%` }}
                />
              </div>
            </div>
            <span className="text-right">
              {r.overdue > 0 ? (
                <span className="inline-flex items-center gap-1 rounded bg-danger-subtle px-1.5 py-0.5 text-12 text-danger-primary">
                  <AlertTriangle className="size-3" />
                  {r.overdue}
                </span>
              ) : (
                <span className="text-12 text-placeholder">0</span>
              )}
            </span>
            <span className="text-right">
              {r.due_week > 0 ? (
                <span className="inline-flex items-center gap-1 rounded bg-warning-subtle px-1.5 py-0.5 text-12 text-warning-primary">
                  <CalendarClock className="size-3" />
                  {r.due_week}
                </span>
              ) : (
                <span className="text-12 text-placeholder">0</span>
              )}
            </span>
            <span className="text-right text-13 text-secondary tabular-nums">{r.points || "—"}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
