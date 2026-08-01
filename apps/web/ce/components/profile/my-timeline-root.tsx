/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, GanttChartSquare } from "lucide-react";
import { GANTT_TIMELINE_TYPE } from "@plane/types";
import { Loader } from "@plane/ui";
import { GanttChartRoot } from "@/components/gantt-chart";
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { useUser } from "@/hooks/store/user";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
import { PortfolioBar } from "@/plane-web/components/portfolio/bar";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { MyTimelineSidebar } from "./my-timeline-sidebar";
import { MyTimelineToolbar, type TTimelineGroupBy } from "./my-timeline-toolbar";

const EmptyBoard = ({ title, hint }: { title: string; hint: string }) => (
  <div className="grid h-full w-full place-items-center px-6 text-center">
    <div className="max-w-md">
      <GanttChartSquare className="mx-auto mb-3 size-8 text-tertiary" />
      <p className="text-14 font-medium text-primary">{title}</p>
      <p className="mt-1 text-13 text-secondary">{hint}</p>
    </div>
  </div>
);

/**
 * One person's work, across every project, on a single timeline.
 *
 * This is the portfolio gantt with a different row set, not a second timeline: same
 * PROJECT timeline slot, same store, same `getRowById`, so cross-project dependency
 * arrows and the today line come along unchanged. Only `fetchUserTimeline` differs —
 * it loads the whole workspace for one assignee in one request instead of one project
 * at a time on expand.
 */
export const MyTimelineRoot = observer(function MyTimelineRoot() {
  const { workspaceSlug, userId } = useParams();
  const portfolio = usePortfolio();
  const { data: currentUser } = useUser();
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.PROJECT);
  const [groupBy, setGroupBy] = useState<TTimelineGroupBy>("project");

  useEffect(() => {
    initGantt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    portfolio.setMeUserId(currentUser?.id ?? null);
  }, [currentUser?.id, portfolio]);

  useEffect(() => {
    if (workspaceSlug && userId) void portfolio.fetchUserTimeline(workspaceSlug.toString(), userId.toString());
  }, [workspaceSlug, userId, portfolio]);

  // Dependency arrows are drawn from the workspace edge set; loading it here is what
  // makes "this task of mine waits on that one" visible without any extra control.
  useEffect(() => {
    if (workspaceSlug) void portfolio.fetchCriticalPath(workspaceSlug.toString());
  }, [workspaceSlug, portfolio]);

  // The view owns the folder switch; the store only remembers it.
  useEffect(() => {
    portfolio.setGroupByFolder(groupBy === "folder");
  }, [groupBy, portfolio]);

  // Not optional. The portfolio store is a singleton on RootStore, so without this
  // /portfolio would open filtered to whoever's profile was last visited.
  useEffect(() => () => portfolio.resetUserFocus(), [portfolio]);

  // Both are computeds, so this hands the gantt a stable reference — no array is
  // minted in render, which is what keeps the block map from rebuilding every pass.
  const blockIds = groupBy === "none" ? portfolio.userItemIds : portfolio.ganttBlockIds;
  const isReady = portfolio.focusUserId === userId?.toString();

  let board: React.ReactNode;
  if (!isReady || (portfolio.isLoading && blockIds.length === 0)) {
    board = (
      <Loader className="space-y-3 p-4">
        <Loader.Item height="34px" />
        <Loader.Item height="34px" />
        <Loader.Item height="34px" />
        <Loader.Item height="34px" />
      </Loader>
    );
  } else if (portfolio.userLoadFailed) {
    board = (
      <EmptyBoard
        title="This timeline could not be loaded"
        hint="The request for this person's work items failed. Reload the page to try again."
      />
    );
  } else if (portfolio.userTotalCount === 0) {
    board = (
      <EmptyBoard
        title="No work items assigned"
        hint="Work items assigned across every project will appear here on one timeline."
      />
    );
  } else if (blockIds.length === 0) {
    board = (
      <EmptyBoard
        title="Nothing to place on a timeline yet"
        hint={
          portfolio.userUndatedCount > 0
            ? `All ${portfolio.userUndatedCount} assigned work item(s) are missing a start or target date, so a timeline has nowhere to draw them. Give them dates and they will show up here.`
            : "None of the assigned work items could be placed on this timeline. They may sit in projects you are not a member of."
        }
      />
    );
  } else {
    board = (
      <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.PROJECT}>
        <GanttChartRoot
          title="Timeline"
          loaderTitle="work items"
          blockIds={blockIds}
          // read-only: no resize, move or reorder is enabled, so nothing here writes
          blockUpdateHandler={() => {}}
          blockToRender={(data: { id: string }) => <PortfolioBar blockId={data.id} />}
          sidebarToRender={(props: { blockIds: string[] }) => (
            <MyTimelineSidebar blockIds={props.blockIds} showProjectOnItems={groupBy === "none"} />
          )}
          showAllBlocks
          showToday
        />
      </TimeLineTypeContext.Provider>
    );
  }

  return (
    <>
      <div className="flex h-full w-full flex-col">
        <MyTimelineToolbar groupBy={groupBy} onGroupByChange={setGroupBy} />
        <div className="relative flex-grow overflow-hidden">{board}</div>
        {portfolio.crossEdges.length > 0 && blockIds.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-subtle px-4 py-1 text-10 text-secondary/70">
            <AlertTriangle className="size-3" />
            Dependency arrows only join two work items that are both on this board — a link to somebody else&apos;s work
            is not drawn.
          </div>
        )}
      </div>
      {/* self-fetching and null until something is peeked, so it can mount unconditionally */}
      <IssuePeekOverview />
    </>
  );
});
