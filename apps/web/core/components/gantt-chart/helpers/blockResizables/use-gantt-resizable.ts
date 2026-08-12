/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
// Plane
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IBlockUpdateDependencyData, IGanttBlock } from "@plane/types";
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
// plane web
import { isDragGesture, suppressNextClick } from "@/plane-web/components/gantt-chart/gesture";
//
import { DEFAULT_BLOCK_WIDTH, GANTT_SIDEBAR_COLLAPSED_WIDTH } from "../../constants";

export const useGanttResizable = (
  block: IGanttBlock,
  resizableRef: React.RefObject<HTMLDivElement>,
  ganttContainerRef: React.RefObject<HTMLDivElement>,
  updateBlockDates?: (updates: IBlockUpdateDependencyData[]) => Promise<void>
) => {
  // refs
  const initialPositionRef = useRef<{ marginLeft: number; width: number; offsetX: number }>({
    marginLeft: 0,
    width: 0,
    offsetX: 0,
  });
  const ganttContainerDimensions = useRef<DOMRect | undefined>();
  const currMouseEvent = useRef<MouseEvent | undefined>();
  // states
  const {
    currentViewData,
    updateBlockPosition,
    setIsDragging,
    getUpdatedPositionAfterDrag,
    sidebarWidth,
    isSidebarCollapsed,
  } = useTimeLineChartStore();
  const [isMoving, setIsMoving] = useState<"left" | "right" | "move" | undefined>();

  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  // handle block resize from the left end
  const handleBlockDrag = (
    e: React.MouseEvent<HTMLDivElement, MouseEvent>,
    dragDirection: "left" | "right" | "move"
  ) => {
    const ganttContainerElement = ganttContainerRef.current;
    if (!currentViewData || !resizableRef.current || !block.position || !ganttContainerElement) return;

    if (e.button !== 0) return;

    const resizableDiv = resizableRef.current;

    ganttContainerDimensions.current = ganttContainerElement.getBoundingClientRect();

    const dayWidth = currentViewData.data.dayWidth;
    const mouseX =
      e.clientX - ganttContainerDimensions.current.left - sidebarPaneWidth + ganttContainerElement.scrollLeft;

    // record position on drag start
    initialPositionRef.current = {
      width: block.position.width ?? 0,
      marginLeft: block.position.marginLeft ?? 0,
      offsetX: mouseX - block.position.marginLeft,
    };

    /**
     * Where the press began, and whether it has since become a drag.
     *
     * ARRIBADA FIX. `mousedown` here and `onClick` on the bar
     * (`issue-layouts/gantt/blocks.tsx`) are on overlapping elements, and the
     * browser synthesises a `click` for any mousedown/mouseup pair on the same
     * subtree. Because the bar travels WITH the cursor, the release lands back
     * on the bar it started from — so every move and every resize ended by
     * opening the peek over the plan the user was rearranging: "si je la déplace
     * sur la timeline c'est un déplacement, je veux pas afficher le détail".
     *
     * Nothing in the DOM says "this mouseup concluded a drag", so the distance
     * travelled is the discriminator. See `gesture.ts` for why distance and not
     * time, and why the threshold is not zero.
     */
    const pressX = e.clientX;
    const pressY = e.clientY;
    let hasDragged = false;
    // The ref outlives the gesture. A container scroll arriving before this
    // press has moved would otherwise replay the LAST gesture's mouse position
    // through `handleOnScroll`, which now reads as travel and would promote a
    // click into a drag that jumps the bar to where the previous one ended.
    currMouseEvent.current = undefined;

    const handleOnScroll = () => {
      if (currMouseEvent.current) handleMouseMove(currMouseEvent.current);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      currMouseEvent.current = moveEvent;
      // Below the threshold the bar does not move at all. The jitter under an
      // ordinary click used to nudge it by a pixel and re-render every bar on
      // the chart for nothing — and, worse, `setIsDragging(true)` armed the
      // auto-scroller on a press that was never going anywhere.
      if (!hasDragged) {
        if (!isDragGesture({ dx: moveEvent.clientX - pressX, dy: moveEvent.clientY - pressY })) return;
        hasDragged = true;
      }
      setIsMoving(dragDirection);
      setIsDragging(true);

      if (!ganttContainerDimensions.current) return;

      const { left: containerLeft } = ganttContainerDimensions.current;

      const currentMouseX = moveEvent.clientX - containerLeft - sidebarPaneWidth + ganttContainerElement.scrollLeft;

      let width = initialPositionRef.current.width;
      let marginLeft = initialPositionRef.current.marginLeft;

      if (dragDirection === "left") {
        // calculate new marginLeft and update the initial marginLeft to the newly calculated one
        marginLeft = Math.round(currentMouseX / dayWidth) * dayWidth;
        // get Dimensions from dom's style
        const prevMarginLeft = parseFloat(resizableDiv.style.marginLeft.slice(0, -2));
        const prevWidth = parseFloat(resizableDiv.style.width.slice(0, -2));
        // calculate new width
        const marginDelta = prevMarginLeft - marginLeft;
        // If target date does not exist while dragging with left handle the revert to default width
        width = block.target_date ? prevWidth + marginDelta : DEFAULT_BLOCK_WIDTH;
      } else if (dragDirection === "right") {
        // calculate new width and update the initialMarginLeft using +=
        width = Math.round(currentMouseX / dayWidth) * dayWidth - marginLeft;

        // If start date does not exist while dragging with right handle the revert to default width and adjust marginLeft accordingly
        if (!block.start_date) {
          // calculate new right and update the marginLeft to the newly calculated one
          const marginRight = Math.round(currentMouseX / dayWidth) * dayWidth;
          marginLeft = marginRight - DEFAULT_BLOCK_WIDTH;
          width = DEFAULT_BLOCK_WIDTH;
        }
      } else if (dragDirection === "move") {
        // calculate new marginLeft and update the initial marginLeft using -=
        marginLeft = Math.round((currentMouseX - initialPositionRef.current.offsetX) / dayWidth) * dayWidth;
      }

      // block needs to be at least 1 dayWidth Wide
      if (width < dayWidth) return;

      resizableDiv.style.width = `${width}px`;
      resizableDiv.style.marginLeft = `${marginLeft}px`;

      const deltaLeft = Math.round((marginLeft - (block.position?.marginLeft ?? 0)) / dayWidth) * dayWidth;
      const deltaWidth = Math.round((width - (block.position?.width ?? 0)) / dayWidth) * dayWidth;

      // call update blockPosition
      if (deltaWidth || deltaLeft) updateBlockPosition(block.id, deltaLeft, deltaWidth);
    };

    // remove event listeners and call updateBlockDates
    const handleMouseUp = () => {
      setIsMoving(undefined);

      document.removeEventListener("mousemove", handleMouseMove);
      ganttContainerElement.removeEventListener("scroll", handleOnScroll);
      document.removeEventListener("mouseup", handleMouseUp);

      /**
       * A press that never became a drag is a CLICK, and a click on a bar means
       * "show me this work item".
       *
       * Two things follow from returning here. The peek opens, because the
       * click is left alone to reach `blocks.tsx`. And nothing is written: this
       * used to POST the bar's own unchanged dates on every click, which put a
       * pointless `issue.activity.updated` row against the item and, with "push
       * dependents" on, ran the whole cascade for a delta of zero.
       */
      if (!hasDragged) {
        setIsDragging(false);
        return;
      }

      // It WAS a drag, so the click the browser is about to synthesise is not a
      // request for anything. Swallowed at document capture, which is above
      // every onClick in the tree — the move, both resize edges and the
      // dependency handle all reach the same one function. See `gesture.ts`.
      suppressNextClick();

      // update half blocks only when the missing side of the block is directly dragged
      const shouldUpdateHalfBlock =
        (dragDirection === "left" && !block.start_date) || (dragDirection === "right" && !block.target_date);

      try {
        const blockUpdates = getUpdatedPositionAfterDrag(block.id, shouldUpdateHalfBlock);
        if (updateBlockDates) updateBlockDates(blockUpdates);
      } catch {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error",
          message: "Something went wrong while updating block dates",
        });
      }

      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    ganttContainerElement.addEventListener("scroll", handleOnScroll);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return {
    isMoving,
    handleBlockDrag,
  };
};
