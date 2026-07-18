/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight, AlertTriangle, GripVertical, Signal } from "lucide-react";
import { Loader, Tooltip } from "@plane/ui";
import { cn } from "@plane/utils";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectStatusUpdate } from "@/plane-web/types/arribada";
import { projectColor, projectHealth } from "./colors";
import { ProjectStatusModal, STATUS_META } from "./project-status-modal";

// transient drag source id — plain module var, DnD is a same-frame gesture
let dragId: string | null = null;

type RowProps = {
  blockId: string;
  status?: TProjectStatusUpdate;
  onOpenStatus: (projectId: string) => void;
};

const PortfolioSidebarRow = observer(function PortfolioSidebarRow({ blockId, status, onOpenStatus }: RowProps) {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
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
            onClick={() => router.push(`/${workspaceSlug}/projects/${blockId}/issues/`)}
            title="Open project"
            className="flex-grow truncate text-left text-13 font-medium text-primary hover:text-accent hover:underline"
          >
            {project?.name}
          </button>
          <Tooltip tooltipContent={status ? `${STATUS_META[status.status]?.label}${status.message ? ` — ${status.message}` : ""}` : "Set status"}>
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
  const { workspaceSlug } = useParams();
  const portfolio = usePortfolio();
  const service = useMemo(() => new ArribadaService(), []);
  const [statuses, setStatuses] = useState<Record<string, TProjectStatusUpdate>>({});
  const [statusProjectId, setStatusProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    service
      .getWorkspaceStatuses(workspaceSlug.toString())
      .then((r) => setStatuses(r || {}))
      .catch(() => setStatuses({}));
  }, [workspaceSlug, service]);

  const statusProjectName = statusProjectId ? portfolio.getProject(statusProjectId)?.name : undefined;

  return (
    <div className="h-full">
      {blockIds ? (
        blockIds.map((blockId) => (
          <PortfolioSidebarRow
            key={blockId}
            blockId={blockId}
            status={statuses[blockId]}
            onOpenStatus={setStatusProjectId}
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
    </div>
  );
});
