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
  FileSpreadsheet,
  Filter,
  Flag,
  Folder,
  FolderKanban,
  Globe,
  MoreHorizontal,
  Route,
  SlidersHorizontal,
  Table2,
  Wand2,
  X,
} from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { criticalPathMessage } from "@/plane-web/components/gantt-chart/critical-path-banner";
import { PushDependentsUnavailable } from "@/plane-web/components/gantt-chart/push-dependents-toggle";
// The same "what day is it here" the exporters stamp inside the file with, so a
// filename and the provenance line it wraps can never name different days.
import { todayIso } from "@/plane-web/components/gantt-chart/export";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPortfolioProject, TPortfolioSortBy } from "@/plane-web/types/arribada";
import { CloneProjectModal } from "./clone-project-modal";
import { ganttDisplay } from "@/plane-web/store/gantt-display";
import { isProjectDone, PORTFOLIO_COLOR_OPTIONS } from "./color";
import { projectColor } from "./colors";
import { PORTFOLIO_GROUP_OPTIONS, subgroupOptionsFor } from "./grouping";
import {
  buildPortfolioCsv,
  buildPortfolioSvg,
  buildPortfolioWorkbook,
  downloadPng,
  downloadPortfolioCsv,
  downloadPortfolioWorkbook,
  downloadSvg,
  portfolioMeta,
  portfolioRows,
  type TPortfolioScope,
} from "./export";
import { PublishedLinksModal } from "./published-links-modal";
import { UndatedItemsModal } from "./undated-items-modal";

/** Same axes, same words, as the work-item timeline's own Colour control and as
 *  this board's Subgroup control — see portfolio/color.ts. */
const COLOR_OPTIONS = PORTFOLIO_COLOR_OPTIONS;

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

/**
 * The projects a batch left behind, named.
 *
 * By NAME rather than by id: a toast that says four uuids were not reflowed
 * tells a planner nothing they can act on. The index is the link — `allSettled`
 * answers in the order it was given, so outcome N belongs to id N.
 */
