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
import { isDarkSurface } from "@/plane-web/components/gantt-chart/palette";
import { baselineDrift, projectColor, projectHealth } from "./colors";
import { INDENT_CAP_LEVELS } from "./grouping";
import { ProjectStatusModal, STATUS_META } from "./project-status-modal";
import { UndatedItemsModal } from "./undated-items-modal";

// transient drag source id — plain module var, DnD is a same-frame gesture
let dragId: string | null = null;

type RowProps = {
  blockId: string;
  status?: TProjectStatusUpdate;
  /** The status fetch failed, so an absent pastille means "unknown", not "nobody
   *  has posted an update". Carried per row rather than banner-ed at the top of
   *  the sidebar: these rows line up one-for-one with the bars beside them, and
   *  anything inserted above would slide the whole board out of register. */
  statusesFailed?: boolean;
  onOpenStatus: (projectId: string) => void;
  onOpenUndated: (projectId: string) => void;
};

const PortfolioSidebarRow = observer(function PortfolioSidebarRow({
  blockId,
  status,
  statusesFailed,
  onOpenStatus,
  onOpenUndated,
}: RowProps) {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const portfolio = usePortfolio();
  // Theme resolved once per render; the health pastille picks its danger red from it.
  const dark = isDarkSurface();
  const { setPeekIssue } = useIssueDetail();
  const isProject = portfolio.isProjectRow(blockId);
  const folder = portfolio.getFolderRow(blockId);
  const subgroup = portfolio.getSubgroupRow(blockId);
  const project = portfolio.getProject(blockId);
  const item = portfolio.getItem(blockId);
  const isExpanded = portfolio.expandedProjectIds.has(blockId);
  // Draggable under any sort and any grouping. It used to be manual-only, because
  // a drop wrote into `displayedProjectIds` — an order nobody was looking at — and
  // the whole board jumped. `moveProject` now takes the visible sequence as the
  // order and applies the move to that, so the drag can just be offered.
  const canDrag = isProject;
  const subtaskNode = portfolio.nestSubtasks ? portfolio.itemSubtaskTree.byId.get(blockId) : undefined;
  const subtaskDepth = subtaskNode?.depth ?? 0;
  const subtaskChildren = subtaskNode?.childIds.length ?? 0;
  const itemCollapsed = portfolio.isItemCollapsed(blockId);

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
          {/* Only a real folder can be focused. A status band is a view of a
              field, and there is no URL that means "the portfolio, off track". */}
          {blockId.startsWith("__folder__:") && blockId !== "__folder__:none" && (
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
      ) : subgroup ? (
        // A band INSIDE one project. Deliberately quieter than the folder header
        // above it — indented one step, sentence case, a hairline rather than a
        // filled band — so two levels of banding read as two levels rather than
        // as two competing headers. See the indent scheme in portfolio/grouping.ts.
        <button
          type="button"
          onClick={() => portfolio.toggleSubgroupCollapse(blockId)}
          aria-expanded={!subgroup.collapsed}
          className="flex h-full w-full items-center gap-1.5 border-b-[0.5px] border-subtle bg-layer-2/25 pr-2 pl-3 text-left"
        >
          {subgroup.collapsed ? (
            <ChevronRight className="size-3.5 flex-shrink-0 text-tertiary" />
          ) : (
            <ChevronDown className="size-3.5 flex-shrink-0 text-tertiary" />
          )}
          {subgroup.color && (
            <span
              className="size-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: subgroup.color }}
              aria-hidden
            />
          )}
          <span className="truncate text-12 font-medium text-secondary">{subgroup.label}</span>
          <span className="flex-shrink-0 rounded-full bg-layer-1 px-1.5 text-11 text-tertiary">{subgroup.count}</span>
        </button>
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
              const h = projectHealth(project, dark);
              return h ? (
                <Tooltip tooltipContent={h.label}>
                  <span
                    className="flex size-3.5 flex-shrink-0 items-center justify-center rounded-full text-[9px] leading-none font-bold text-white"
                    style={{ backgroundColor: h.color }}
                    // The label was reachable only by hovering, so it did not exist on
                    // touch and did not exist for a screen reader either.
                    role="img"
                    aria-label={h.label}
                  >
                    {h.glyph}
                  </span>
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
                : statusesFailed
                  ? "The status updates could not be loaded — this project may well have one"
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
                <Signal
                  className={cn(
                    "size-3",
                    // Always visible when the load failed: the hover-only affordance
                    // is what made an unknown status look like a set one.
                    statusesFailed ? "text-danger-primary" : "text-tertiary opacity-0 group-hover:opacity-100"
                  )}
                />
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
        <>
          {/* Sub-task nesting. A portfolio row is already one level in (under its
              project), so the depth from the tree is added to that indent rather
              than replacing it. */}
          <span
            className="flex flex-shrink-0 items-center"
            // The indent scheme, written out in portfolio/grouping.ts: an item
            // sits one step in from its project, one more when there is a
            // subgroup band above it, and one per level of parent nesting —
            // capped, because past four levels an indent stops being an indent
            // and starts being a margin.
            style={{
              paddingLeft: `${(portfolio.subgroupBy === "none" ? 8 : 22) + Math.min(subtaskDepth, INDENT_CAP_LEVELS) * 14}px`,
            }}
          >
            {subtaskChildren > 0 ? (
              <button
                type="button"
                onClick={() => portfolio.toggleItemCollapsed(blockId)}
                aria-expanded={!itemCollapsed}
                aria-label={itemCollapsed ? `Show ${subtaskChildren} sub-tasks` : `Hide ${subtaskChildren} sub-tasks`}
                title={`${subtaskChildren} sub-task${subtaskChildren > 1 ? "s" : ""}`}
                className="relative flex size-4 items-center justify-center rounded text-tertiary after:absolute after:-inset-2 after:content-[''] hover:bg-layer-1 hover:text-secondary"
              >
                {itemCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            ) : (
              // The chevron's width, so a leaf's title lines up with its siblings'.
              <span className="size-4" />
            )}
          </span>
          <button
            type="button"
            // TPortfolioItem carries no project_id — the owner has to come from the store
            onClick={() => {
              const projectId = portfolio.getRowProjectId(blockId);
              if (workspaceSlug && projectId)
                setPeekIssue({ workspaceSlug: workspaceSlug.toString(), projectId, issueId: blockId });
            }}
            className="flex flex-grow items-center gap-2 truncate text-left"
          >
            <span className="flex-grow truncate text-13 text-secondary hover:text-primary">{item?.name}</span>
          </button>
        </>
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
  const [statusesFailed, setStatusesFailed] = useState(false);
  const [statusProjectId, setStatusProjectId] = useState<string | null>(null);
  const [undatedProjectId, setUndatedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    service
      .getWorkspaceStatuses(workspaceSlug.toString())
      .then((r) => {
        setStatuses(r || {});
        // The store needs them too: "group by status" is a band over project
        // rows, and the row list is a store getter. Pushed rather than fetched
        // twice — this component was already the only caller.
        portfolio.setProjectStatuses(
          Object.fromEntries(Object.entries(r || {}).map(([id, value]) => [id, value.status]))
        );
        setStatusesFailed(false);
        return undefined;
      })
      // An empty map draws a row with no pastille, which is exactly how a project
      // nobody has reported on looks. "Nobody has said anything" and "nobody could
      // ask" are opposite readings of the same blank.
      .catch(() => {
        setStatuses({});
        setStatusesFailed(true);
      });
    // `portfolio` is the MobX store — one object for the life of the app, only
    // written to here. Listing it would not change when this runs and would
    // suggest it might.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
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
            statusesFailed={statusesFailed}
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
