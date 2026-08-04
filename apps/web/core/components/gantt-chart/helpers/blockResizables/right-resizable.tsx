/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane utils
import { cn, renderFormattedDate } from "@plane/utils";
//helpers
//
//hooks
import { HANDLE_WIDTH, NARROW_BLOCK_PX } from "@/components/gantt-chart/constants";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

type RightResizableProps = {
  enableBlockRightResize: boolean;
  handleBlockDrag: (e: React.MouseEvent<HTMLDivElement, MouseEvent>, dragDirection: "left" | "right" | "move") => void;
  isMoving: "left" | "right" | "move" | undefined;
  position?: {
    marginLeft: number;
    width: number;
  };
};
export const RightResizable = observer(function RightResizable(props: RightResizableProps) {
  const { enableBlockRightResize, handleBlockDrag, isMoving, position } = props;
  const [isHovering, setIsHovering] = useState(false);

  const { getDateFromPositionOnGantt } = useTimeLineChartStore();

  const date = position ? getDateFromPositionOnGantt(position.marginLeft + position.width, -1) : undefined;
  const dateString = date ? renderFormattedDate(date) : undefined;

  const isRightResizing = isMoving === "right" || isMoving === "move";

  // Mirrors the left handle: below the threshold it steps outside the bar so the
  // bar keeps a middle to grab.
  const narrow = (position?.width ?? Number.POSITIVE_INFINITY) < NARROW_BLOCK_PX;
  const handleRight = narrow ? -HANDLE_WIDTH : -HANDLE_WIDTH / 2;

  if (!enableBlockRightResize) return null;

  return (
    <>
      {(isHovering || isRightResizing) && dateString && (
        <div className="absolute -right-36 z-[10] flex h-full w-32 items-center justify-start text-11 font-regular text-tertiary">
          <div className="rounded-sm bg-accent-subtle px-2 py-1">{dateString}</div>
        </div>
      )}
      <div
        onMouseDown={(e) => handleBlockDrag(e, "right")}
        onMouseOver={() => {
          setIsHovering(true);
        }}
        onMouseOut={() => {
          setIsHovering(false);
        }}
        // Mirrors the left grip: a separator role, and a focus pair so the date
        // preview is not mouse-only.
        role="separator"
        aria-orientation="vertical"
        onFocus={() => {
          setIsHovering(true);
        }}
        onBlur={() => {
          setIsHovering(false);
        }}
        style={{ right: `${handleRight}px`, width: `${HANDLE_WIDTH}px` }}
        className="absolute top-1/2 z-[6] h-full -translate-y-1/2 cursor-col-resize rounded-md"
      />
      <div
        className={cn(
          "absolute top-1/2 right-1 z-[5] h-7 w-1 -translate-y-1/2 rounded-xs bg-surface-1 opacity-0 transition-all duration-300 group-hover:opacity-100",
          {
            "-right-1.5 opacity-100": isRightResizing,
          }
        )}
      />
    </>
  );
});
