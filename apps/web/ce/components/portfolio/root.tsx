/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import type { IBlockUpdateData, IBlockUpdateDependencyData } from "@plane/types";
import { GANTT_TIMELINE_TYPE } from "@plane/types";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { IssueService } from "@/services/issue";
import { GanttChartRoot } from "@/components/gantt-chart";
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
import { useUser } from "@/hooks/store/user";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { GanttColorScaleProvider } from "@/plane-web/components/gantt-chart/color-scale";
import { GanttLegend, type TLegendMark } from "@/plane-web/components/gantt-chart/legend";
import { ganttDisplay } from "@/plane-web/store/gantt-display";
import type { TPortfolioColorBy } from "@/plane-web/types/arribada";
import type { TPortfolioDateUpdate, TPortfolioDragContext } from "./drag-target";
import { canMovePortfolioRow, describeRefusal, routePortfolioDrag } from "./drag-target";
import { PortfolioBar } from "./bar";
import { isSeriesDimension, PORTFOLIO_SUMMARY_COLOR } from "./color";
import { usePortfolioColorScale } from "./use-portfolio-color";
import { PortfolioSidebar } from "./sidebar";
import { PortfolioToolbar } from "./toolbar";

// Reuses Plane's gantt-chart via the (previously dummy) PROJECT timeline slot.
// The whole project->task hierarchy lives in `ganttBlockIds`; the component just
// draws the flat list it's given, so expand/collapse needs no core changes.
const service = new ArribadaService();
const issueService = new IssueService();

