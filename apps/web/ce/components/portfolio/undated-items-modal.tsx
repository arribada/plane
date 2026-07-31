/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Bulk date assignment for a project's undated work items: give each row a range,
 * spread the whole list over sequential Mon–Fri slots, or hand it to the AI planner.
 * Opened from the amber "no dates" warnings on the portfolio timeline.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { CalendarRange, Check, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@plane/utils";
import { IssueService } from "@/services/issue";
import { AiPlanModal } from "@/plane-web/components/planning/ai-plan-modal";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPortfolioItem } from "@/plane-web/types/arribada";
import { PRIORITY_COLOR } from "./colors";

// Local YYYY-MM-DD: toISOString would shift the day in negative-offset zones.
const toLocalISO = (d: Date): string => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

const fromISO = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const nextWorkingDay = (d: Date): Date => {
  const out = new Date(d);
  while (out.getDay() === 0 || out.getDay() === 6) out.setDate(out.getDate() + 1);
  return out;
};

// Sequential Mon–Fri slots of `days` working days each, item N starting the working
// day after item N-1 ends. Kept pure so the calendar arithmetic can be reasoned
// about (and fixed) without touching the component around it.
const spreadWorkingDays = (
  startISO: string,
  days: number,
  count: number
): { start_date: string; target_date: string }[] => {
  const span = Math.max(1, Math.floor(days));
  const ranges: { start_date: string; target_date: string }[] = [];
  let cursor = nextWorkingDay(fromISO(startISO));
  for (let i = 0; i < count; i++) {
    const start = cursor;
    let end = new Date(start);
    for (let step = 1; step < span; step++) {
      end.setDate(end.getDate() + 1);
      end = nextWorkingDay(end);
    }
    ranges.push({ start_date: toLocalISO(start), target_date: toLocalISO(end) });
    const after = new Date(end);
    after.setDate(after.getDate() + 1);
    cursor = nextWorkingDay(after);
  }
  return ranges;
};

const issueService = new IssueService();

type Props = {
  projectId: string | null;
  projectName?: string;
  onClose: () => void;
  onChanged?: () => void;
};

type Draft = { start: string; target: string };

