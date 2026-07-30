/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RefObject } from "react";
import { observer } from "mobx-react";
// hooks
import { useAutoScroller } from "@/hooks/use-auto-scroller";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
//
import { GANTT_SIDEBAR_COLLAPSED_WIDTH, HEADER_HEIGHT } from "../constants";

type Props = {
  ganttContainerRef: RefObject<HTMLDivElement>;
};
export const TimelineDragHelper = observer(function TimelineDragHelper(props: Props) {
  const { ganttContainerRef } = props;
  const { isDragging, sidebarWidth, isSidebarCollapsed } = useTimeLineChartStore();
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  useAutoScroller(ganttContainerRef, isDragging, sidebarPaneWidth, HEADER_HEIGHT);
  return <></>;
});
