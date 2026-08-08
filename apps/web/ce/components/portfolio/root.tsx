/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import type { IBlockUpdateData } from "@plane/types";
import { GANTT_TIMELINE_TYPE } from "@plane/types";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { GanttChartRoot } from "@/components/gantt-chart";
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
import { useUser } from "@/hooks/store/user";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { PortfolioBar } from "./bar";
import { PortfolioSidebar } from "./sidebar";
import { PortfolioToolbar } from "./toolbar";

// Reuses Plane's gantt-chart via the (previously dummy) PROJECT timeline slot.
// The whole project->task hierarchy lives in `ganttBlockIds`; the component just
// draws the flat list it's given, so expand/collapse needs no core changes.
const service = new ArribadaService();

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
   * A project's planned window, dragged or resized on the portfolio timeline.
   *
   * The board was read-only for no better reason than that its update handler was
   * a stub — so a lead could see a project's promised dates were wrong and had to
   * go into the project to fix them. Same gesture as the work-item timeline now,
   * which is the point: two timelines that behave differently teach people to
   * distrust both.
   *
   * What it writes is ProjectSchedule's start/target — the PLANNED window, and
   * only that. The derived dates beside them come from the work items, and the
   * gap between the two is the entire reading of this board.
   *
   * There is no dependency drawing here and that is not an omission: a
   * dependency is a relation between work ITEMS, and nothing in the schema says
   * one project blocks another. Inventing one on this screen would produce an
   * arrow the planner cannot honour.
   */
  const updateProjectWindow = async (projectId: string, payload: IBlockUpdateData) => {
    if (!workspaceSlug) return;
    const dates: { start_date?: string; target_date?: string } = {};
    if (payload.start_date) dates.start_date = payload.start_date;
    if (payload.target_date) dates.target_date = payload.target_date;
    if (Object.keys(dates).length === 0) return;

    const before = portfolio.getProject(projectId);
    portfolio.applyProjectDates(projectId, dates);
    try {
      await service.updateSchedule(workspaceSlug.toString(), projectId, dates);
    } catch {
      if (before) {
        portfolio.applyProjectDates(projectId, {
          start_date: before.start_date ?? null,
          target_date: before.target_date ?? null,
        });
      }
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't move it", message: "The project kept its dates." });
    }
  };

  return (
    <>
      <div className="flex h-full w-full flex-col">
        <PortfolioToolbar />
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
        <div className="relative flex-grow overflow-hidden">
          <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.PROJECT}>
            <GanttChartRoot
              title="Portfolio"
              loaderTitle="projects"
              blockIds={portfolio.ganttBlockIds}
              blockUpdateHandler={updateProjectWindow}
              enableBlockLeftResize
              enableBlockRightResize
              enableBlockMove
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
    </>
  );
});
