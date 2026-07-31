/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  Filter,
  Flag,
  Folder,
  FolderKanban,
  MoreHorizontal,
  Route,
  SlidersHorizontal,
  Wand2,
  X,
} from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPortfolioColorBy, TPortfolioProject, TPortfolioSortBy } from "@/plane-web/types/arribada";
import { CloneProjectModal } from "./clone-project-modal";
import { buildPortfolioSvg, downloadPng, downloadSvg } from "./export";
import { UndatedItemsModal } from "./undated-items-modal";

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

const PRIORITIES: { value: string; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
];

type TMenu = "projects" | "filter" | "display" | "actions" | "undated";

const triggerBtn = "flex items-center gap-1.5 rounded border border-subtle px-2 py-1 hover:bg-layer-1";
const menuRow =
  "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-13 hover:bg-layer-2 disabled:opacity-50";

export const PortfolioToolbar = observer(function PortfolioToolbar() {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const portfolio = usePortfolio();
  const service = useMemo(() => new ArribadaService(), []);
  const [openMenu, setOpenMenu] = useState<TMenu | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [undatedProjectId, setUndatedProjectId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [reflowing, setReflowing] = useState(false);
  const [reflowResult, setReflowResult] = useState<number | null>(null);

  const toggle = (m: TMenu) => setOpenMenu((v) => (v === m ? null : m));
  const close = () => setOpenMenu(null);

  const exportTimeline = async (format: "png" | "svg") => {
    const displayed = portfolio.allProjects.filter((p) => portfolio.displayedProjectIds.includes(p.id));
    const svg = buildPortfolioSvg(displayed.length ? displayed : portfolio.allProjects);
    if (!svg) return;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (format === "svg") downloadSvg(svg, `portfolio-${stamp}.svg`);
      else await downloadPng(svg, `portfolio-${stamp}.png`);
    } catch {
      if (format === "png") downloadSvg(svg, `portfolio-${stamp}.svg`);
    }
  };

  // Both bulk actions act on scopedProjectIds, NOT displayedProjectIds: the timeline
  // draws the scoped set, and a button acts on what you can see. With a folder in
  // focus the two differ, and using the wider list rewrote dates across every project
  // in the workspace — through .update(), so it left no activity trail to find it by.
  const captureBaselines = async () => {
    if (!workspaceSlug || capturing) return;
    setCapturing(true);
    try {
      await Promise.all(portfolio.scopedProjectIds.map((id) => service.captureBaseline(workspaceSlug.toString(), id)));
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
        portfolio.scopedProjectIds.map((id) => service.autoSchedule(workspaceSlug.toString(), id))
      );
      setReflowResult(results.reduce((sum, r) => sum + (r?.rescheduled ?? 0), 0));
      await portfolio.fetchPortfolio(workspaceSlug.toString());
    } finally {
      setReflowing(false);
    }
  };

  const allProjects = portfolio.allProjects.filter((p) => !p.archived);
  const selected = new Set(portfolio.displayedProjectIds);
  // displayed order, so the dropdown reads the same way the timeline does
  const undatedProjects = portfolio.sortedProjectIds
    .map((id) => portfolio.getProject(id))
    .filter((p): p is TPortfolioProject => !!p && p.undated_item_count > 0);

  const toggleProject = (id: string) => {
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

      {/* Projects scope */}
      <div className="relative">
        <button type="button" onClick={() => toggle("projects")} className={triggerBtn}>
          <FolderKanban className="size-3.5 text-secondary" />
          Projects ({selected.size}/{allProjects.length})
          <ChevronDown className="size-3.5 text-secondary" />
        </button>
        {openMenu === "projects" && (
          <>
            <button type="button" aria-label="Close menu" className="fixed inset-0 z-20" onClick={close} />
            <div className="shadow-lg absolute top-full left-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1">
              <div className="flex items-center justify-between px-2 py-1 text-11 text-secondary">
                <button
                  type="button"
                  className="hover:text-primary"
                  onClick={() => portfolio.setDisplayedProjectIds(allProjects.map((p) => p.id))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="hover:text-primary"
                  onClick={() => portfolio.setDisplayedProjectIds([])}
                >
                  Clear
                </button>
              </div>
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
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
                    <span className="flex items-center gap-0.5 text-11 text-warning-primary">
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

      {/* Filters */}
      <div className="relative">
        <button
          type="button"
          onClick={() => toggle("filter")}
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
        {openMenu === "filter" && (
          <>
            <button type="button" aria-label="Close menu" className="fixed inset-0 z-20" onClick={close} />
            <div className="shadow-lg absolute top-full left-0 z-30 mt-1 w-52 rounded-md border border-subtle bg-layer-1 p-1.5">
              <div className="px-1.5 py-1 text-11 font-medium tracking-wide text-secondary uppercase">Priority</div>
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
                  className="mt-1 w-full rounded px-1.5 py-1 text-left text-12 text-danger-primary hover:bg-danger-subtle-hover"
                >
                  Clear filters
                </button>
              )}
              <div className="mt-1 border-t border-subtle px-1.5 pt-1 text-10 text-secondary/70">
                Filters the tasks inside expanded projects.
                {portfolio.hasActiveFilters && portfolio.expandedProjectIds.size === 0 && (
                  <span className="mt-0.5 block text-warning-primary">Expand a project to see it take effect.</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Display: colour, order, grouping */}
      <div className="relative">
        <button type="button" onClick={() => toggle("display")} className={triggerBtn}>
          <SlidersHorizontal className="size-3.5 text-secondary" />
          Display
          <ChevronDown className="size-3.5 text-secondary" />
        </button>
        {openMenu === "display" && (
          <>
            <button type="button" aria-label="Close menu" className="fixed inset-0 z-20" onClick={close} />
            <div className="shadow-lg absolute top-full left-0 z-30 mt-1 w-56 rounded-md border border-subtle bg-layer-1 p-1.5">
              <div className="mb-0.5 px-1.5 text-11 font-medium tracking-wide text-secondary uppercase">Colour by</div>
              <div className="mb-2 flex gap-1 px-1">
                {COLOR_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => portfolio.setColorBy(o.value)}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-12",
                      portfolio.colorBy === o.value
                        ? "bg-accent-primary/10 font-medium text-accent-primary"
                        : "text-secondary hover:bg-layer-2"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="mb-0.5 px-1.5 text-11 font-medium tracking-wide text-secondary uppercase">Order by</div>
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => portfolio.setSortBy(o.value)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
                >
                  <span
                    className={cn(
                      "size-3 rounded-full border",
                      portfolio.sortBy === o.value ? "border-accent-strong bg-accent-primary" : "border-subtle"
                    )}
                  />
                  {o.label}
                </button>
              ))}
              <div className="mt-1.5 border-t border-subtle pt-1.5">
                <button
                  type="button"
                  onClick={() => portfolio.setGroupByFolder(!portfolio.groupByFolder)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded border",
                      portfolio.groupByFolder ? "border-accent-strong bg-accent-primary text-white" : "border-subtle"
                    )}
                  >
                    {portfolio.groupByFolder && <Check className="size-3" />}
                  </span>
                  Group by folder
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Critical path (analysis mode) */}
      <button
        type="button"
        onClick={() =>
          workspaceSlug && portfolio.setShowCriticalPath(workspaceSlug.toString(), !portfolio.showCriticalPath)
        }
        title="Highlight the program critical path and cross-project dependency arrows"
        className={cn("flex items-center gap-1.5 rounded border px-2 py-1", {
          "border-danger-strong bg-danger-subtle text-danger-primary": portfolio.showCriticalPath,
          "border-subtle hover:bg-layer-1": !portfolio.showCriticalPath,
        })}
      >
        <Route className="size-3.5" />
        Critical path
      </button>

      <div className="flex-grow" />

      {/* undated indicator — a way in, not just a warning */}
      {portfolio.totalUndatedCount > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => toggle("undated")}
            title="Give these work items dates"
            className="flex items-center gap-1 rounded bg-warning-subtle px-2 py-1 text-warning-primary hover:opacity-80"
          >
            <AlertTriangle className="size-3.5" />
            {portfolio.totalUndatedCount} without dates
            <ChevronDown className="size-3.5" />
          </button>
          {openMenu === "undated" && (
            <>
              <button type="button" aria-label="Close menu" className="fixed inset-0 z-20" onClick={close} />
              <div className="shadow-lg absolute top-full right-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1">
                <div className="px-2 py-1 text-11 font-medium tracking-wide text-secondary uppercase">
                  Projects with undated items
                </div>
                {undatedProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      close();
                      setUndatedProjectId(p.id);
                    }}
                    className={menuRow}
                  >
                    <span className="flex-grow truncate">{p.name}</span>
                    <span className="flex-shrink-0 text-11 text-warning-primary">{p.undated_item_count}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions menu: occasional operations tucked away */}
      <div className="relative">
        <button type="button" onClick={() => toggle("actions")} title="More actions" className={triggerBtn}>
          <MoreHorizontal className="size-4 text-secondary" />
        </button>
        {openMenu === "actions" && (
          <>
            <button type="button" aria-label="Close menu" className="fixed inset-0 z-20" onClick={close} />
            <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-56 rounded-md border border-subtle bg-layer-1 p-1">
              <button
                type="button"
                disabled={reflowing}
                onClick={() => {
                  close();
                  reflow();
                }}
                title="Push any task that starts before its dependencies allow (respects links, weekends)"
                className={menuRow}
              >
                <Wand2 className="size-3.5 text-secondary" />
                {reflowing ? "Reflowing…" : reflowResult !== null ? `Reflowed ${reflowResult}` : "Reflow schedule"}
              </button>
              <button
                type="button"
                disabled={capturing}
                onClick={() => {
                  close();
                  captureBaselines();
                }}
                title="Freeze the current dates as a baseline (ghost bars + variance)"
                className={menuRow}
              >
                <Flag className="size-3.5 text-secondary" />
                {capturing ? "Capturing…" : capturedAt ? `Baseline ${capturedAt}` : "Capture baseline"}
              </button>
              <div className="my-1 h-px bg-layer-2" />
              <button
                type="button"
                onClick={() => {
                  close();
                  setCloneOpen(true);
                }}
                className={menuRow}
              >
                <Copy className="size-3.5 text-secondary" />
                New from template
              </button>
              <div className="my-1 h-px bg-layer-2" />
              <div className="px-2 py-0.5 text-10 font-medium tracking-wide text-secondary/70 uppercase">
                Export timeline
              </div>
              <button
                type="button"
                onClick={() => {
                  close();
                  exportTimeline("png");
                }}
                className={menuRow}
              >
                <Download className="size-3.5 text-secondary" />
                PNG image
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  exportTimeline("svg");
                }}
                className={menuRow}
              >
                <Download className="size-3.5 text-secondary" />
                SVG (vector)
              </button>
            </div>
          </>
        )}
      </div>

      <CloneProjectModal isOpen={cloneOpen} onClose={() => setCloneOpen(false)} />

      <UndatedItemsModal
        // remount per project: none of the previous project's rows or drafts survive
        key={undatedProjectId ?? "none"}
        projectId={undatedProjectId}
        projectName={undatedProjectId ? portfolio.getProject(undatedProjectId)?.name : undefined}
        onClose={() => setUndatedProjectId(null)}
        onChanged={() => {
          if (!workspaceSlug || !undatedProjectId) return;
          void portfolio.refreshProjectItems(workspaceSlug.toString(), undatedProjectId).then((ok) => {
            if (!ok)
              setToast({
                type: TOAST_TYPE.WARNING,
                title: "The dates were saved",
                message: "The timeline couldn't be refreshed, so it may still show them as undated. Reload the page.",
              });
            return undefined;
          });
        }}
      />

      {/* critical-path legend + empty-state hint (own wrapping line) */}
      {portfolio.showCriticalPath && (
        <div className="flex w-full flex-wrap items-center gap-3 pt-0.5 text-11 text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-4 rounded bg-danger-primary" /> Critical path
          </span>
          <span className="flex items-center gap-1.5">
            <span className="border-violet-500 inline-block h-0 w-4 border-t-2 border-dashed" /> Cross-project link
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-neutral-400 inline-block h-[2px] w-4 rounded" /> In-project link
          </span>
          {portfolio.crossEdges.length === 0 && (
            <span className="text-warning-primary">
              No task dependencies yet — add “blocked by” links between tasks to see the critical path.
            </span>
          )}
        </div>
      )}
    </div>
  );
});
