/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// ui
import { GANTT_TIMELINE_TYPE } from "@plane/types";
import type { IBlockUpdateData } from "@plane/types";
import { Loader } from "@plane/ui";
// components
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
import { GanttLayoutListItemLoader } from "@/components/ui/loader/layouts/gantt-layout-loader";
//hooks
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { useGanttGroups } from "@/plane-web/components/gantt-chart/group-context";
import { GanttGroupHeader } from "@/plane-web/components/gantt-chart/group-row";
import { groupKeyFromRowId, isGroupRowId } from "@/plane-web/components/gantt-chart/grouping";
import type { TReorderStart } from "@/plane-web/components/gantt-chart/reorder";
import { ROOT_DRAG_SCOPE } from "@/plane-web/components/gantt-chart/subtasks";
// local imports
import { useTimeLineChart } from "../../../../hooks/use-timeline-chart";
import { GanttDnDHOC } from "../gantt-dnd-HOC";
import { handleOrderChange } from "../utils";
import { IssuesSidebarBlock } from "./block";

type Props = {
  blockUpdateHandler: (block: any, payload: IBlockUpdateData) => void;
  canLoadMoreBlocks?: boolean;
  loadMoreBlocks?: () => void;
  ganttContainerRef: RefObject<HTMLDivElement>;
  blockIds: string[];
  enableReorder: boolean | ((blockId: string) => boolean);
  enableSelection: boolean;
  showAllBlocks?: boolean;
  /** Runs before the move is applied, so a view sorted — or grouped — by
   *  something else can become the manual order first, and hands back the
   *  sequence it froze. */
  onReorderStart?: () => Promise<TReorderStart | void> | TReorderStart | void;
  selectionHelpers?: TSelectionHelper;
  isEpic?: boolean;
};

