/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Folder,
  GanttChartSquare,
  GripVertical,
  Signal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Loader, Tooltip } from "@plane/ui";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectStatusUpdate } from "@/plane-web/types/arribada";
import { baselineDrift, projectColor, projectHealth } from "./colors";
import { ProjectStatusModal, STATUS_META } from "./project-status-modal";
import { UndatedItemsModal } from "./undated-items-modal";

// transient drag source id — plain module var, DnD is a same-frame gesture
let dragId: string | null = null;

type RowProps = {
  blockId: string;
  status?: TProjectStatusUpdate;
  onOpenStatus: (projectId: string) => void;
  onOpenUndated: (projectId: string) => void;
};

const PortfolioSidebarRow = observer(function PortfolioSidebarRow({
  blockId,
  status,
  onOpenStatus,
  onOpenUndated,
}: RowProps) {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const portfolio = usePortfolio();
  const { setPeekIssue } = useIssueDetail();
  const isProject = portfolio.isProjectRow(blockId);
  const folder = portfolio.getFolderRow(blockId);
  const project = portfolio.getProject(blockId);
  const item = portfolio.getItem(blockId);
  const isExpanded = portfolio.expandedProjectIds.has(blockId);
  // Only drag in manual mode: under a date/name sort the visible order differs from
  // displayedProjectIds, so a drop would reshuffle into an order the user never saw.
  const canDrag = isProject && portfolio.sortBy === "manual";

  return (
    <div
      className="group flex w-full items-center gap-1.5 pr-4 hover:bg-layer-transparent-hover"
      style={{ height: `${BLOCK_HEIGHT}px` }}
      draggable={canDrag}
      onDragStart={() => {
        if (canDrag) dragId = blockId;
      }}
      onDragOver={(e) => {
        if (canDrag && dragId && dragId !== blockId) e.preventDefault();
      }}
      onDrop={() => {
        if (canDrag && dragId) portfolio.moveProject(dragId, blockId);
        dragId = null;
      }}
      onDragEnd={() => {
        dragId = null;
      }}
    >
      {folder ? (
        <div className="flex h-full w-full items-center gap-1.5 bg-layer-2/60 px-1">
          <button
            type="button"
            onClick={() => portfolio.toggleFolderCollapse(blockId)}
            className="flex flex-grow items-center gap-1.5 text-left"
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
          {blockId !== "__folder__:none" && (
            <button
              type="button"
              title="Open only this folder"
              onClick={() =>
                workspaceSlug &&
                router.push(`/${workspaceSlug}/portfolio?folder=${blockId.slice("__folder__:".length)}`)
              }
              className="mr-1 flex-shrink-0 rounded p-0.5 text-tertiary opacity-0 group-hover:opacity-100 hover:bg-layer-1 hover:text-secondary"
            >
              <GanttChartSquare className="size-3.5" />
            </button>
          )}
        </div>
      ) : isProject ? (
        <>
          <GripVertical
            className={cn(
              "size-3.5 flex-shrink-0 cursor-grab text-tertiary opacity-0",
              canDrag && "group-hover:opacity-100"
            )}
          />
          <button
            type="button"
            className="flex size-5 flex-shrink-0 items-center justify-center rounded text-secondary hover:bg-layer-1"
            onClick={() => workspaceSlug && portfolio.toggleProjectExpansion(workspaceSlug.toString(), blockId)}
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <span className="size-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: projectColor(blockId) }} />
          {project &&
            (() => {
              const h = projectHealth(project);
              return h ? (
                <Tooltip tooltipContent={h.label}>
                  <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: h.color }} />
                </Tooltip>
              ) : null;
            })()}
          <button
            type="button"
            onClick={() => router.push(`/${workspaceSlug}/projects/${blockId}/overview`)}
            title="Open project"
            className="flex-grow truncate text-left text-13 font-medium text-primary hover:text-accent-primary hover:underline"
          >
            {project?.name}
          </button>
          <Tooltip
            tooltipContent={
              status
                ? `${STATUS_META[status.status]?.label}${status.message ? ` — ${status.message}` : ""}`
                : "Set status"
            }
          >
            <button
              type="button"
              onClick={() => onOpenStatus(blockId)}
              className="flex size-5 flex-shrink-0 items-center justify-center rounded hover:bg-layer-1"
            >
              {status ? (
                <span className={cn("size-2.5 rounded-full", STATUS_META[status.status]?.dot)} />
              ) : (
                <Signal className="size-3 text-tertiary opacity-0 group-hover:opacity-100" />
              )}
            </button>
          </Tooltip>
          {project && project.item_count > 0 && (
            <Tooltip tooltipContent={`${project.completed_item_count ?? 0}/${project.item_count} done`}>
              <span className="flex flex-shrink-0 items-center gap-1">
                <span className="h-1 w-8 overflow-hidden rounded-full bg-layer-2">
                  <span
                    className="block h-full rounded-full bg-success-primary"
                    style={{
                      width: `${Math.round(((project.completed_item_count ?? 0) / project.item_count) * 100)}%`,
                    }}
                  />
                </span>
                <span className="w-7 text-right text-11 text-secondary">
                  {Math.round(((project.completed_item_count ?? 0) / project.item_count) * 100)}%
                </span>
              </span>
            </Tooltip>
          )}
          {project &&
            (() => {
              const drift = baselineDrift(project);
              if (drift === null) return null;
              const slipped = drift > 0;
              return (
                <Tooltip tooltipContent={`${slipped ? "Slipped" : "Ahead"} ${Math.abs(drift)}d vs baseline`}>
                  <span
                    className={cn(
                      "flex flex-shrink-0 items-center gap-0.5 rounded px-1 text-11 font-medium",
                      slipped ? "bg-danger-subtle text-danger-primary" : "bg-success-subtle text-success-primary"
                    )}
                  >
                    {slipped ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {Math.abs(drift)}d
                  </span>
                </Tooltip>
              );
            })()}
          <span className="flex-shrink-0 text-11 text-secondary">{project?.item_count ?? 0}</span>
          {!!project?.undated_item_count && (
            <Tooltip
              tooltipContent={`${project.undated_item_count} work item(s) with no dates — click to give them dates`}
            >
              <button
                type="button"
                onClick={() => onOpenUndated(blockId)}
                className="flex flex-shrink-0 items-center gap-0.5 rounded bg-warning-subtle px-1 text-11 text-warning-primary hover:opacity-80"
              >
                <AlertTriangle className="size-3" />
                {project.undated_item_count}
              </button>
            </Tooltip>
          )}
        </>
      ) : (
        <button
          type="button"
          // TPortfolioItem carries no project_id — the owner has to come from the store
          onClick={() => {
            const projectId = portfolio.getRowProjectId(blockId);
            if (workspaceSlug && projectId)
              setPeekIssue({ workspaceSlug: workspaceSlug.toString(), projectId, issueId: blockId });
          }}
          className="flex flex-grow items-center gap-2 truncate pl-8 text-left"
        >
          <span className="flex-grow truncate text-13 text-secondary hover:text-primary">{item?.name}</span>
        </button>
      )}
    </div>
  );
});

