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

type LeftResizableProps = {
  enableBlockLeftResize: boolean;
  handleBlockDrag: (e: React.MouseEvent<HTMLDivElement, MouseEvent>, dragDirection: "left" | "right" | "move") => void;
  isMoving: "left" | "right" | "move" | undefined;
  position?: {
    marginLeft: number;
    width: number;
  };
};
export const LeftResizable = observer(function LeftResizable(props: LeftResizableProps) {
  const { enableBlockLeftResize, isMoving, handleBlockDrag, position } = props;
  const [isHovering, setIsHovering] = useState(false);

  const { getDateFromPositionOnGantt } = useTimeLineChartStore();

  const date = position ? getDateFromPositionOnGantt(position.marginLeft, 0) : undefined;
  const dateString = date ? renderFormattedDate(date) : undefined;

  const isLeftResizing = isMoving === "left" || isMoving === "move";

  // A short bar has no middle to spare: the handle steps outside it entirely so
  // the bar itself stays grabbable. Wide bars keep the straddling handle, which
  // is easier to hit than one sitting off the edge.
  const narrow = (position?.width ?? Number.POSITIVE_INFINITY) < NARROW_BLOCK_PX;
  const handleLeft = narrow ? -HANDLE_WIDTH : -HANDLE_WIDTH / 2;

  if (!enableBlockLeftResize) return null;

  return (
    <>
      {(isHovering || isLeftResizing) && dateString && (
        <div className="absolute -left-36 flex h-full w-32 items-center justify-end text-11 font-regular text-tertiary">
          <div className="rounded-sm bg-accent-subtle px-2 py-1">{dateString}</div>
        </div>
      )}
      <div
        onMouseDown={(e) => {
          handleBlockDrag(e, "left");
        }}
        onMouseOver={() => {
          setIsHovering(true);
        }}
        onMouseOut={() => {
          setIsHovering(false);
        }}
        // A resize grip is a separator by role, and the focus pair mirrors the
        // hover pair so the date preview is not mouse-only.
        role="separator"
        aria-orientation="vertical"
        onFocus={() => {
          setIsHovering(true);
        }}
        onBlur={() => {
          setIsHovering(false);
        }}
        style={{ left: `${handleLeft}px`, width: `${HANDLE_WIDTH}px` }}
        className="absolute top-1/2 z-[6] h-full -translate-y-1/2 cursor-col-resize rounded-md"
      />
      <div
        className={cn(
          "absolute top-1/2 left-1 z-[5] h-7 w-1 -translate-y-1/2 rounded-xs bg-surface-1 opacity-0 transition-all duration-300 group-hover:opacity-100",
          {
            "-left-1.5 opacity-100": isLeftResizing,
          }
        )}
      />
    </>
  );
});
