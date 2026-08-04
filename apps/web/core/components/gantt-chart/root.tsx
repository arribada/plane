/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
// components
import type { IBlockUpdateData, IBlockUpdateDependencyData } from "@plane/types";
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { ChartViewRoot } from "./chart/root";

type GanttChartRootProps = {
  border?: boolean;
  title: string;
  loaderTitle: string;
  blockIds: string[];
  blockUpdateHandler: (block: any, payload: IBlockUpdateData) => void;
  blockToRender: (data: any) => React.ReactNode;
  sidebarToRender: (props: any) => React.ReactNode;
  quickAdd?: React.ReactNode | undefined;
  canLoadMoreBlocks?: boolean;
  loadMoreBlocks?: () => void;
  updateBlockDates?: (updates: IBlockUpdateDependencyData[]) => Promise<void>;
  enableBlockLeftResize?: boolean | ((blockId: string) => boolean);
  enableBlockRightResize?: boolean | ((blockId: string) => boolean);
  enableBlockMove?: boolean | ((blockId: string) => boolean);
  enableReorder?: boolean | ((blockId: string) => boolean);
  /** Fires before a reorder is applied. The gantt uses it to turn the view's
   *  current sequence INTO the manual order when the view is sorted by
   *  something else, so the drag lands on the list in front of the reader. */
  onReorderStart?: () => Promise<void> | void;
  enableAddBlock?: boolean | ((blockId: string) => boolean);
  enableSelection?: boolean | ((blockId: string) => boolean);
  enableDependency?: boolean | ((blockId: string) => boolean);
  bottomSpacing?: boolean;
  showAllBlocks?: boolean;
  showToday?: boolean;
  isEpic?: boolean;
};

export const GanttChartRoot = observer(function GanttChartRoot(props: GanttChartRootProps) {
  const {
    border = true,
    title,
    blockIds,
    loaderTitle = "blocks",
    blockUpdateHandler,
    sidebarToRender,
    blockToRender,
    loadMoreBlocks,
    canLoadMoreBlocks,
    enableBlockLeftResize = false,
    enableBlockRightResize = false,
    enableBlockMove = false,
    enableReorder = false,
    onReorderStart,
    enableAddBlock = false,
    enableSelection = false,
    enableDependency = false,
    bottomSpacing = false,
    showAllBlocks = false,
    showToday = true,
    quickAdd,
    updateBlockDates,
    isEpic = false,
  } = props;

  const { setBlockIds } = useTimeLineChartStore();

  // update the timeline store with updated blockIds
  useEffect(() => {
    setBlockIds(blockIds);
  }, [blockIds, setBlockIds]);

  return (
    <ChartViewRoot
      border={border}
      title={title}
      blockIds={blockIds}
      loadMoreBlocks={loadMoreBlocks}
      canLoadMoreBlocks={canLoadMoreBlocks}
      loaderTitle={loaderTitle}
      blockUpdateHandler={blockUpdateHandler}
      sidebarToRender={sidebarToRender}
      blockToRender={blockToRender}
      enableBlockLeftResize={enableBlockLeftResize}
      enableBlockRightResize={enableBlockRightResize}
      enableBlockMove={enableBlockMove}
      enableReorder={enableReorder}
      onReorderStart={onReorderStart}
      enableAddBlock={enableAddBlock}
      enableSelection={enableSelection}
      enableDependency={enableDependency}
      bottomSpacing={bottomSpacing}
      showAllBlocks={showAllBlocks}
      quickAdd={quickAdd}
      showToday={showToday}
      updateBlockDates={updateBlockDates}
      isEpic={isEpic}
    />
  );
});