type Props = { blockIds: string[] };

export const PortfolioSidebar = observer(function PortfolioSidebar({ blockIds }: Props) {
  const { workspaceSlug } = useParams();
  const portfolio = usePortfolio();
  const service = useMemo(() => new ArribadaService(), []);
  const [statuses, setStatuses] = useState<Record<string, TProjectStatusUpdate>>({});
  const [statusProjectId, setStatusProjectId] = useState<string | null>(null);
  const [undatedProjectId, setUndatedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    service
      .getWorkspaceStatuses(workspaceSlug.toString())
      .then((r) => setStatuses(r || {}))
      .catch(() => setStatuses({}));
  }, [workspaceSlug, service]);

  const statusProjectName = statusProjectId ? portfolio.getProject(statusProjectId)?.name : undefined;
  const undatedProjectName = undatedProjectId ? portfolio.getProject(undatedProjectId)?.name : undefined;

  return (
    <div className="h-full">
      {blockIds ? (
        blockIds.map((blockId) => (
          <PortfolioSidebarRow
            key={blockId}
            blockId={blockId}
            status={statuses[blockId]}
            onOpenStatus={setStatusProjectId}
            onOpenUndated={setUndatedProjectId}
          />
        ))
      ) : (
        <Loader className="space-y-3 pr-2">
          <Loader.Item height="34px" />
          <Loader.Item height="34px" />
          <Loader.Item height="34px" />
        </Loader>
      )}
      <ProjectStatusModal
        projectId={statusProjectId}
        projectName={statusProjectName}
        onClose={() => setStatusProjectId(null)}
        onPosted={(pid, update) => setStatuses((s) => ({ ...s, [pid]: update }))}
      />
      <UndatedItemsModal
        // remount per project: none of the previous project's rows or drafts survive
        key={undatedProjectId ?? "none"}
        projectId={undatedProjectId}
        projectName={undatedProjectName}
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
    </div>
  );
});
