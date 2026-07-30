/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
// ui
import { MODULE_STATUS } from "@plane/constants";
import { ModuleStatusIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
// components
import { GANTT_SIDEBAR_COLLAPSED_WIDTH } from "@/components/gantt-chart/constants";
import { getBlockViewDetails } from "@/components/issues/issue-layouts/utils";
// constants
// hooks
import { useModule } from "@/hooks/store/use-module";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

type Props = {
  moduleId: string;
};

export const ModuleGanttBlock = observer(function ModuleGanttBlock(props: Props) {
  const { moduleId } = props;
  // router
  const router = useAppRouter();
  const { workspaceSlug } = useParams();
  // store hooks
  const { getModuleById } = useModule();
  const { sidebarWidth, isSidebarCollapsed } = useTimeLineChartStore();
  // derived values
  const moduleDetails = getModuleById(moduleId);
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  // hooks
  const { isMobile } = usePlatformOS();

  const { message, blockStyle } = getBlockViewDetails(
    moduleDetails,
    MODULE_STATUS.find((s) => s.value === moduleDetails?.status)?.color ?? ""
  );

  const handleModuleRedirection = () =>
    router.push(`/${workspaceSlug?.toString()}/projects/${moduleDetails?.project_id}/modules/${moduleDetails?.id}`);

  const handleBlockKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Space would scroll the timeline otherwise
    if (e.key === " ") e.preventDefault();
    handleModuleRedirection();
  };

  return (
    <Tooltip
      isMobile={isMobile}
      tooltipContent={
        <div className="space-y-1">
          <h5>{moduleDetails?.name}</h5>
          <div>{message}</div>
        </div>
      }
      position="top-start"
    >
      <div
        className="relative flex h-full w-full cursor-pointer items-center rounded-sm"
        style={blockStyle}
        // a real button element would restyle the bar (UA text-align/appearance) and cannot legally wrap these divs
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="button"
        tabIndex={0}
        onClick={handleModuleRedirection}
        onKeyDown={handleBlockKeyDown}
      >
        <div className="absolute top-0 left-0 h-full w-full bg-surface-1/50" />
        <div
          className="sticky w-auto truncate overflow-hidden px-2.5 py-1 text-13 text-primary"
          style={{ left: `${sidebarPaneWidth}px` }}
        >
          {moduleDetails?.name}
        </div>
      </div>
    </Tooltip>
  );
});

export const ModuleGanttSidebarBlock = observer(function ModuleGanttSidebarBlock(props: Props) {
  const { moduleId } = props;
  const { workspaceSlug } = useParams();
  // store hooks
  const { getModuleById } = useModule();
  // derived values
  const moduleDetails = getModuleById(moduleId);

  return (
    <Link
      className="relative flex h-full w-full items-center gap-2"
      href={`/${workspaceSlug?.toString()}/projects/${moduleDetails?.project_id}/modules/${moduleDetails?.id}`}
      draggable={false}
    >
      <ModuleStatusIcon status={moduleDetails?.status ?? "backlog"} height="16px" width="16px" />
      <h6 className="flex-grow truncate text-13 font-medium">{moduleDetails?.name}</h6>
    </Link>
  );
});