export const PortfolioTimelineRoot = observer(function PortfolioTimelineRoot() {
  const { workspaceSlug } = useParams();
  const searchParams = useSearchParams();
  const folderParam = searchParams?.get("folder") ?? null;
  const portfolio = usePortfolio();
  const { data: currentUser } = useUser();
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.PROJECT);

  useEffect(() => {
    initGantt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    portfolio.setMeUserId(currentUser?.id ?? null);
  }, [currentUser?.id, portfolio]);

  // reset the critical-path toggle on leave, so its singleton state can't linger
  useEffect(() => () => portfolio.setShowCriticalPath("", false), [portfolio]);

  // folder-scoped portfolio: ?folder=<id> shows only that folder's projects
  useEffect(() => {
    portfolio.setFocusFolder(folderParam);
  }, [folderParam, portfolio]);

  useEffect(() => {
    if (workspaceSlug) portfolio.fetchPortfolio(workspaceSlug.toString());
  }, [workspaceSlug, portfolio]);

  // The dependency edges arrive with the board, not with the critical-path switch.
  // They were loaded only by that toggle and drawn only in that mode, so a portfolio
  // of six projects showed no dependencies at all until somebody happened to press
  // a button whose label says nothing about showing them.
  useEffect(() => {
    if (workspaceSlug) void portfolio.fetchCriticalPath(workspaceSlug.toString());
  }, [workspaceSlug, portfolio]);

  /**
   * What each row on this board is, and who is allowed to move it.
   *
   * A portfolio spans many projects and every one of them carries its own
   * `timeline_locked`, so "may this bar move" has a different answer per row —
   * which is exactly why the gantt's `enable*` props accept a function. It used
   * to be passed a bare `true` for every row on the board, including the folder
   * bands and including projects whose plans are frozen.
   */
  const dragContext = useMemo<TPortfolioDragContext>(
    () => ({
      kindOf: (id) => {
        if (portfolio.isFolderRow(id)) return "folder";
        if (portfolio.isProjectRow(id)) return "project";
        return portfolio.getItem(id) ? "item" : "unknown";
      },
      projectOf: (id) => portfolio.getRowProjectId(id),
      isProjectLocked: (projectId) => !!portfolio.getProject(projectId)?.timeline_locked,
    }),
    [portfolio]
  );

  const canMoveRow = useCallback((blockId: string) => canMovePortfolioRow(blockId, dragContext), [dragContext]);

  /**
   * A dragged or resized bar's new dates, written where they belong.
   *
   * THE BUG THIS FIXES. The board passed `blockUpdateHandler` and nothing else,
   * and `blockUpdateHandler` is not what a bar drag calls — it is reached only by
   * the add-block affordance and by the sidebar's reorder helper. The drag
   * persists through `updateBlockDates` (`use-gantt-resizable.ts`), which was
   * `undefined` here, so `if (updateBlockDates)` skipped it. The bar followed the
   * mouse, `setIsDragging(false)` re-armed the store's autorun, `updateBlocks`
   * recomputed the position from dates that had never changed, and the bar
   * snapped back. Nothing was written, nothing failed, and nothing was said —
   * which is precisely what "I can't even extend it" looks like from the outside.
   *
   * Three destinations, because this list holds three kinds of row:
   *
   * * a PROJECT row writes `ProjectSchedule`'s start/target — the PLANNED window
   *   and only that. The derived dates beside it come from the work items, and
   *   the gap between the two is the entire reading of this board.
   * * an ITEM row writes the issue's own dates, through the same endpoint the
   *   per-project timeline uses. That endpoint is scoped to one project, so a
   *   gesture spanning two is two requests — see `routePortfolioDrag`.
   * * a FOLDER band has no dates and is refused.
   *
   * There is still no dependency DRAWING here, and that is deliberate: the edges
   * this board shows come from the workspace critical-path read, which spans
   * projects, while creating one needs the per-project relation store the
   * portfolio never loads. The arrows are a report, not a control.
   */
  const updateBlockDates = useCallback(
    async (updates: IBlockUpdateDependencyData[]) => {
      const slug = workspaceSlug?.toString();
      if (!slug) return;

      const route = routePortfolioDrag(updates as TPortfolioDateUpdate[], dragContext);
      const complaint = describeRefusal(route.refused);
      if (complaint) setToast({ type: TOAST_TYPE.ERROR, title: "That one didn't move", message: complaint });
      if (route.projects.length === 0 && route.itemsByProject.length === 0) return;

      // Optimistic, then corrected — the same shape the per-project timeline uses,
      // so a bar never hangs in mid-air waiting for a round trip.
      const rollbacks: (() => void)[] = [];
      const writes: Promise<unknown>[] = [];

      for (const update of route.projects) {
        const before = portfolio.getProject(update.id);
        const dates = { start_date: update.start_date, target_date: update.target_date };
        portfolio.applyProjectDates(update.id, dates);
        if (before)
          rollbacks.push(() =>
            portfolio.applyProjectDates(update.id, {
              start_date: before.start_date ?? null,
              target_date: before.target_date ?? null,
            })
          );
        writes.push(service.updateSchedule(slug, update.id, dates));
      }

      for (const group of route.itemsByProject) {
        for (const update of group.updates) {
          const before = portfolio.getItem(update.id);
          portfolio.applyItemDates(update.id, {
            start_date: update.start_date,
            target_date: update.target_date,
          });
          if (before)
            rollbacks.push(() =>
              portfolio.applyItemDates(update.id, {
                start_date: before.start_date ?? null,
                target_date: before.target_date ?? null,
              })
            );
        }
        writes.push(issueService.updateIssueDates(slug, group.projectId, group.updates));
      }

      try {
        await Promise.all(writes);
      } catch {
        for (const undo of rollbacks) undo();
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Couldn't move it",
          message: "The dates were put back as they were.",
        });
      }
    },
    [workspaceSlug, portfolio, dragContext]
  );

  /**
   * Giving an undated row its first window, from the "+" affordance on an empty
   * row. Signature is the gantt's, not ours: it hands over the block's DATA, not
   * its id — passing a project id here was a latent crash that only stayed
   * harmless because `enableAddBlock` was never switched on.
   */
  const setProjectWindow = useCallback(
    async (block: { id?: string } | undefined, payload: IBlockUpdateData) => {
      const slug = workspaceSlug?.toString();
      const projectId = block?.id;
      if (!slug || !projectId || !portfolio.isProjectRow(projectId)) return;
      const dates: { start_date?: string; target_date?: string } = {};
      if (payload.start_date) dates.start_date = payload.start_date;
      if (payload.target_date) dates.target_date = payload.target_date;
      if (Object.keys(dates).length === 0) return;

      const before = portfolio.getProject(projectId);
      portfolio.applyProjectDates(projectId, dates);
      try {
        await service.updateSchedule(slug, projectId, dates);
      } catch {
        if (before) {
          portfolio.applyProjectDates(projectId, {
            start_date: before.start_date ?? null,
            target_date: before.target_date ?? null,
          });
        }
        setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't set those dates", message: "The project is unchanged." });
      }
    },
    [workspaceSlug, portfolio]
  );

  /**
   * The colour scale for the whole board.
   *
   * Its domain is every item the board has LOADED — not the rows currently
   * drawn — so folding a project shut or filtering to one priority cannot
   * repaint the bars that survive. `showCompleted` rides on the shared gantt
   * display store rather than a portfolio-only flag: "show me what is finished"
   * is one preference a person holds about timelines, not two, and that store
   * already persists per workspace.
   */
  const loadedItems = useMemo(() => Object.values(portfolio.itemMap), [portfolio.itemMap]);
  const colorContext = usePortfolioColorScale(
    loadedItems,
    portfolio.colorBy as TPortfolioColorBy,
    ganttDisplay.showCompleted
  );

  /**
   * The marks: things drawn ON TOP of a bar regardless of which series it is in.
   * They answer a different question from the series swatches, which is why the
   * legend keeps the two groups apart with a rule.
   */
  const legendMarks = useMemo(() => {
    const series = isSeriesDimension(portfolio.colorBy as TPortfolioColorBy);
    const marks: TLegendMark[] = [];
    if (ganttDisplay.showCompleted) {
      marks.push({
        key: "done",
        label: "Finished",
        kind: "hatch",
        color: "#64748b",
        title: "Hatched, with a tick. Every item in a project is done, or the work item's state is a done state.",
      });
      // Work items only: a project has no state of its own to be cancelled in,
      // and its done-ness is counted from its items. Drawn identically to the
      // work-item timeline, which is the parity rule for this board.
      marks.push({
        key: "cancelled",
        label: "Cancelled",
        kind: "hollow",
        color: "#64748b",
        title:
          "Outlined and struck through, with a ✕ — the work item was abandoned. It keeps its span and loses its fill, so it no longer reads as work in the plan.",
      });
    }
    marks.push({
      key: "summary",
      label: "Project summary",
      kind: "line",
      color: PORTFOLIO_SUMMARY_COLOR,
      // Two readings of the same grey, and which one is true depends on the axis.
      title: series
        ? "A project has no sprint, assignee or priority of its own — so it is not in any series on this axis."
        : "One hue per project. Every bar carries its own name, so this needs no legend of its own.",
    });
    marks.push({
      key: "derived",
      label: "Dates inferred from the work",
      kind: "dashed",
      color: "#94a3b8",
      title: "Nobody entered a plan for this project; the bar is the span of its work items.",
    });
    if (portfolio.showCriticalPath)
      marks.push({ key: "critical", label: "Critical path", kind: "ring", color: "#dc2626" });
    return marks;
    // showCompleted is read here, so it must be a dependency: without it the
    // legend kept claiming a hatch that the bars had stopped drawing.
    //
    // `oxlint --fix` deleted it once, because it is read through the MobX store
    // rather than named directly in this closure and the rule cannot see that.
    // The disable is what stops the next --fix run doing it again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio.colorBy, portfolio.showCriticalPath, ganttDisplay.showCompleted]);

  return (
    <GanttColorScaleProvider value={colorContext}>
      <div className="flex h-full w-full flex-col">
        <PortfolioToolbar />
        {/* Mandatory the moment the colour means something. Without it the hues
            are a puzzle rather than an encoding, and there is nowhere on a bar to
            write "this teal one is Ruby". */}
        <GanttLegend
          scale={isSeriesDimension(portfolio.colorBy as TPortfolioColorBy) ? colorContext.scale : null}
          dimensionLabel={colorContext.dimensionLabel}
          marks={legendMarks}
        />
        {/* An empty portfolio and a portfolio that could not be read draw the
            same blank board. Only one of them is a statement about the work, so
            the other has to say so before anybody reads the emptiness as news. */}
        {portfolio.loadFailed && (
          <div
            role="alert"
            className="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-danger-strong/40 px-4 py-2 text-12"
          >
            <span className="text-secondary">
              <span className="font-medium text-primary">This board could not be loaded.</span> Nothing below is a
              statement about your projects — an empty timeline here means the request failed, not that there is no
              work.
            </span>
            <button
              type="button"
              onClick={() => workspaceSlug && void portfolio.fetchPortfolio(workspaceSlug.toString())}
              className="text-accent-primary hover:underline"
            >
              Try again
            </button>
          </div>
        )}
        {/* PARITY WITH THE WORK-ITEM TIMELINE.
            Same gesture, same rules, same refusals — drag, both resize edges,
            per-row permission, the lock, optimistic write with rollback, and a
            sentence when something is refused. Four differences remain and each
            is deliberate:

            * NO DEPENDENCY HANDLES. The arrows on this board come from the
              workspace critical-path read, which spans projects; creating one
              needs the per-project relation store the portfolio never loads, and
              a project row has no relation to draw at all. They are a report here,
              not a control.
            * NO BULK SELECTION. Every bulk operation is project-scoped, and half
              the rows on this board are projects rather than work items.
            * NO PUSH-DEPENDENTS. It reads the project's own relation graph, which
              this board does not hold. A cross-project push is the feature it
              would have to become, and that is a decision about scope, not a
              missing prop.
            * NO QUICK-ADD. There is no "the project this belongs to" here.

            Everything else that differed was an accident and is fixed. */}
        <div className="relative flex-grow overflow-hidden">
          <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.PROJECT}>
            <GanttChartRoot
              title="Portfolio"
              loaderTitle="projects"
              blockIds={portfolio.ganttBlockIds}
              blockUpdateHandler={setProjectWindow}
              // Per row, not per board: a folder band has no dates and a project
              // whose plan is locked must refuse the gesture here exactly as it
              // does on its own timeline.
              enableBlockLeftResize={canMoveRow}
              enableBlockRightResize={canMoveRow}
              enableBlockMove={canMoveRow}
              // What a bar drag actually persists through. Its absence is why
              // nothing on this board could be moved — see updateBlockDates.
              updateBlockDates={updateBlockDates}
              // The "+" on an empty row, so a project with no planned window can
              // be given one here instead of only inside the project.
              enableAddBlock={(blockId: string) => portfolio.isProjectRow(blockId) && canMoveRow(blockId)}
              blockToRender={(data: { id: string }) => <PortfolioBar blockId={data.id} />}
              sidebarToRender={(props: { blockIds: string[] }) => <PortfolioSidebar blockIds={props.blockIds} />}
              showAllBlocks
              showToday
            />
          </TimeLineTypeContext.Provider>
        </div>
      </div>
      {/* self-fetching and null until something is peeked, so it can mount unconditionally */}
      <IssuePeekOverview />
    </GanttColorScaleProvider>
  );
});
