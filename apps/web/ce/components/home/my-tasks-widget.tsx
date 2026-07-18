/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Home "My tasks" widget: the requesting user's open assigned work items,
 * grouped Overdue / This week / Later. Serves both project managers (a glance at
 * their own load) and engineers (their day) — the highest-ROI home surface.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { useUser } from "@/hooks/store/user";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TMyWorkItem } from "@/plane-web/types/arribada";

const PRIORITY_DOT: Record<TMyWorkItem["priority"], string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
  none: "bg-neutral-300",
};

// Local-midnight day index, so date-only comparisons ignore the wall clock.
const dayOf = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);

type Bucket = { key: string; label: string; icon: typeof AlertTriangle; tone: string; items: TMyWorkItem[] };

export const MyTasksWidget = observer(function MyTasksWidget() {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const { data: currentUser } = useUser();
  const service = useMemo(() => new ArribadaService(), []);
  const [items, setItems] = useState<TMyWorkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceSlug) return;
    setLoading(true);
    service
      .getMyWork(workspaceSlug.toString())
      .then((r) => {
        if (!cancelled) setItems(r || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, service]);

  const buckets = useMemo<Bucket[]>(() => {
    const today = dayOf(new Date());
    const overdue: TMyWorkItem[] = [];
    const week: TMyWorkItem[] = [];
    const later: TMyWorkItem[] = [];
    const undated: TMyWorkItem[] = [];
    for (const it of items) {
      if (!it.target_date) {
        undated.push(it);
        continue;
      }
      const d = dayOf(new Date(it.target_date));
      if (d < today) overdue.push(it);
      else if (d <= today + 7) week.push(it);
      else later.push(it);
    }
    return [
      { key: "overdue", label: "Overdue", icon: AlertTriangle, tone: "text-red-600", items: overdue },
      { key: "week", label: "This week", icon: CalendarClock, tone: "text-amber-600", items: week },
      { key: "later", label: "Later", icon: CalendarDays, tone: "text-secondary", items: later },
      { key: "undated", label: "No date", icon: CalendarDays, tone: "text-secondary", items: undated },
    ].filter((b) => b.items.length > 0);
  }, [items]);

  const total = items.length;

  const openItem = (it: TMyWorkItem) =>
    router.push(`/${workspaceSlug}/browse/${it.project_identifier}-${it.sequence_id}/`);

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl border border-subtle bg-surface p-4">
        <div className="mb-3 h-4 w-28 rounded bg-neutral-200/60" />
        <div className="space-y-2">
          <div className="h-8 rounded bg-neutral-200/40" />
          <div className="h-8 rounded bg-neutral-200/40" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-subtle bg-surface">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-primary">My tasks</h3>
          <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-xs font-medium text-secondary">{total}</span>
        </div>
        {total > 0 && currentUser?.id && (
          <button
            type="button"
            onClick={() => router.push(`/${workspaceSlug}/profile/${currentUser.id}/assigned`)}
            className="flex items-center gap-0.5 text-xs font-medium text-secondary hover:text-primary"
          >
            View all
            <ChevronRight className="size-3.5" />
          </button>
        )}
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-4 pb-6 pt-2 text-center">
          <CheckCircle2 className="size-6 text-green-500" />
          <p className="text-sm text-secondary">Nothing assigned to you. Enjoy the calm.</p>
        </div>
      ) : (
        <div className="divide-y divide-subtle">
          {buckets.map((b) => {
            const Icon = b.icon;
            return (
              <div key={b.key} className="px-4 py-2">
                <div className={cn("mb-1 flex items-center gap-1.5 text-xs font-semibold", b.tone)}>
                  <Icon className="size-3.5" />
                  {b.label}
                  <span className="text-secondary/70">· {b.items.length}</span>
                </div>
                <ul>
                  {b.items.slice(0, 6).map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => openItem(it)}
                        className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-neutral-500/5"
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[it.priority])} />
                        <span className="truncate text-sm text-primary group-hover:text-primary">{it.name}</span>
                        <span className="ml-auto shrink-0 text-[11px] uppercase tracking-wide text-secondary/70">
                          {it.project_identifier}-{it.sequence_id}
                        </span>
                      </button>
                    </li>
                  ))}
                  {b.items.length > 6 && (
                    <li className="px-1.5 pt-0.5 text-[11px] text-secondary/70">+{b.items.length - 6} more</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
