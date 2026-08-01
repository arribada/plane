/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { Loader, Tooltip } from "@plane/ui";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useAppRouter } from "@/hooks/use-app-router";
import { projectColor } from "@/plane-web/components/portfolio/colors";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";

type RowProps = {
  blockId: string;
  /** Flat mode has no project header above a task, so the task carries its own. */
  showProjectOnItems: boolean;
};

// The portfolio's row renderer with everything a personal board has no use for taken
// out: no drag handle (nothing to reorder — the rows are one person's work, not a
// plan), no status pill, no undated badge (undated items are never in this row set,
// they are counted in the toolbar) and no modals.
const MyTimelineSidebarRow = observer(function MyTimelineSidebarRow({ blockId, showProjectOnItems }: RowProps) {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const portfolio = usePortfolio();
  const { setPeekIssue } = useIssueDetail();

  const folder = portfolio.getFolderRow(blockId);
  const isProject = portfolio.isProjectRow(blockId);
  const project = portfolio.getProject(blockId);
  const item = portfolio.getItem(blockId);
  const isExpanded = portfolio.expandedProjectIds.has(blockId);
  const rowCount = isProject ? (portfolio.itemIdsByProject.get(blockId)?.length ?? 0) : 0;

  const ownerProjectId = !isProject && !folder ? portfolio.getRowProjectId(blockId) : undefined;
  const ownerProject = ownerProjectId ? portfolio.getProject(ownerProjectId) : undefined;

  return (
    <div
      className="group flex w-full items-center gap-1.5 pr-4 hover:bg-layer-transparent-hover"
      style={{ height: `${BLOCK_HEIGHT}px` }}
    >
      {folder ? (
        <button
          type="button"
          onClick={() => portfolio.toggleFolderCollapse(blockId)}
          className="flex h-full w-full items-center gap-1.5 bg-layer-2/60 px-1 text-left"
        >
          {folder.collapsed ? (
            <ChevronRight className="size-4 text-secondary" />
          ) : (
            <ChevronDown className="size-4 text-secondary" />
          )}
          <Folder className="size-3.5 flex-shrink-0 text-secondary" />
          <span className="truncate text-13 font-semibold tracking-wide text-primary uppercase">{folder.name}</span>
          <span className="rounded bg-layer-2 px-1.5 text-11 text-secondary">{folder.projectCount}</span>
        </button>
      ) : isProject ? (
        <>
          <button
            type="button"
            title={isExpanded ? "Collapse" : "Expand"}
            className="ml-1 flex size-5 flex-shrink-0 items-center justify-center rounded text-secondary hover:bg-layer-1"
            // Every project on this board arrived fully loaded, so this only ever
            // folds rows away — it can never pull in somebody else's work items.
            onClick={() => workspaceSlug && portfolio.toggleProjectExpansion(workspaceSlug.toString(), blockId)}
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <span className="size-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: projectColor(blockId) }} />
          <button
            type="button"
            onClick={() => router.push(`/${workspaceSlug}/projects/${blockId}/overview`)}
            title="Open project"
            className="flex-grow truncate text-left text-13 font-medium text-primary hover:text-accent-primary hover:underline"
          >
            {project?.name}
          </button>
          <Tooltip tooltipContent={`${rowCount} dated work item(s) here`}>
            <span className="flex-shrink-0 text-11 text-secondary">{rowCount}</span>
          </Tooltip>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (workspaceSlug && ownerProjectId)
              setPeekIssue({ workspaceSlug: workspaceSlug.toString(), projectId: ownerProjectId, issueId: blockId });
          }}
          className={`flex flex-grow items-center gap-2 truncate text-left ${showProjectOnItems ? "pl-2" : "pl-8"}`}
        >
          {showProjectOnItems && ownerProjectId && (
            <span
              className="size-2 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: projectColor(ownerProjectId) }}
            />
          )}
          <span className="flex-grow truncate text-13 text-secondary hover:text-primary">{item?.name}</span>
          {showProjectOnItems && ownerProject && (
            <span className="flex-shrink-0 rounded bg-layer-2 px-1 text-10 tracking-wide text-secondary uppercase">
              {ownerProject.identifier}
            </span>
          )}
        </button>
      )}
    </div>
  );
});

type Props = { blockIds: string[]; showProjectOnItems: boolean };

export const MyTimelineSidebar = observer(function MyTimelineSidebar({ blockIds, showProjectOnItems }: Props) {
  return (
    <div className="h-full">
      {blockIds ? (
        blockIds.map((blockId) => (
          <MyTimelineSidebarRow key={blockId} blockId={blockId} showProjectOnItems={showProjectOnItems} />
        ))
      ) : (
        <Loader className="space-y-3 pr-2">
          <Loader.Item height="34px" />
          <Loader.Item height="34px" />
          <Loader.Item height="34px" />
        </Loader>
      )}
    </div>
  );
});