export const IssueGanttSidebar = observer(function IssueGanttSidebar(props: Props) {
  const {
    blockUpdateHandler,
    blockIds,
    enableReorder,
    enableSelection,
    loadMoreBlocks,
    canLoadMoreBlocks,
    ganttContainerRef,
    showAllBlocks = false,
    onReorderStart,
    selectionHelpers,
    isEpic = false,
  } = props;

  const { getBlockById } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  const groups = useGanttGroups();

  const {
    issues: { getIssueLoader },
  } = useIssuesStore();

  const [intersectionElement, setIntersectionElement] = useState<HTMLDivElement | null>(null);
  // The row that just moved, so it can be found again after the list redraws.
  // Cleared on a timer rather than on animation end: the row may be scrolled
  // out of view and virtualised away before the animation ever fires.
  const [landedId, setLandedId] = useState<string | null>(null);
  const landedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (landedTimer.current) window.clearTimeout(landedTimer.current);
    },
    []
  );

  const isPaginating = !!getIssueLoader();

  // ARRIBADA FIX: the prop has always been typed `boolean | (id) => boolean` at
  // the gantt's own root and was flattened to `boolean` on the way in here, so a
  // per-row answer read as "always true". Resolved once, at the row.
  const canReorder = (blockId: string) =>
    typeof enableReorder === "function" ? enableReorder(blockId) : enableReorder;

  useIntersectionObserver(
    ganttContainerRef,
    isPaginating ? null : intersectionElement,
    loadMoreBlocks,
    "100% 0% 100% 0%"
  );

  const handleOnDrop = async (
    draggingBlockId: string | undefined,
    droppedBlockId: string | undefined,
    dropAtEndOfList: boolean
  ) => {
    // Awaited first: when the view is sorted — or grouped — by something other
    // than the manual order, this writes the sequence on screen down AS the
    // manual order and switches to it. Applying the move before that would
    // compute neighbours from a sort_order nobody is looking at, and the row
    // would land somewhere else entirely.
    //
    // ARRIBADA FIX: and it hands the frozen sequence back. `blockIds` here is the
    // prop from the render that is now one state change out of date — with the
    // group headers still in it — so the move has to be computed against what
    // the freeze actually wrote.
    const frozen = await onReorderStart?.();
    handleOrderChange(
      draggingBlockId,
      droppedBlockId,
      dropAtEndOfList,
      frozen?.blockIds ?? blockIds,
      getBlockById,
      blockUpdateHandler,
      frozen?.sortOrderOf
    );
    if (draggingBlockId) {
      setLandedId(draggingBlockId);
      if (landedTimer.current) window.clearTimeout(landedTimer.current);
      landedTimer.current = window.setTimeout(() => setLandedId(null), 1000);
    }
  };

  // ARRIBADA: dropping a work item onto the CENTRE of another row makes it a
  // sub-task of that row. This is a re-parent, not a reorder — it writes
  // `parent_id` and nothing else, and the tree rebuilds itself from parent_id on
  // the next render (see subtasks.ts), so there is no local order to touch here.
  const handleMakeChild = async (draggingBlockId: string, parentBlockId: string) => {
    // Never let an item parent itself, and never re-parent onto one of its own
    // descendants — that would make a cycle that buildSubtaskTree only papers
    // over by cutting an edge. `groups.subtasks.parentOf` gives the in-list
    // parent of a row; walk the target's ancestor chain, and if the dragged item
    // is already an ancestor of the target, refuse. (A guard set caps the walk in
    // case the store itself already holds a cycle.)
    if (draggingBlockId === parentBlockId) return;
    let cursor: string | null = parentBlockId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      if (cursor === draggingBlockId) return; // would create a cycle
      guard.add(cursor);
      cursor = groups.subtasks.parentOf(cursor);
    }
    // No-op if it is already this parent.
    if (groups.subtasks.parentOf(draggingBlockId) === parentBlockId) return;

    const child = getBlockById(draggingBlockId);
    if (!child?.data) return;

    // Same channel as the reorder path: blockUpdateHandler forwards the payload
    // to updateIssue (see base-gantt-root's updateIssueBlockStructure, which
    // spreads it straight through), so a `parent_id` here is applied exactly like
    // a `sort_order` there. Cast because IBlockUpdateData is the reorder/date
    // payload shape and does not name parent_id.
    blockUpdateHandler(child.data, { parent_id: parentBlockId } as unknown as IBlockUpdateData);

    setLandedId(draggingBlockId);
    if (landedTimer.current) window.clearTimeout(landedTimer.current);
    landedTimer.current = window.setTimeout(() => setLandedId(null), 1000);
  };

  // A signature of the sequence, not of its contents: the list should settle when
  // the ORDER changes, not when somebody edits a title. Re-keying the container
  // restarts the animation once, which is the only reliable way to replay a CSS
  // animation without measuring anything.
  const orderSignature = (blockIds ?? []).join("|");

  return (
    <div>
      {blockIds ? (
        <div key={orderSignature} className="gantt-rows-settling contents">
          {blockIds.map((blockId, index) => {
            // Group headers are answered first: they have no block behind them, so
            // the "no dates" guard below would drop them and leave the chart pane
            // drawing a band with nothing beside it.
            if (isGroupRowId(blockId)) {
              const key = groupKeyFromRowId(blockId);
              const group = groups.byKey.get(key);
              if (!group) return null;
              return (
                <GanttGroupHeader
                  key={blockId}
                  groupKey={key}
                  label={group.label}
                  color={group.color}
                  count={group.ids.length}
                  start={group.start}
                  end={group.end}
                  days={group.days}
                  done={group.done}
                  collapsed={groups.isCollapsed(key)}
                  onToggle={() => groups.toggle(key)}
                />
              );
            }

            const block = getBlockById(blockId);
            const isBlockVisibleOnSidebar = block?.start_date && block?.target_date;

            // hide the block if it doesn't have start and target dates and showAllBlocks is false
            if (!block || (!showAllBlocks && !isBlockVisibleOnSidebar)) return;

            return (
              <RenderIfVisible
                key={block.id}
                classNames={block.id === landedId ? "gantt-row-landed" : undefined}
                root={ganttContainerRef}
                horizontalOffset={100}
                verticalOffset={200}
                shouldRecordHeights={false}
                placeholderChildren={<GanttLayoutListItemLoader />}
              >
                <GanttDnDHOC
                  id={block.id}
                  isLastChild={index === blockIds.length - 1}
                  // Draggable either to reorder, or — when the chart is grouped
                  // by something a work item can actually belong to — to drop on
                  // a band header and join it.
                  isDragEnabled={canReorder(block.id) || !!groups.assign}
                  isReorderTarget={canReorder(block.id)}
                  // ARRIBADA FIX: with sub-tasks nested, a row's order is decided
                  // among its own siblings — the tree is rebuilt from parent_id on
                  // every render, so dropping a child between two unrelated rows
                  // would write a sort_order and change nothing anyone can see.
                  // Scoping the drop to the siblings makes the refusal visible
                  // (no drop line) instead of silent.
                  dragScope={
                    groups.subtasks.enabled ? (groups.subtasks.parentOf(block.id) ?? ROOT_DRAG_SCOPE) : undefined
                  }
                  onDrop={(a, b, c) => void handleOnDrop(a, b, c)}
                  // ARRIBADA: only offer make-child where sub-tasks are actually
                  // drawn nested — otherwise re-parenting changes nothing on
                  // screen and the extra centre-drop band would only get in the
                  // way of reordering. Passing undefined keeps the row on the
                  // pure-reorder path (getData stays 0/0, make-child blocked).
                  onMakeChild={
                    groups.subtasks.enabled ? (a, b) => void handleMakeChild(a, b) : undefined
                  }
                >
                  {(isDragging: boolean) => (
                    <IssuesSidebarBlock
                      block={block}
                      enableSelection={enableSelection}
                      isDragging={isDragging}
                      selectionHelpers={selectionHelpers}
                      isEpic={isEpic}
                    />
                  )}
                </GanttDnDHOC>
              </RenderIfVisible>
            );
          })}
          {canLoadMoreBlocks && (
            <div ref={setIntersectionElement} className="p-2">
              <div className="flex h-10 w-full animate-pulse items-center justify-between gap-1.5 rounded-sm bg-layer-1 px-4 py-1.5 md:h-8 md:px-1" />
            </div>
          )}
        </div>
      ) : (
        <Loader className="space-y-3 pr-2">
          <Loader.Item height="34px" />
          <Loader.Item height="34px" />
          <Loader.Item height="34px" />
          <Loader.Item height="34px" />
        </Loader>
      )}
    </div>
  );
});
