/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachInstruction, extractInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { observer } from "mobx-react";
import { useOutsideClickDetector } from "@plane/hooks";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { DropIndicator } from "@plane/ui";
import { HIGHLIGHT_WITH_LINE, highlightIssueOnDrop } from "@/components/issues/issue-layouts/utils";

type Props = {
  id: string;
  isLastChild: boolean;
  isDragEnabled: boolean;
  /** Whether THIS row accepts a drop to reorder. Separate from isDragEnabled
   *  because grouping needs the opposite pair: items must be draggable so they
   *  can be dropped on a band header, while reordering between rows stays off —
   *  a drop between two rows of another group has no meaning. */
  isReorderTarget?: boolean;
  children: (isDragging: boolean) => React.ReactNode;
  onDrop: (draggingBlockId: string | undefined, droppedBlockId: string | undefined, dropAtEndOfList: boolean) => void;
};

export const GanttDnDHOC = observer(function GanttDnDHOC(props: Props) {
  const { id, isLastChild, children, onDrop, isDragEnabled, isReorderTarget = true } = props;
  // states
  const [isDragging, setIsDragging] = useState(false);
  const [instruction, setInstruction] = useState<"DRAG_OVER" | "DRAG_BELOW" | undefined>(undefined);
  // refs
  const blockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = blockRef.current;

    if (!element) return;

    return combine(
      draggable({
        element,
        canDrag: () => isDragEnabled,
        getInitialData: () => ({ id, dragInstanceId: "GANTT_REORDER" }),
        onDragStart: () => {
          setIsDragging(true);
        },
        onDrop: () => {
          setIsDragging(false);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isReorderTarget && source?.data?.id !== id && source?.data?.dragInstanceId === "GANTT_REORDER",
        getData: ({ input, element: target }) => {
          const data = { id };

          // attach instruction for last in list
          return attachInstruction(data, {
            input,
            element: target,
            currentLevel: 0,
            indentPerLevel: 0,
            mode: isLastChild ? "last-in-group" : "standard",
          });
        },
        onDrag: ({ self }) => {
          const extractedInstruction = extractInstruction(self?.data)?.type;
          // check if the highlight is to be shown above or below
          setInstruction(
            extractedInstruction
              ? extractedInstruction === "reorder-below" && isLastChild
                ? "DRAG_BELOW"
                : "DRAG_OVER"
              : undefined
          );
        },
        onDragLeave: () => {
          setInstruction(undefined);
        },
        onDrop: ({ self, source }) => {
          setInstruction(undefined);
          const extractedInstruction = extractInstruction(self?.data)?.type;
          const currentInstruction = extractedInstruction
            ? extractedInstruction === "reorder-below" && isLastChild
              ? "DRAG_BELOW"
              : "DRAG_OVER"
            : undefined;
          if (!currentInstruction) return;

          const sourceId = source?.data?.id as string | undefined;
          const destinationId = self?.data?.id as string | undefined;

          onDrop(sourceId, destinationId, currentInstruction === "DRAG_BELOW");
          highlightIssueOnDrop(source?.element?.id, false, true);
        },
      })
    );
    // isReorderTarget and isDragEnabled belong here: grouping toggles them at
    // runtime, and a target registered under the old value would keep accepting
    // (or refusing) drops until the row happened to remount. blockRef.current is
    // not a dependency React can track — the mount is what schedules this.
  }, [id, isLastChild, onDrop, isDragEnabled, isReorderTarget]);

  useOutsideClickDetector(blockRef, () => blockRef?.current?.classList?.remove(HIGHLIGHT_WITH_LINE));

  return (
    <div
      id={`draggable-${id}`}
      // A shadow and a slight fade, not a scale: a scaled row stops lining up
      // with its own bar in the chart pane.
      data-lifted={isDragging ? "true" : undefined}
      className={"relative"}
      ref={blockRef}
      onDragStart={() => {
        if (!isDragEnabled) {
          setToast({
            title: "Warning!",
            type: TOAST_TYPE.WARNING,
            message: "Drag and drop is only enabled when sorted by manual",
          });
        }
      }}
    >
      <DropIndicator classNames="absolute top-0" isVisible={instruction === "DRAG_OVER"} />
      {children(isDragging)}
      {isLastChild && <DropIndicator isVisible={instruction === "DRAG_BELOW"} />}
    </div>
  );
});