const failedProjects = (
  outcomes: PromiseSettledResult<unknown>[],
  ids: string[],
  lookup: { getProject: (id: string) => { name: string } | undefined }
): string[] =>
  outcomes.flatMap((outcome, index) => {
    if (outcome.status !== "rejected") return [];
    const id = ids[index] ?? "";
    return [lookup.getProject(id)?.name ?? id];
  });

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
  const [publishedOpen, setPublishedOpen] = useState(false);
  const [undatedProjectId, setUndatedProjectId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [reflowing, setReflowing] = useState(false);
  const [reflowResult, setReflowResult] = useState<number | null>(null);

  const toggle = (m: TMenu) => setOpenMenu((v) => (v === m ? null : m));
  const close = () => setOpenMenu(null);

  /**
   * The day this file was made, in the READER's calendar.
   *
   * Was `new Date().toISOString().slice(0, 10)`, which reads an instant back in
   * Greenwich's calendar: at UTC+12 the whole local morning named the file for
   * yesterday, so `portfolio-2026-08-12.xlsx` was downloaded on the 13th and
   * landed next to a PDF whose own footer said the 13th. `todayIso` is the one
   * the exporters stamp the provenance line with, so the filename and the line
   * inside the file are now the same day by construction.
   */
  const stampToday = () => todayIso();

  const exportTimeline = async (format: "png" | "svg") => {
    // In the board's own order, not the order the API happened to answer in. The
    // picture and the screen were sorted differently, which is half of why an
    // export did not look like what it was taken from.
    const displayed = portfolio.sortedProjectIds
      .map((id) => portfolio.getProject(id))
      .filter((p): p is TPortfolioProject => !!p);
    /**
     * The picture carries the view it was taken from, not just its bars: how the
     * board is banded, what the colour means, what was filtered out, and a
     * legend. A recipient who was not in the room has no other way to learn that
     * the teal ones are Ruby's, and an export that silently drops what the
     * reader was looking at is the defect being reported.
     */
    const svg = buildPortfolioSvg(displayed.length ? displayed : portfolio.allProjects, "Portfolio timeline", {
      meta: {
        // The same provenance block the spreadsheets carry — one source, so the
        // picture and the workbook cannot describe the same export differently.
        // Only the three that are machine values there are respelled here, in the
        // words the toolbar itself uses.
        ...portfolioMeta(portfolio, "view", []),
        groupBy: PORTFOLIO_GROUP_OPTIONS.find((o) => o.value === portfolio.groupBy)?.label,
        colorBy: PORTFOLIO_COLOR_OPTIONS.find((o) => o.value === portfolio.colorBy)?.label,
        sortBy: SORT_OPTIONS.find((o) => o.value === portfolio.sortBy)?.label,
        omissions: [
          // The picture is one row per project. Expanding a project shows its work
          // items on screen and they are not drawn here — say so rather than let a
          // reader assume the project is empty.
          ...(portfolio.expandedProjectIds.size > 0 ? ["the work items inside an expanded project"] : []),
          "float, state and effort — a picture answers when, not how much",
        ],
      },
      // Project bars only, so the scale never has to answer for a work item.
      colorOf: (id) => (portfolio.colorBy === "project" ? projectColor(id) : undefined),
      doneOf: (id) => ganttDisplay.showCompleted && isProjectDone(portfolio.getProject(id)),
    });
    if (!svg) {
      setToast({
        type: TOAST_TYPE.WARNING,
        title: "Nothing to draw",
        message: "None of the projects on this board have both a start and an end date.",
      });
      return;
    }
    const stamp = stampToday();
    try {
      if (format === "svg") downloadSvg(svg, `portfolio-${stamp}.svg`);
      else await downloadPng(svg, `portfolio-${stamp}.png`);
    } catch {
      if (format === "png") downloadSvg(svg, `portfolio-${stamp}.svg`);
    }
  };

  /**
   * The board as a table.
   *
   * "This view" walks the board's own row list, so a folded project is a folded
   * project in the file and an expanded one brings its work items — which is
   * what "ça doit exporter avec la vue configurée dans le navigateur" asks for.
   * "Everything" gives one row per project in scope regardless. Either way the
   * arrangement, the filters and what was left out ride along inside the file.
   */
  const exportTable = (format: "csv" | "xlsx", scope: TPortfolioScope) => {
    const { rows, collapsedProjects } = portfolioRows(portfolio, scope);
    if (rows.length === 0) {
      setToast({
        type: TOAST_TYPE.WARNING,
        title: "Nothing to export",
        message: "This board has no projects in scope. Pick some under Projects and try again.",
      });
      return;
    }
    const meta = portfolioMeta(portfolio, scope, collapsedProjects);
    const name = `portfolio-${stampToday()}${scope === "all" ? "-full" : ""}`;
    if (format === "csv") downloadPortfolioCsv(buildPortfolioCsv(rows, meta), `${name}.csv`);
    else downloadPortfolioWorkbook(buildPortfolioWorkbook(rows, meta), `${name}.xlsx`);
  };

  // Both bulk actions act on scopedProjectIds, NOT displayedProjectIds: the timeline
  // draws the scoped set, and a button acts on what you can see. With a folder in
  // focus the two differ, and using the wider list rewrote dates across every project
  // in the workspace — through .update(), so it left no activity trail to find it by.
  const captureBaselines = async () => {
    if (!workspaceSlug || capturing) return;

    // Named, because a baseline nobody can identify answers nothing: a funder
    // asking "what did you commit to" needs to be shown WHICH plan.
    //
    // This used to be one unguarded menu item that re-froze every scoped project
    // over the single row each work item had, destroying the plan that was
    // approved. Snapshots are additive now — nothing is overwritten — so the
    // confirmation is about scope rather than about loss.
    const count = portfolio.scopedProjectIds.length;
    const name = window.prompt(
      count === 1
        ? "Name this snapshot of the plan."
        : `Name this snapshot. It will be taken for all ${count} projects in scope.`,
      // The reader's day, not Greenwich's: this name is what a funder is later
      // shown to identify WHICH plan was frozen, and a snapshot taken on the 13th
      // called "Baseline 2026-08-12" is a snapshot nobody can line up with a
      // meeting. Same helper as the filename stamp, so the two agree.
      `Baseline ${stampToday()}`
    );
    if (name === null) return;

    setCapturing(true);
    try {
      // allSettled, not all: `all` abandons the remaining projects the moment one
      // rejects, so a snapshot named for the whole scope silently covered some
      // unknown prefix of it. And with no catch at all, a baseline that captured
      // three projects out of nine reported the same as one that captured nine.
      const outcomes = await Promise.allSettled(
        portfolio.scopedProjectIds.map((id) => service.captureBaseline(workspaceSlug.toString(), id, name.trim()))
      );
      const failed = failedProjects(outcomes, portfolio.scopedProjectIds, portfolio);
      // The drift badge beside every project name is computed from the baseline
      // fields on the row, and the snapshot that was just taken replaced them.
      // Without this the board went on reporting drift against the PREVIOUS
      // baseline — a number a funder is shown — until the page was reloaded.
      const refreshed = await portfolio.refreshLoaded(workspaceSlug.toString());
      if (failed.length === 0) {
        setCapturedAt(new Date().toLocaleTimeString());
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: `"${name.trim()}" captured`,
          message: refreshed
            ? `${count} project${count === 1 ? "" : "s"} snapshotted.`
            : `${count} project${count === 1 ? "" : "s"} snapshotted. The board couldn't be refreshed, so the drift shown is still measured against the previous baseline — reload the page.`,
        });
      } else {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: `Only ${count - failed.length} of ${count} were snapshotted`,
          message: `"${name.trim()}" does not cover ${failed.join(", ")}. Run it again — snapshots are additive, so nothing is overwritten.`,
        });
      }
    } finally {
      setCapturing(false);
    }
  };

  const reflow = async () => {
    if (!workspaceSlug || reflowing) return;
    setReflowing(true);
    const scope = portfolio.scopedProjectIds;
    try {
      // This auto-schedules EVERY project in scope. A partial failure moves some
      // projects' dates and leaves others alone, which is the one outcome a
      // planner must never have to guess at — so the projects that were not
      // reflowed are named.
      const outcomes = await Promise.allSettled(scope.map((id) => service.autoSchedule(workspaceSlug.toString(), id)));
      const moved = outcomes.reduce(
        (sum, outcome) => sum + (outcome.status === "fulfilled" ? (outcome.value?.rescheduled ?? 0) : 0),
        0
      );
      setReflowResult(moved);
      const failed = failedProjects(outcomes, scope, portfolio);
      // The reflow moved work items, so the expanded projects' task bars are as
      // stale as the project windows. fetchPortfolio only reloaded the latter —
      // and rebuilt displayedProjectIds while it was there, which force-flipped
      // the sort to "manual" and visibly reshuffled the board under the reader.
      const refreshed = await portfolio.refreshLoaded(workspaceSlug.toString());
      setToast(
        failed.length === 0
          ? {
              type: TOAST_TYPE.SUCCESS,
              title: moved > 0 ? `Moved ${moved} work item${moved === 1 ? "" : "s"}` : "Nothing needed moving",
              message: refreshed
                ? `Across ${scope.length} project${scope.length === 1 ? "" : "s"}.`
                : `Across ${scope.length} project${scope.length === 1 ? "" : "s"}. The board couldn't be refreshed, so it may still show the old dates — reload the page.`,
            }
          : {
              type: TOAST_TYPE.ERROR,
              title: `${failed.length} of ${scope.length} project${scope.length === 1 ? "" : "s"} were not reflowed`,
              message: `${failed.join(", ")} kept their dates. ${moved} work item${moved === 1 ? " was" : "s were"} moved elsewhere.`,
            }
      );
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
            {/* `whitespace-normal` on every panel in both toolbars, not only the
                ones that inherit a nowrap today: `white-space` inherits, this
                toolbar is one wrapper away from the gantt's, and a panel is not a
                toolbar control. `break-words` is for the project names below,
                which are somebody else's text. See gantt-chart/group-by.tsx. */}
            <div className="shadow-lg absolute top-full left-0 z-30 mt-1 max-h-80 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1 break-words whitespace-normal">
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
            <div className="shadow-lg absolute top-full left-0 z-30 mt-1 w-52 max-w-[calc(100vw-1rem)] rounded-md border border-subtle bg-layer-1 p-1.5 break-words whitespace-normal">
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
            <div className="shadow-lg absolute top-full left-0 z-30 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-md border border-subtle bg-layer-1 p-1.5 break-words whitespace-normal">
              <div className="mb-0.5 px-1.5 text-11 font-medium tracking-wide text-secondary uppercase">Colour by</div>
              {/* A radio list rather than the old pill row: seven axes will not
                  sit side by side in a 224px menu, and the list is the shape the
                  Order and Group sections already use. */}
              {COLOR_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => portfolio.setColorBy(o.value)}
                  title={o.hint}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
                >
                  <span
                    className={cn(
                      "size-3 flex-shrink-0 rounded-full border",
                      portfolio.colorBy === o.value ? "border-accent-strong bg-accent-primary" : "border-subtle"
                    )}
                  />
                  {o.label}
                </button>
              ))}
              {/* Done-ness and cancelled-ness are STATES, not a seventh and eighth
                  series — a hatch with a tick, and an outline with a ✕, never
                  their own hues. Off is a real answer and gives back exactly the
                  board this drew before either treatment existed: a project or
                  board being read for what is LEFT wants those bars to stop
                  shouting. The preference lives on the shared gantt display
                  store, so the two timelines cannot disagree about it. */}
              <button
                type="button"
                onClick={() => ganttDisplay.setShowCompleted(!ganttDisplay.showCompleted)}
                title="Hatch finished work with a tick and outline cancelled work with a ✕, so what has left the plan reads at a glance"
                className="mt-1 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
              >
                <span
                  className={cn(
                    "flex size-4 flex-shrink-0 items-center justify-center rounded border",
                    ganttDisplay.showCompleted ? "border-accent-strong bg-accent-primary text-white" : "border-subtle"
                  )}
                >
                  {ganttDisplay.showCompleted && <Check className="size-3" />}
                </span>
                Mark done &amp; cancelled
              </button>
              <div className="my-1.5 h-px bg-layer-2" />
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
                  {/* Where a manual order came from, when a drag made it. The bands
                      and the sort are gone and the rows did not move — saying so is
                      the difference between a feature and the board misbehaving. */}
                  {o.value === "manual" && portfolio.manualFrom && portfolio.sortBy === "manual" && (
                    <span className="ml-auto text-11 text-tertiary">from {portfolio.manualFrom}</span>
                  )}
                </button>
              ))}
              <div className="mt-1.5 border-t border-subtle pt-1.5">
                {/* Two levels, over two different kinds of row. The group axis is
                    what a PROJECT has; the subgroup axis is what a WORK ITEM has,
                    in the work-item timeline's own words. See the reasoning in
                    portfolio/grouping.ts — offering "group by priority" over
                    project rows would offer a field projects do not have. */}
                <div className="mb-0.5 px-1.5 text-11 font-medium tracking-wide text-secondary uppercase">Group</div>
                {PORTFOLIO_GROUP_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => portfolio.setGroupBy(o.value)}
                    title={o.hint}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
                  >
                    <span
                      className={cn(
                        "size-3 flex-shrink-0 rounded-full border",
                        portfolio.groupBy === o.value ? "border-accent-strong bg-accent-primary" : "border-subtle"
                      )}
                    />
                    {o.label}
                  </button>
                ))}

                <div className="mt-1.5 mb-0.5 px-1.5 text-11 font-medium tracking-wide text-secondary uppercase">
                  Subgroup
                  <span className="ml-1 text-tertiary normal-case">— inside each project</span>
                </div>
                {subgroupOptionsFor(portfolio.groupBy).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => portfolio.setSubgroupBy(o.value)}
                    title={o.hint}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
                  >
                    <span
                      className={cn(
                        "size-3 flex-shrink-0 rounded-full border",
                        portfolio.subgroupBy === o.value ? "border-accent-strong bg-accent-primary" : "border-subtle"
                      )}
                    />
                    {o.label}
                  </button>
                ))}
                {/* On by default. A project's work items are mostly parents with a
                    couple of sub-tasks each, and drawn flat under the project they
                    read as a list three times the length of the plan. */}
                <button
                  type="button"
                  onClick={() => portfolio.setNestSubtasks(!portfolio.nestSubtasks)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-13 hover:bg-layer-2"
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded border",
                      portfolio.nestSubtasks ? "border-accent-strong bg-accent-primary text-white" : "border-subtle"
                    )}
                  >
                    {portfolio.nestSubtasks && <Check className="size-3" />}
                  </span>
                  Nest sub-tasks
                </button>
                {/* Grouping by folders that could not be read draws every project
                    ungrouped — indistinguishable from a workspace that has none. */}
                {portfolio.foldersFailed && (
                  <p className="px-1.5 pt-1 text-11 text-danger-primary">
                    The folders could not be loaded, so grouping has nothing to group by. Reload to try again.
                  </p>
                )}
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

      {/* Said here because it cannot be said by a drag.
          "Push dependents" is persisted under ONE key shared by every timeline
          store (`arribada.gantt.sidebar`), so switching it on inside a project
          switches it on for this board's store too — and this board's write path
          has no relation graph to push along, so the bar moves and its chain
          does not. Silence was indistinguishable from the feature being broken,
          which is exactly how it was reported. */}
      <PushDependentsUnavailable reason="Moving a bar here moves only that bar. A push follows a project's own dependency graph, which this board does not load — open the project's timeline to move a chain. The arrows drawn here are a report, not a control." />

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
              <div className="shadow-lg absolute top-full right-0 z-30 mt-1 max-h-80 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1 break-words whitespace-normal">
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
            <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-56 rounded-md border border-subtle bg-layer-1 p-1 break-words whitespace-normal">
              <button
                type="button"
                disabled={reflowing}
                onClick={() => {
                  close();
                  void reflow();
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
                  void captureBaselines();
                }}
                title="Freeze the current dates as a new named snapshot. Earlier baselines are kept."
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
              <button
                type="button"
                onClick={() => {
                  close();
                  setPublishedOpen(true);
                }}
                title="Every project schedule currently readable without a login"
                className={menuRow}
              >
                <Globe className="size-3.5 text-secondary" />
                Published links
              </button>
              <div className="my-1 h-px bg-layer-2" />
              <div className="px-2 py-0.5 text-10 font-medium tracking-wide text-secondary/70 uppercase">Export</div>
              {/* The spreadsheets first. A picture answers "when"; a funder,
                  a grant report and a planning meeting all want rows. */}
              <button
                type="button"
                onClick={() => {
                  close();
                  exportTable("xlsx", "view");
                }}
                title="One row per project, plus the work items of every project you have expanded"
                className={menuRow}
              >
                <Table2 className="size-3.5 text-secondary" />
                <span>
                  Excel — this view
                  <span className="block text-11 text-tertiary">Folders, order and expansions as on screen</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  exportTable("csv", "view");
                }}
                className={menuRow}
              >
                <FileSpreadsheet className="size-3.5 text-secondary" />
                CSV — this view
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  exportTable("xlsx", "all");
                }}
                title="One row per project in scope, whatever is folded"
                className={menuRow}
              >
                <Table2 className="size-3.5 text-secondary" />
                Excel — every project
              </button>
              <div className="my-1 h-px bg-layer-2" />
              <button
                type="button"
                onClick={() => {
                  close();
                  void exportTimeline("png");
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
                  void exportTimeline("svg");
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

      <PublishedLinksModal isOpen={publishedOpen} onClose={() => setPublishedOpen(false)} />

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
          {/* The sentence, from the server's own counts. The old hint fired on
              `crossEdges.length === 0` and said one thing for four different
              situations — and said nothing at all in the case that most needed
              it, where the chain was empty but some links did exist. */}
          {portfolio.criticalDiagnostics && (
            <span
              className={cn({
                "text-warning-primary":
                  criticalPathMessage(portfolio.criticalDiagnostics, portfolio.criticalIssueIds.size).tone === "warn",
              })}
            >
              {criticalPathMessage(portfolio.criticalDiagnostics, portfolio.criticalIssueIds.size).text}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
