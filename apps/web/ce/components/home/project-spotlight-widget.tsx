/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A configurable Home widget for one project: pick a project, then read its work (task counts
 * by completion), its budget (allocated / spent / remaining), or its spend over time. Every
 * figure reuses an endpoint the product already serves — project-stats for the counts and the
 * Finance `getBudget` for the money — so nothing new is computed and the numbers match the
 * pages they come from. The chosen project and view are a per-browser preference.
 *
 * Budget and spend are money, so they are permission-gated server-side: a reader without a
 * money role simply sees "not available", never a wrong number.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { BarChart3, CheckCircle2, Coins, ListChecks } from "lucide-react";
import { cn } from "@plane/utils";
import type { TProjectAnalyticsCount } from "@plane/types";
import { useProject } from "@/hooks/store/use-project";
import { ProjectService } from "@/services/project";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectBudget } from "@/plane-web/types/arribada";

const projectService = new ProjectService();
const arribadaService = new ArribadaService();

type TView = "tasks" | "budget" | "spend";
const KEY = "arribada-project-spotlight";

const readPref = (): { projectId: string | null; view: TView } => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { projectId: p.projectId ?? null, view: (["tasks", "budget", "spend"] as const).includes(p.view) ? p.view : "tasks" };
    }
  } catch {
    /* ignore */
  }
  return { projectId: null, view: "tasks" };
};

const money = (n: number | null | undefined, ccy: string) =>
  n == null ? "—" : `${Math.round(n).toLocaleString()} ${ccy}`;

export const ProjectSpotlightWidget = observer(function ProjectSpotlightWidget() {
  const { workspaceSlug } = useParams();
  const { joinedProjectIds, getProjectById } = useProject();

  const [projectId, setProjectId] = useState<string | null>(() => readPref().projectId);
  const [view, setView] = useState<TView>(() => readPref().view);
  const [counts, setCounts] = useState<TProjectAnalyticsCount | null>(null);
  const [budget, setBudget] = useState<TProjectBudget | null>(null);
  const [loading, setLoading] = useState(false);
  const [moneyDenied, setMoneyDenied] = useState(false);

  const projects = useMemo(
    () => joinedProjectIds.map((id) => getProjectById(id)).filter((p): p is NonNullable<typeof p> => !!p),
    [joinedProjectIds, getProjectById]
  );

  // Default to the first project the reader has, once they load.
  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  // Persist the choice.
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ projectId, view }));
    } catch {
      /* ignore */
    }
  }, [projectId, view]);

  const load = useCallback(async () => {
    if (!workspaceSlug || !projectId) return;
    const slug = workspaceSlug.toString();
    setLoading(true);
    setMoneyDenied(false);
    try {
      if (view === "tasks") {
        const rows = await projectService.getProjectAnalyticsCount(slug, { project_ids: projectId });
        setCounts(rows.find((r) => r.id === projectId) ?? rows[0] ?? null);
      } else {
        // Budget covers both the "budget" and "spend over time" views.
        const b = await arribadaService.getBudget(slug, projectId);
        setBudget(b);
      }
    } catch {
      // Money views are permission-gated; a refusal is "not available", not an error to shout.
      if (view !== "tasks") setMoneyDenied(true);
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, projectId, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = projectId ? getProjectById(projectId) : undefined;
  const display = budget?.display;
  const pct = display?.percent ?? null;
  const months = budget?.rhythm?.months ?? [];
  const maxMonth = Math.max(1, ...months.map((m) => m.amount));

  const TABS: { key: TView; label: string; icon: typeof ListChecks }[] = [
    { key: "tasks", label: "Tasks", icon: ListChecks },
    { key: "budget", label: "Budget", icon: Coins },
    { key: "spend", label: "Spend", icon: BarChart3 },
  ];

  return (
    <div className="rounded-xl border border-subtle bg-surface-1 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-primary">Project</h3>
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
          >
            {projects.length === 0 && <option value="">No project</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center rounded-md border border-subtle p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              title={tab.label}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-11 font-medium",
                view === tab.key ? "bg-neutral-500/15 text-primary" : "text-secondary hover:text-primary"
              )}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {!projectId ? (
        <p className="py-6 text-center text-12 text-tertiary">Pick a project to see its numbers.</p>
      ) : loading ? (
        <div className="space-y-2">
          <div className="h-8 animate-pulse rounded bg-layer-2" />
          <div className="h-8 animate-pulse rounded bg-layer-2" />
        </div>
      ) : view === "tasks" ? (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Work items" value={counts?.total_issues ?? 0} />
          <Stat label="Completed" value={counts?.completed_issues ?? 0} icon={CheckCircle2} />
          <Stat
            label="Done"
            value={`${counts?.total_issues ? Math.round(((counts.completed_issues ?? 0) / counts.total_issues) * 100) : 0}%`}
          />
        </div>
      ) : moneyDenied ? (
        <p className="py-6 text-center text-12 text-tertiary">
          Budget is not available to you for {selected?.name ?? "this project"}.
        </p>
      ) : view === "budget" ? (
        <div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Allocated" value={money(display?.allocation, display?.currency ?? "")} />
            <Stat label="Spent" value={money(display?.committed, display?.currency ?? "")} />
            <Stat label="Remaining" value={money(display?.remaining, display?.currency ?? "")} />
          </div>
          {pct != null && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-11 text-tertiary">
                <span>{Math.round(pct)}% committed</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-layer-2">
                <div
                  className={cn("h-full rounded-full", pct > 100 ? "bg-danger-primary" : "bg-accent-primary")}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        // Spend over time — the monthly bars the Finance page draws, in miniature.
        <div>
          {months.length === 0 ? (
            <p className="py-6 text-center text-12 text-tertiary">No monthly spend recorded yet.</p>
          ) : (
            <div className="flex h-28 items-end gap-1">
              {months.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${money(m.amount, budget?.rhythm?.currency ?? display?.currency ?? "")}`}>
                  <div
                    className="w-full rounded-t bg-accent-primary/70"
                    style={{ height: `${Math.max(2, (m.amount / maxMonth) * 100)}%` }}
                  />
                  <span className="text-[9px] text-tertiary">{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon?: typeof ListChecks }) {
  return (
    <div className="rounded-lg border border-subtle bg-layer-1 p-2.5">
      <div className="flex items-center gap-1 text-11 text-tertiary">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="mt-0.5 text-15 font-semibold text-primary tabular-nums">{value}</div>
    </div>
  );
}