export const UndatedItemsModal = observer(function UndatedItemsModal(props: Props) {
  const { projectId, projectName, onClose, onChanged } = props;
  const { workspaceSlug } = useParams();
  const portfolio = usePortfolio();
  const service = useMemo(() => new ArribadaService(), []);
  const [items, setItems] = useState<TPortfolioItem[]>([]);
  // starts true: the first paint of a freshly opened modal is the fetch, never
  // "every work item has dates"
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [spreadStart, setSpreadStart] = useState(() => toLocalISO(new Date()));
  const [spreadDays, setSpreadDays] = useState(3);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    let cancelled = false;
    setLoading(true);
    // The rows belong to whichever project was last fetched, so they go before the
    // new ones land — otherwise "Spread" would write dates onto the old project's
    // work items while the new project's name is in the title.
    setItems([]);
    setDrafts({});
    setSavedIds(new Set());
    setError(null);
    service
      .getProjectItems(workspaceSlug.toString(), projectId, true)
      .then((r) => {
        if (!cancelled) setItems(r || []);
        return undefined;
      })
      .catch(() => {
        // An empty list here would read as "this project has nothing without
        // dates" — the opposite of the amber badge that opened this modal.
        if (!cancelled) {
          setItems([]);
          setError("Couldn't load this project's undated work items. Close and try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service, reloadTick]);

  // Whether the planner has an LLM behind it decides if the AI footer exists at all.
  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    let cancelled = false;
    service
      .getAiSettings(workspaceSlug.toString())
      .then((r) => {
        if (!cancelled) setAiConfigured(!!r?.configured);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setAiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service]);

  if (!projectId) return null;

  const identifier = portfolio.getProject(projectId)?.identifier;

  // Optimistic in the list AND in the timeline, both reverted when the PATCH fails.
  const writeDates = async (item: TPortfolioItem, start: string | null, target: string | null): Promise<boolean> => {
    if (!workspaceSlug) return false;
    const before = { start_date: item.start_date, target_date: item.target_date };
    const after = { start_date: start, target_date: target };
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, ...after } : x)));
    portfolio.applyItemDates(item.id, after);
    try {
      await issueService.patchIssue(workspaceSlug.toString(), projectId, item.id, after);
      setSavedIds((s) => new Set(s).add(item.id));
      return true;
    } catch {
      setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, ...before } : x)));
      portfolio.applyItemDates(item.id, before);
      return false;
    }
  };

  const setRow = async (item: TPortfolioItem) => {
    const draft = drafts[item.id];
    if (!draft || (!draft.start && !draft.target) || busy) return;
    setError(null);
    setBusy(true);
    const ok = await writeDates(item, draft.start || null, draft.target || null);
    setBusy(false);
    if (ok) onChanged?.();
    else setError("Could not update that work item.");
  };

  const applySpread = async () => {
    if (!spreadStart || !items.length || busy || loading) return;
    setError(null);
    setBusy(true);
    const ranges = spreadWorkingDays(spreadStart, spreadDays, items.length);
    const results = await Promise.all(
      items.map((it, i) => writeDates(it, ranges[i].start_date, ranges[i].target_date))
    );
    setDrafts(
      Object.fromEntries(items.map((it, i) => [it.id, { start: ranges[i].start_date, target: ranges[i].target_date }]))
    );
    setBusy(false);
    if (results.some((ok) => !ok)) setError("Some work items could not be updated.");
    if (results.some(Boolean)) onChanged?.();
  };

  const editDraft = (item: TPortfolioItem, patch: Partial<Draft>) =>
    setDrafts((d) => {
      // seed from the item's own dates only the first time it is touched
      const current: Draft = d[item.id] ?? { start: item.start_date ?? "", target: item.target_date ?? "" };
      return { ...d, [item.id]: { ...current, ...patch } };
    });

  const field =
    "rounded border border-subtle bg-layer-1 px-1.5 py-1 text-12 text-primary outline-none focus:border-accent-strong";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-0 bg-black/40"
          onClick={busy ? undefined : onClose}
        />
        <div className="shadow-2xl relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-subtle bg-layer-1">
          <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
            <h3 className="flex items-center gap-2 text-16 font-semibold text-primary">
              <CalendarRange className="size-4 text-secondary" />
              Work items without dates · {projectName ?? "Project"}
            </h3>
            <button type="button" onClick={onClose} className="text-secondary hover:text-primary">
              <X className="size-4" />
            </button>
          </div>

          {/* bulk helper: one click lays the whole list out on the calendar */}
          <div className="flex flex-wrap items-end gap-3 border-b border-subtle px-5 py-3">
            <div>
              <label
                htmlFor="undated-spread-start"
                className="mb-1 block text-11 font-medium tracking-wide text-secondary uppercase"
              >
                Spread from
              </label>
              <input
                id="undated-spread-start"
                type="date"
                className={field}
                value={spreadStart}
                onChange={(e) => setSpreadStart(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="undated-spread-days"
                className="mb-1 block text-11 font-medium tracking-wide text-secondary uppercase"
              >
                Working days each
              </label>
              <input
                id="undated-spread-days"
                type="number"
                min={1}
                max={60}
                className={cn(field, "w-20")}
                value={spreadDays}
                onChange={(e) => setSpreadDays(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <button
              type="button"
              onClick={applySpread}
              disabled={busy || loading || !spreadStart || items.length === 0}
              className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Spread {items.length} item{items.length === 1 ? "" : "s"}
            </button>
            <span className="text-11 text-secondary/70">Back-to-back, weekends skipped.</span>
          </div>

          <div className="max-h-[60vh] flex-grow overflow-y-auto px-5 py-3">
            {loading ? (
              <div className="flex justify-center py-8 text-secondary">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-6 text-center text-13 text-secondary">Every work item in this project has dates.</p>
            ) : (
              <ul className="divide-y divide-subtle">
                {items.map((item) => {
                  const draft = drafts[item.id];
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span
                        className="size-2 flex-shrink-0 rounded-full"
                        title={`Priority: ${item.priority}`}
                        style={{ backgroundColor: PRIORITY_COLOR[item.priority] }}
                      />
                      <span className="min-w-0 flex-grow truncate text-13 text-primary">{item.name}</span>
                      <span className="flex-shrink-0 text-11 tracking-wide text-secondary/70 uppercase">
                        {identifier ? `${identifier}-${item.sequence_id}` : `#${item.sequence_id}`}
                      </span>
                      <input
                        type="date"
                        title="Start date"
                        className={field}
                        value={draft?.start ?? item.start_date ?? ""}
                        onChange={(e) => editDraft(item, { start: e.target.value })}
                      />
                      <input
                        type="date"
                        title="Target date"
                        className={field}
                        value={draft?.target ?? item.target_date ?? ""}
                        onChange={(e) => editDraft(item, { target: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setRow(item)}
                        disabled={busy || !draft || (!draft.start && !draft.target)}
                        className="flex-shrink-0 rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2 disabled:opacity-40"
                      >
                        Set
                      </button>
                      <span className="w-4 flex-shrink-0">
                        {savedIds.has(item.id) && <Check className="size-3.5 text-success-primary" />}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {error && (
            <p className="mx-5 mb-2 rounded bg-danger-subtle px-2.5 py-1.5 text-12 text-danger-primary">{error}</p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-subtle px-5 py-3">
            {aiConfigured && items.length > 0 ? (
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                className="flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-13 text-secondary hover:bg-layer-2"
              >
                <Sparkles className="size-3.5" />
                Ask AI to schedule these
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      <AiPlanModal
        projectId={aiOpen ? projectId : null}
        projectName={projectName}
        onClose={() => setAiOpen(false)}
        onApplied={(applied) => {
          setAiOpen(false);
          if (applied > 0) {
            setReloadTick((t) => t + 1);
            onChanged?.();
          }
        }}
        onReflowed={(moved) => {
          // Stays open: the modal is where "Moved N work item(s)" is reported.
          if (moved > 0) {
            setReloadTick((t) => t + 1);
            onChanged?.();
          }
        }}
      />
    </>
  );
});
