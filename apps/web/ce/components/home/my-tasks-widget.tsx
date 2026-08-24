/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Home "My tasks" widget: the requesting user's open assigned work items,
 * grouped Overdue / This week / Later. Serves both project managers (a glance at
 * their own load) and engineers (their day) — the highest-ROI home surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn, renderFormattedDateWithoutYear } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
// ARRIBADA: open the work item in the Home peek overview instead of navigating away.
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user";
// ARRIBADA: the full create modal, opened by the "+" so a task can be added on any project
// straight from Home.
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
import { IssueService } from "@/services/issue/issue.service";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TMyWorkItem } from "@/plane-web/types/arribada";
import { MyTasksCalendar } from "./my-tasks-calendar";

const PRIORITY_DOT: Record<TMyWorkItem["priority"], string> = {
  urgent: "bg-danger-primary",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
  none: "bg-neutral-300",
};

// Local YYYY-MM-DD for a Date (avoids the UTC shift toISOString would introduce).
const toLocalISO = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

// Preset due dates relative to today: today, tomorrow, this/next Friday.
const datePresets = (): { label: string; value: string }[] => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const friday = new Date(today);
  const toFri = (5 - today.getDay() + 7) % 7; // 0 if today is Friday
  friday.setDate(today.getDate() + (toFri === 0 ? 0 : toFri));
  return [
    { label: "Today", value: toLocalISO(today) },
    { label: "Tomorrow", value: toLocalISO(tomorrow) },
    { label: "End of week", value: toLocalISO(friday) },
  ];
};

const issueService = new IssueService();

// Small per-row control to set/clear a work item's due date (presets + picker).
const DueDateSetter = ({ item, onSet }: { item: TMyWorkItem; onSet: (v: string | null) => void }) => {
  const [open, setOpen] = useState(false);
  const presets = useMemo(datePresets, []);
  // The wrapper is presentational: its only job is to keep a click on the date
  // control from also opening the work item behind it.
  return (
    <span className="relative shrink-0" role="presentation" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={item.target_date ? `Due ${item.target_date}` : "Set due date"}
        className={cn(
          "hover:bg-neutral-500/10 flex items-center gap-1 rounded px-1 py-0.5 text-[11px]",
          item.target_date ? "text-secondary" : "text-tertiary opacity-0 group-hover:opacity-100"
        )}
      >
        <CalendarPlus className="size-3" />
        {item.target_date && <span>{renderFormattedDateWithoutYear(item.target_date)}</span>}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close the date picker"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <span className="shadow-lg absolute top-full right-0 z-30 mt-1 flex w-36 flex-col rounded-md border border-subtle bg-layer-1 p-1">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => {
                  onSet(p.value);
                  setOpen(false);
                }}
                className="hover:bg-neutral-500/10 flex justify-between rounded px-2 py-1 text-left text-12"
              >
                <span>{p.label}</span>
                <span className="text-tertiary">{renderFormattedDateWithoutYear(p.value)}</span>
              </button>
            ))}
            <label className="hover:bg-neutral-500/10 mt-0.5 flex items-center gap-1 rounded px-2 py-1 text-12">
              Pick…
              <input
                type="date"
                className="ml-auto w-4 cursor-pointer opacity-0"
                onChange={(e) => {
                  if (e.target.value) {
                    onSet(e.target.value);
                    setOpen(false);
                  }
                }}
              />
              <CalendarDays className="size-3 text-tertiary" />
            </label>
            {item.target_date && (
              <button
                type="button"
                onClick={() => {
                  onSet(null);
                  setOpen(false);
                }}
                className="rounded px-2 py-1 text-left text-12 text-danger-primary hover:bg-danger-subtle-hover"
              >
                Clear date
              </button>
            )}
          </span>
        </>
      )}
    </span>
  );
};

type Bucket = { key: string; label: string; icon: typeof AlertTriangle; tone: string; items: TMyWorkItem[] };

