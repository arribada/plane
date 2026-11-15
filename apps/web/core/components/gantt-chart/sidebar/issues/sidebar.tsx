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
// ARRIBADA FIX: a refused re-parent is said out loud rather than left to an
// unhandled rejection.
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
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
  /** ARRIBADA FIX: may be async, so a re-parent can await it and catch a 403. */
  blockUpdateHandler: (block: any, payload: IBlockUpdateData) => void | Promise<void>;
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
  //
  // It is also the plan permission. base-gantt-root passes `isAllowed` — Plane's
  // role, the lock and `can_edit_plan` together — whatever the sort, so "may this
  // row be reordered" and "may this reader change the plan" are one answer here.
  // Every drag-started write below (reorder, band drop, nest, un-nest) is gated
  // on it; the lock used to be bypassed by the band-drop and make-child paths,
  // which were wired on grouping and nesting alone.
  const canReorder = (blockId: string) =>
    typeof enableReorder === "function" ? enableReorder(blockId) : enableReorder;

  // ARRIBADA FIX: what a refused `parent_id` write says. `plan_guard.py` answers
  // 403 with `detail` (who may change the plan, what is still open); the store
  // rolls its optimistic update back, so the row has already snapped home and
  // the sentence is the only sign anything was asked. Same shape as the band
  // drop's `assignToGroup` in base-gantt-root.
  const sayRefused = (error: unknown) => {
    const refusal = error as { detail?: unknown; error?: unknown } | null | undefined;
    const said = typeof refusal?.detail === "string" ? refusal.detail : refusal?.error;
    setToast({
      type: TOAST_TYPE.ERROR,
      title: "The move did not stick",
      message:
        typeof said === "string" && said
          ? said
          : "The server refused the change, so the work item is back where it was.",
    });
  };

  useIntersectionObserver(
    ganttContainerRef,
    isPaginating ? null : intersectionElement,
    loadMoreBlocks,
    "100% 0% 100% 0%"
  );

  // ARRIBADA: true if making `dragId` a child of `targetParentId` would create a cycle — the
  // target, or an ancestor of it, IS the dragged row. A null target is the top level and never
  // cycles. Shared by make-child (nest) and cross-level reorder (un-nest / move level).
  const wouldCycle = (dragId: string, targetParentId: string | null | undefined): boolean => {
    if (!targetParentId) return false;
    let cursor: string | null | undefined = targetParentId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      if (cursor === dragId) return true;
      guard.add(cursor);
      cursor = groups.subtasks.parentOf(cursor);
    }
    return false;
  };

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
    // ARRIBADA: a reorder can now cross levels — dropping BETWEEN two rows of a different
    // parent moves the item to that level. A sub-task dropped among top-level rows leaves its
    // parent (un-nest); the reverse joins a parent's children. Re-parent to the drop target's
    // parent (null = top level) first, then let handleOrderChange position it. Guarded against
    // cycles and no-op'd when the level is unchanged.
    //
    // ARRIBADA FIX: gated on the plan permission, and awaited inside a
    // try/catch. This wrote `parent_id` for anybody whose drag reached here,
    // and a 403 was an unhandled rejection: the row snapped back and nothing
    // was said. A refused re-parent also stops the drop — positioning a row the
    // server would not let move is a second write that would 403 the same way.
    if (groups.subtasks.enabled && draggingBlockId && droppedBlockId && canReorder(draggingBlockId)) {
      const newParent = groups.subtasks.parentOf(droppedBlockId) ?? null;
      const curParent = groups.subtasks.parentOf(draggingBlockId) ?? null;
      if (newParent !== curParent && draggingBlockId !== newParent && !wouldCycle(draggingBlockId, newParent)) {
        const child = getBlockById(draggingBlockId);
        if (child?.data) {
          try {
            await blockUpdateHandler(child.data, { parent_id: newParent } as unknown as IBlockUpdateData);
          } catch (error) {
            sayRefused(error);
            return;
          }
        }
      }
    }
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
    // ARRIBADA FIX: the plan permission, asked again at the drop. The handler is
    // only wired on allowed rows (see `onMakeChild` below), but the answer can
    // change between the drag starting and ending.
    if (!canReorder(draggingBlockId)) return;
    // Never let an item parent itself, and never re-parent onto one of its own descendants —
    // that would make a cycle that buildSubtaskTree only papers over by cutting an edge.
    if (draggingBlockId === parentBlockId || wouldCycle(draggingBlockId, parentBlockId)) return;
    // No-op if it is already this parent.
    if (groups.subtasks.parentOf(draggingBlockId) === parentBlockId) return;

    const child = getBlockById(draggingBlockId);
    if (!child?.data) return;

    // Same channel as the reorder path: blockUpdateHandler forwards the payload
    // to updateIssue (see base-gantt-root's updateIssueBlockStructure, which
    // spreads it straight through), so a `parent_id` here is applied exactly like
    // a `sort_order` there. Cast because IBlockUpdateData is the reorder/date
    // payload shape and does not name parent_id.
    //
    // ARRIBADA FIX: awaited and caught. A 403 here used to be an unhandled
    // rejection — the row snapped back and nothing was said.
    try {
      await blockUpdateHandler(child.data, { parent_id: parentBlockId } as unknown as IBlockUpdateData);
    } catch (error) {
      sayRefused(error);
      return;
    }

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
                  // Draggable to reorder, and — when the chart is grouped by
                  // something a work item can actually belong to — to drop on a
                  // band header and join it. Both are plan edits.
                  //
                  // ARRIBADA FIX: this was `canReorder(id) || !!groups.assign`,
                  // and `assign` is set by the GROUPING, not by any permission —
                  // so grouping by sprint made every row of a locked plan
                  // draggable, and the make-child band below then accepted the
                  // drop. `enableReorder` is `isAllowed` whatever the sort (see
                  // base-gantt-root), so it already covers the band-drop case.
                  isDragEnabled={canReorder(block.id)}
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
                  //
                  // ARRIBADA FIX: and only where this reader may change the
                  // plan. Wired on nesting alone, a locked plan still lit every
                  // row up as a drop target for a re-parent the server refuses.
                  onMakeChild={
                    groups.subtasks.enabled && canReorder(block.id) ? (a, b) => void handleMakeChild(a, b) : undefined
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
