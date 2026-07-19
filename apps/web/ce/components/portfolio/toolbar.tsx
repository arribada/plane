/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Copy, Download, Filter, Flag, Folder, FolderKanban, Route, Wand2, X } from "lucide-react";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPortfolioColorBy, TPortfolioSortBy } from "@/plane-web/types/arribada";
import { CloneProjectModal } from "./clone-project-modal";
import { buildPortfolioSvg, downloadPng, downloadSvg } from "./export";

const COLOR_OPTIONS: { value: TPortfolioColorBy; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "priority", label: "Priority" },
];

const SORT_OPTIONS: { value: TPortfolioSortBy; label: string }[] = [
  { value: "start_date", label: "Start date" },
  { value: "target_date", label: "Target date" },
  { value: "name", label: "Name" },
  { value: "undated", label: "Undated first" },
  { value: "manual", label: "Manual (drag)" },
];

export const PortfolioToolbar = observer(function PortfolioToolbar() {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const portfolio = usePortfolio();
  const service = useMemo(() => new ArribadaService(), []);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  const [reflowing, setReflowing] = useState(false);
  const [reflowResult, setReflowResult] = useState<number | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const PRIORITIES: { value: string; label: string }[] = [
    { value: "urgent", label: "Urgent" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
    { value: "none", label: "None" },
  ];

  const exportTimeline = async (format: "png" | "svg") => {
    setExportOpen(false);
    const displayed = portfolio.allProjects.filter((p) => portfolio.displayedProjectIds.includes(p.id));
    const svg = buildPortfolioSvg(displayed.length ? displayed : portfolio.allProjects);
    if (!svg) return;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (format === "svg") downloadSvg(svg, `portfolio-${stamp}.svg`);
      else await downloadPng(svg, `portfolio-${stamp}.png`);
    } catch {
      // rasterization can fail in rare browser states — fall back to the vector export
      if (format === "png") downloadSvg(svg, `portfolio-${stamp}.svg`);
    }
  };

  const captureBaselines = async () => {
    if (!workspaceSlug || capturing) return;
    setCapturing(true);
    try {
      await Promise.all(portfolio.displayedProjectIds.map((id) => service.captureBaseline(workspaceSlug.toString(), id)));
      setCapturedAt(new Date().toLocaleTimeString());
    } finally {
      setCapturing(false);
    }
  };

  const reflow = async () => {
    if (!workspaceSlug || reflowing) return;
    setReflowing(true);
    try {
      const results = await Promise.all(
        portfolio.displayedProjectIds.map((id) => service.autoSchedule(workspaceSlug.toString(), id))
      );
      const total = results.reduce((sum, r) => sum + (r?.rescheduled ?? 0), 0);
      setReflowResult(total);
      await portfolio.fetchPortfolio(workspaceSlug.toString());
    } finally {
      setReflowing(false);
    }
  };

  const allProjects = portfolio.allProjects.filter((p) => !p.archived);
  const selected = new Set(portfolio.displayedProjectIds);

  const toggleProject = (id: string) => {
    // Add/remove only the toggled id in place, preserving any manual drag order
    // (rebuilding from allProjects would reset the timeline to API order).
    const current = portfolio.displayedProjectIds;
    portfolio.setDisplayedProjectIds(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-2 text-13">
      {/* folder-focus chip: portfolio scoped to a single folder */}
      {portfolio.focusFolderName && (
        <span className="flex items-center gap-1.5 rounded bg-accent-primary/10 px-2 py-1 font-medium text-accent-primary">
          <Folder className="size-3.5" />
          {portfolio.focusFolderName}
          <button
            type="button"
            title="Show all projects"
            onClick={() => workspaceSlug && router.push(`/${workspaceSlug}/portfolio`)}
            className="ml-0.5 rounded hover:bg-accent-primary/20"
          >
            <X className="size-3.5" />
          </button>
        </span>
      )}

      {/* project selector */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setProjectsOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded border border-subtle px-2 py-1 hover:bg-layer-1"
        >
          <FolderKanban className="size-3.5 text-secondary" />
          Projects ({selected.size}/{allProjects.length})
          <ChevronDown className="size-3.5 text-secondary" />
        </button>
        {projectsOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setProjectsOpen(false)} />
            <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1 shadow-lg">
              <div className="flex items-center justify-between px-2 py-1 text-11 text-secondary">
                <button type="button" className="hover:text-primary" onClick={() => portfolio.setDisplayedProjectIds(allProjects.map((p) => p.id))}>
                  Select all
                </button>
                <button type="button" className="hover:text-primary" onClick={() => portfolio.setDisplayedProjectIds([])}>
                  Clear
                </button>
              </div>
              {allProjects.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => toggleProject(p.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-layer-2"
                >
                  <span
                    className={cn("flex size-4 items-center justify-center rounded border", {
                      "border-accent-strong bg-accent-primary text-white": selected.has(p.id),
                      "border-subtle": !selected.has(p.id),
                    })}
                  >
                    {selected.has(p.id) && <Check className="size-3" />}
                  </span>
                  <span className="flex-grow truncate">{p.name}</span>
                  {!!p.undated_item_count && (
                    <span className="flex items-center gap-0.5 text-11 text-amber-600">
                      <AlertTriangle className="size-3" />
                      {p.undated_item_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* color by */}
      <label className="flex items-center gap-1.5 text-secondary">
        Color
        <select
          className="rounded border border-subtle bg-layer-1 px-1.5 py-1 text-primary"
          value={portfolio.colorBy}
          onChange={(e) => portfolio.setColorBy(e.target.value as TPortfolioColorBy)}
        >
          {COLOR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {/* sort by */}
      <label className="flex items-center gap-1.5 text-secondary">
        Sort
        <select
          className="rounded border border-subtle bg-layer-1 px-1.5 py-1 text-primary"
          value={portfolio.sortBy}
          onChange={(e) => portfolio.setSortBy(e.target.value as TPortfolioSortBy)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {/* filter task bars by priority / assigned-to-me (affects expanded projects) */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          title="Filter task bars (applies to expanded projects)"
          className={cn("flex items-center gap-1.5 rounded border px-2 py-1", {
            "border-accent-strong bg-accent-primary/10 text-accent-primary": portfolio.hasActiveFilters,
            "border-subtle hover:bg-layer-1": !portfolio.hasActiveFilters,
          })}
        >
          <Filter className="size-3.5" />
          Filter
          {portfolio.hasActiveFilters && (
            <span className="rounded-full bg-accent-primary px-1 text-10 text-white">
              {portfolio.priorityFilter.size + (portfolio.assignedToMeOnly ? 1 : 0)}
            </span>
          )}
        </button>
        {filterOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setFilterOpen(false)} />
            <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-md border border-subtle bg-layer-1 p-1.5 shadow-lg">
              <div className="px-1.5 py-1 text-11 font-medium uppercase tracking-wide text-secondary">Priority</div>
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => portfolio.togglePriorityFilter(p.value)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
                >
                  <span
                    className={cn("flex size-4 items-center justify-center rounded border", {
                      "border-accent-strong bg-accent-primary text-white": portfolio.priorityFilter.has(p.value),
                      "border-subtle": !portfolio.priorityFilter.has(p.value),
                    })}
                  >
                    {portfolio.priorityFilter.has(p.value) && <Check className="size-3" />}
                  </span>
                  {p.label}
                </button>
              ))}
              <div className="my-1 h-px bg-layer-2" />
              <button
                type="button"
                onClick={() => portfolio.setAssignedToMeOnly(!portfolio.assignedToMeOnly)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
              >
                <span
                  className={cn("flex size-4 items-center justify-center rounded border", {
                    "border-accent-strong bg-accent-primary text-white": portfolio.assignedToMeOnly,
                    "border-subtle": !portfolio.assignedToMeOnly,
                  })}
                >
                  {portfolio.assignedToMeOnly && <Check className="size-3" />}
                </span>
                Assigned to me
              </button>
              {portfolio.hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => portfolio.clearFilters()}
                  className="mt-1 w-full rounded px-1.5 py-1 text-left text-12 text-red-600 hover:bg-red-500/10"
                >
                  Clear filters
                </button>
              )}
              <div className="mt-1 border-t border-subtle px-1.5 pt-1 text-10 text-secondary/70">
                Filters the tasks inside expanded projects.
                {portfolio.hasActiveFilters && portfolio.expandedProjectIds.size === 0 && (
                  <span className="mt-0.5 block text-amber-600">Expand a project to see it take effect.</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mx-0.5 h-5 w-px self-center bg-layer-2" />

      {/* highlight the cross-project critical path + draw dependency arrows */}
      <button
        type="button"
        onClick={() => workspaceSlug && portfolio.setShowCriticalPath(workspaceSlug.toString(), !portfolio.showCriticalPath)}
        title="Highlight the program critical path and cross-project dependency arrows"
        className={cn("flex items-center gap-1.5 rounded border px-2 py-1", {
          "border-red-500 bg-red-500/10 text-red-600": portfolio.showCriticalPath,
          "border-subtle hover:bg-layer-1": !portfolio.showCriticalPath,
        })}
      >
        <Route className="size-3.5" />
        Critical path
      </button>

      {/* group projects into folder swimlanes */}
      <button
        type="button"
        onClick={() => portfolio.setGroupByFolder(!portfolio.groupByFolder)}
        title="Group projects into folder swimlanes"
        className={cn("flex items-center gap-1.5 rounded border px-2 py-1", {
          "border-accent-strong bg-accent-primary/10 text-accent-primary": portfolio.groupByFolder,
          "border-subtle hover:bg-layer-1": !portfolio.groupByFolder,
        })}
      >
        <Folder className="size-3.5" />
        Group by folder
      </button>

      <div className="mx-0.5 h-5 w-px self-center bg-layer-2" />

      {/* reflow: cascade dates along dependencies across displayed projects */}
      <button
        type="button"
        onClick={reflow}
        disabled={reflowing}
        title="Push any task that starts before its dependencies allow, preserving durations (respect links)"
        className="flex items-center gap-1.5 rounded border border-subtle px-2 py-1 hover:bg-layer-1 disabled:opacity-50"
      >
        <Wand2 className="size-3.5 text-secondary" />
        {reflowing ? "Reflowing…" : reflowResult !== null ? `Reflowed ${reflowResult}` : "Reflow schedule"}
      </button>

      {/* capture baseline across displayed projects */}
      <button
        type="button"
        onClick={captureBaselines}
        disabled={capturing}
        title="Freeze the current dates of every displayed project as a baseline (ghost bars in each project's gantt)"
        className="flex items-center gap-1.5 rounded border border-subtle px-2 py-1 hover:bg-layer-1 disabled:opacity-50"
      >
        <Flag className="size-3.5 text-secondary" />
        {capturing ? "Capturing…" : capturedAt ? `Baseline ${capturedAt}` : "Capture baseline"}
      </button>

      {/* new project from an existing one used as a template */}
      <button
        type="button"
        onClick={() => setCloneOpen(true)}
        title="Create a new project by copying an existing one's work items, dependencies and structure"
        className="flex items-center gap-1.5 rounded border border-subtle px-2 py-1 hover:bg-layer-1"
      >
        <Copy className="size-3.5 text-secondary" />
        New from template
      </button>
      <CloneProjectModal isOpen={cloneOpen} onClose={() => setCloneOpen(false)} />

      {/* export the timeline as a self-contained image */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setExportOpen((v) => !v)}
          title="Export the displayed projects' timeline as an image"
          className="flex items-center gap-1.5 rounded border border-subtle px-2 py-1 hover:bg-layer-1"
        >
          <Download className="size-3.5 text-secondary" />
          Export
          <ChevronDown className="size-3.5 text-secondary" />
        </button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
            <div className="absolute left-0 top-full z-30 mt-1 w-32 rounded-md border border-subtle bg-layer-1 p-1 shadow-lg">
              <button type="button" onClick={() => exportTimeline("png")} className="flex w-full items-center rounded px-2 py-1 text-left hover:bg-layer-2">
                PNG image
              </button>
              <button type="button" onClick={() => exportTimeline("svg")} className="flex w-full items-center rounded px-2 py-1 text-left hover:bg-layer-2">
                SVG (vector)
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex-grow" />

      {/* undated indicator */}
      {portfolio.totalUndatedCount > 0 && (
        <span className="flex items-center gap-1 rounded bg-amber-500/15 px-2 py-1 text-amber-600">
          <AlertTriangle className="size-3.5" />
          {portfolio.totalUndatedCount} work items without dates
        </span>
      )}

      {/* critical-path legend + empty-state hint (own wrapping line) */}
      {portfolio.showCriticalPath && (
        <div className="flex w-full flex-wrap items-center gap-3 pt-0.5 text-11 text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-4 rounded bg-red-500" /> Critical path
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-violet-500" /> Cross-project link
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 rounded bg-neutral-400" /> In-project link
          </span>
          {portfolio.crossEdges.length === 0 && (
            <span className="text-amber-600">
              No task dependencies yet — add “blocked by” links between tasks to see the critical path.
            </span>
          )}
        </div>
      )}
    </div>
  );
});
