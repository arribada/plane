/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import { GANTT_TIMELINE_TYPE } from "@plane/types";
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

  return (
    <>
      <div className="flex h-full w-full flex-col">
        <PortfolioToolbar />
        <div className="relative flex-grow overflow-hidden">
          <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.PROJECT}>
            <GanttChartRoot
              title="Portfolio"
              loaderTitle="projects"
              blockIds={portfolio.ganttBlockIds}
              blockUpdateHandler={() => {}}
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