export const MyTasksWidget = observer(function MyTasksWidget() {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const { setPeekIssue, peekIssue } = useIssueDetail();
  const { data: currentUser } = useUser();
  const service = useMemo(() => new ArribadaService(), []);
  const [items, setItems] = useState<TMyWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  // ARRIBADA: a manual + automatic refresh, because editing a task from the peek (e.g. its
  // status) does not flow back into this list on its own.
  const [refreshing, setRefreshing] = useState(false);
  // ARRIBADA: the full create modal, opened by the "+".
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<"list" | "calendar">("list");
  // Which buckets the reader has asked to see in full. "+3 more" used to be a
  // plain <li> with no handler, sitting under six rows that are all buttons —
  // the one thing on the first screen anyone lands on that looks clickable and
  // is not. The header's "View all" goes to the whole workspace, not to the
  // bucket that was truncated, so there was no route to those rows at all.
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());

  const setDue = (item: TMyWorkItem, value: string | null) => {
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, target_date: value } : x)));
    if (workspaceSlug) {
      issueService.patchIssue(workspaceSlug.toString(), item.project_id, item.id, { target_date: value }).catch(() => {
        // revert on failure
        setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, target_date: item.target_date } : x)));
      });
    }
  };

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!workspaceSlug) return;
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      try {
        const r = await service.getMyWork(workspaceSlug.toString());
        setItems(r || []);
      } catch {
        // A failed refresh keeps the rows already on screen; only the first load falls to empty.
        if (mode === "initial") setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [workspaceSlug, service]
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  // ARRIBADA: when the peek overview closes, the reader may have just changed a status or a
  // date on it — pull the list back into step. The ref guards against firing when it OPENS.
  const prevPeek = useRef(peekIssue);
  useEffect(() => {
    if (prevPeek.current && !peekIssue) void load("refresh");
    prevPeek.current = peekIssue;
  }, [peekIssue, load]);

  const buckets = useMemo<Bucket[]>(() => {
    // Compare date-only strings (YYYY-MM-DD sorts chronologically) against local
    // today / today+7 — avoids the UTC-midnight shift that mis-buckets Americas TZs.
    const now = new Date();
    const todayISO = toLocalISO(now);
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() + 7);
    const weekISO = toLocalISO(weekEnd);
    const overdue: TMyWorkItem[] = [];
    const week: TMyWorkItem[] = [];
    const later: TMyWorkItem[] = [];
    const undated: TMyWorkItem[] = [];
    for (const it of items) {
      if (!it.target_date) {
        undated.push(it);
        continue;
      }
      const d = it.target_date.slice(0, 10);
      if (d < todayISO) overdue.push(it);
      else if (d <= weekISO) week.push(it);
      else later.push(it);
    }
    return [
      { key: "overdue", label: "Overdue", icon: AlertTriangle, tone: "text-danger-primary", items: overdue },
      { key: "week", label: "This week", icon: CalendarClock, tone: "text-warning-primary", items: week },
      { key: "later", label: "Later", icon: CalendarDays, tone: "text-secondary", items: later },
      { key: "undated", label: "No date", icon: CalendarDays, tone: "text-secondary", items: undated },
    ].filter((b) => b.items.length > 0);
  }, [items]);

  const total = items.length;

  // ARRIBADA: open the peek overview (a modal with the item's full detail AND its own
  // full-screen button to the page) instead of navigating away, so glancing at a task does
  // not lose the Home view. The Home page already mounts the peek — the recents widget uses
  // the same setPeekIssue.
  const openItem = (it: TMyWorkItem) =>
    setPeekIssue({ workspaceSlug: workspaceSlug?.toString() ?? "", projectId: it.project_id, issueId: it.id });

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl border border-subtle bg-surface-1 p-4">
        <div className="mb-3 h-4 w-28 rounded bg-layer-2" />
        <div className="space-y-2">
          <div className="h-8 rounded bg-layer-2" />
          <div className="h-8 rounded bg-layer-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-subtle bg-surface-1">
      {/* ARRIBADA: the full create modal — no project preset, so a task can be added to any
          project from Home; on save the list refreshes so a self-assigned one appears. */}
      <CreateUpdateIssueModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={async () => {
          await load("refresh");
        }}
      />
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-primary">My tasks</h3>
          <span className="bg-neutral-500/10 text-xs rounded-full px-2 py-0.5 font-medium text-secondary">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* ARRIBADA: open the full create modal to add a task on any project from Home. */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            title="New work item"
            aria-label="New work item"
            className="rounded p-1 text-secondary hover:text-primary"
          >
            <Plus className="size-3.5" />
          </button>
          {/* ARRIBADA: icon-only refresh — the list also refreshes itself when the peek closes,
              but this is the manual pull for anything edited elsewhere. */}
          <button
            type="button"
            onClick={() => void load("refresh")}
            title="Refresh"
            aria-label="Refresh my tasks"
            disabled={refreshing}
            className="rounded p-1 text-secondary hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </button>
          {total > 0 && (
            <div className="flex items-center rounded-md border border-subtle p-0.5">
              <button
                type="button"
                onClick={() => setView("list")}
                title="List"
                className={cn(
                  "rounded p-1",
                  view === "list" ? "bg-neutral-500/15 text-primary" : "text-secondary hover:text-primary"
                )}
              >
                <List className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setView("calendar")}
                title="Calendar"
                className={cn(
                  "rounded p-1",
                  view === "calendar" ? "bg-neutral-500/15 text-primary" : "text-secondary hover:text-primary"
                )}
              >
                <LayoutGrid className="size-3.5" />
              </button>
            </div>
          )}
          {total > 0 && currentUser?.id && (
            <button
              type="button"
              onClick={() => router.push(`/${workspaceSlug}/profile/${currentUser.id}/assigned`)}
              className="text-xs flex items-center gap-0.5 font-medium text-secondary hover:text-primary"
            >
              View all
              <ChevronRight className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-4 pt-2 pb-6 text-center">
          <CheckCircle2 className="size-6 text-success-primary" />
          <p className="text-sm text-secondary">Nothing assigned to you. Enjoy the calm.</p>
        </div>
      ) : view === "calendar" ? (
        <MyTasksCalendar items={items} onOpenItem={openItem} onSetDue={setDue} />
      ) : (
        <div className="divide-y divide-subtle">
          {buckets.map((b) => {
            const Icon = b.icon;
            return (
              <div key={b.key} className="px-4 py-2">
                <div className={cn("text-xs mb-1 flex items-center gap-1.5 font-semibold", b.tone)}>
                  <Icon className="size-3.5" />
                  {b.label}
                  <span className="text-secondary/70">· {b.items.length}</span>
                </div>
                <ul>
                  {(expandedBuckets.has(b.label) ? b.items : b.items.slice(0, 6)).map((it) => (
                    <li
                      key={it.id}
                      className="group hover:bg-neutral-500/5 flex w-full items-center gap-2 rounded-md px-1.5 py-1"
                    >
                      {/* The row opens the item, the due-date control does not — so the
                          clickable part is a real button and the control is its sibling,
                          rather than a button nested inside a clickable <li>. */}
                      <button
                        type="button"
                        onClick={() => openItem(it)}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[it.priority])} />
                        <span className="text-sm truncate text-primary">{it.name}</span>
                      </button>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <DueDateSetter item={it} onSet={(v) => setDue(it, v)} />
                        <span className="text-[11px] tracking-wide text-secondary/70 uppercase">
                          {it.project_identifier}-{it.sequence_id}
                        </span>
                      </span>
                    </li>
                  ))}
                  {b.items.length > 6 && (
                    <li className="px-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedBuckets((current) => {
                            const next = new Set(current);
                            if (next.has(b.label)) next.delete(b.label);
                            else next.add(b.label);
                            return next;
                          })
                        }
                        className="text-[11px] text-secondary/70 underline-offset-2 hover:text-primary hover:underline"
                      >
                        {expandedBuckets.has(b.label) ? "Show fewer" : `+${b.items.length - 6} more`}
                      </button>
                    </li>
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
