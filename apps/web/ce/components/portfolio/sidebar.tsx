/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight, AlertTriangle, GripVertical } from "lucide-react";
import { Loader, Tooltip } from "@plane/ui";
import { cn } from "@plane/utils";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { projectColor } from "./colors";

// transient drag source id — plain module var, DnD is a same-frame gesture
let dragId: string | null = null;

type RowProps = { blockId: string };

const PortfolioSidebarRow = observer(function PortfolioSidebarRow({ blockId }: RowProps) {
  const { workspaceSlug } = useParams();
  const portfolio = usePortfolio();
  const isProject = portfolio.isProjectRow(blockId);
  const project = portfolio.getProject(blockId);
  const item = portfolio.getItem(blockId);
  const isExpanded = portfolio.expandedProjectIds.has(blockId);

  return (
    <div
      className="group flex w-full items-center gap-1.5 pr-4 hover:bg-layer-transparent-hover"
      style={{ height: `${BLOCK_HEIGHT}px` }}
      draggable={isProject}
      onDragStart={() => {
        if (isProject) dragId = blockId;
      }}
      onDragOver={(e) => {
        if (isProject && dragId && dragId !== blockId) e.preventDefault();
      }}
      onDrop={() => {
        if (isProject && dragId) portfolio.moveProject(dragId, blockId);
        dragId = null;
      }}
    >
      {isProject ? (
        <>
          <GripVertical className="size-3.5 flex-shrink-0 cursor-grab text-tertiary opacity-0 group-hover:opacity-100" />
          <button
            type="button"
            className="flex size-5 flex-shrink-0 items-center justify-center rounded text-secondary hover:bg-layer-1"
            onClick={() => workspaceSlug && portfolio.toggleProjectExpansion(workspaceSlug.toString(), blockId)}
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <span
            className="size-2.5 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: projectColor(blockId) }}
          />
          <span className="flex-grow truncate text-13 font-medium text-primary">{project?.name}</span>
          <span className="flex-shrink-0 text-11 text-secondary">{project?.item_count ?? 0}</span>
          {!!project?.undated_item_count && (
            <Tooltip tooltipContent={`${project.undated_item_count} work item(s) with no dates`}>
              <span className="flex flex-shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 text-11 text-amber-600">
                <AlertTriangle className="size-3" />
                {project.undated_item_count}
              </span>
            </Tooltip>
          )}
        </>
      ) : (
        <div className={cn("flex flex-grow items-center gap-2 truncate pl-8")}>
          <span className="flex-grow truncate text-13 text-secondary">{item?.name}</span>
        </div>
      )}
    </div>
  );
});

type Props = { blockIds: string[] };

export const PortfolioSidebar = observer(function PortfolioSidebar({ blockIds }: Props) {
  return (
    <div className="h-full">
      {blockIds ? (
        blockIds.map((blockId) => <PortfolioSidebarRow key={blockId} blockId={blockId} />)
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
