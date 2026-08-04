/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// components
import type { IBlockUpdateData } from "@plane/types";
import { Row, ERowVariant } from "@plane/ui";
import { cn } from "@plane/utils";
import { MultipleSelectGroupAction } from "@/components/core/multiple-select";
// helpers
// hooks
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
// constants
import {
  GANTT_SELECT_GROUP,
  GANTT_SIDEBAR_COLLAPSED_WIDTH,
  GANTT_SIDEBAR_MAX_WIDTH,
  GANTT_SIDEBAR_MIN_WIDTH,
  HEADER_HEIGHT,
} from "../constants";

type Props = {
  blockIds: string[];
  blockUpdateHandler: (block: any, payload: IBlockUpdateData) => void;
  canLoadMoreBlocks?: boolean;
  loadMoreBlocks?: () => void;
  ganttContainerRef: RefObject<HTMLDivElement>;
  enableReorder: boolean | ((blockId: string) => boolean);
  onReorderStart?: () => Promise<void> | void;
  enableSelection: boolean | ((blockId: string) => boolean);
  sidebarToRender: (props: any) => React.ReactNode;
  title: string;
  selectionHelpers: TSelectionHelper;
  showAllBlocks?: boolean;
  isEpic?: boolean;
};

export const GanttChartSidebar = observer(function GanttChartSidebar(props: Props) {
  const { t } = useTranslation();
  const {
    blockIds,
    blockUpdateHandler,
    enableReorder,
    onReorderStart,
    enableSelection,
    sidebarToRender,
    loadMoreBlocks,
    canLoadMoreBlocks,
    ganttContainerRef,
    title,
    selectionHelpers,
    showAllBlocks = false,
    isEpic = false,
  } = props;
  // store hooks
  const { sidebarWidth, isSidebarCollapsed, setSidebarWidth, commitSidebarPreferences, toggleSidebarCollapsed } =
    useTimeLineChartStore();
  // refs
  const sidebarRef = useRef<HTMLDivElement>(null);
  const pointerXRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
  // states
  const [isResizing, setIsResizing] = useState(false);

  const isGroupSelectionEmpty = selectionHelpers.isGroupSelected(GANTT_SELECT_GROUP) === "empty";
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  const applyResize = useCallback(() => {
    const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left;
    if (sidebarLeft === undefined) return;

    setSidebarWidth(
      Math.min(Math.max(pointerXRef.current - sidebarLeft, GANTT_SIDEBAR_MIN_WIDTH), GANTT_SIDEBAR_MAX_WIDTH)
    );
  }, [setSidebarWidth]);

  const handleResize = useCallback(
    (e: MouseEvent) => {
      pointerXRef.current = e.clientX;
      // a mousemove re-renders every chart view and block row, so coalesce them into one store write per frame
      if (resizeFrameRef.current !== null) return;

      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        applyResize();
      });
    },
    [applyResize]
  );

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    // flush the still-pending frame so the final width matches the last mouse position
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
      applyResize();
    }
    // the store no longer persists on every setSidebarWidth, so write the drag result once here
    commitSidebarPreferences();
  }, [applyResize, commitSidebarPreferences]);

  useEffect(() => {
    if (!isResizing) return;

    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [isResizing, handleResize, stopResizing]);

  return (
    <Row
      // DO NOT REMOVE THE ID
      id="gantt-sidebar"
      ref={sidebarRef}
      // no overflow rule here: it would make this Row the scroll container and re-scope the header's sticky top-0
      className="sticky left-0 z-10 h-max min-h-full flex-shrink-0 border-r-[0.5px] border-subtle-1 bg-surface-1"
      style={{
        width: `${sidebarPaneWidth}px`,
      }}
      variant={ERowVariant.HUGGING}
    >
      <Row
        className={cn(
          "group/list-header sticky top-0 z-10 box-border flex flex-shrink-0 items-end gap-2 border-b-[0.5px] border-subtle-1 bg-surface-1 pb-2 text-13 font-medium text-tertiary",
          isSidebarCollapsed ? "justify-center px-0" : "justify-between pr-4"
        )}
        style={{
          height: `${HEADER_HEIGHT}px`,
        }}
      >
        {isSidebarCollapsed ? (
          <button
            type="button"
            title="Expand list"
            onClick={() => toggleSidebarCollapsed(false)}
            className="flex-shrink-0 text-tertiary hover:text-secondary"
          >
            <PanelLeftOpen className="size-3.5" />
          </button>
        ) : (
          <>
            <div className={cn("flex items-center gap-2")}>
              {enableSelection && (
                <div className="absolute left-1 flex w-3.5 flex-shrink-0 items-center">
                  <MultipleSelectGroupAction
                    className={cn(
                      "pointer-events-none size-3.5 opacity-0 !outline-none group-hover/list-header:pointer-events-auto group-hover/list-header:opacity-100",
                      {
                        "pointer-events-auto opacity-100": !isGroupSelectionEmpty,
                      }
                    )}
                    groupID={GANTT_SELECT_GROUP}
                    selectionHelpers={selectionHelpers}
                  />
                </div>
              )}
              <h6>{title}</h6>
              <button
                type="button"
                title="Collapse list"
                onClick={() => toggleSidebarCollapsed(true)}
                className="flex-shrink-0 text-tertiary hover:text-secondary"
              >
                <PanelLeftClose className="size-3.5" />
              </button>
            </div>
            <h6>{t("common.duration")}</h6>
          </>
        )}
      </Row>

      {/*
        Never unmount this: it holds the only pagination sentinel of the whole timeline. Collapsing hides it with
        visibility (`invisible`), which keeps the layout box the IntersectionObserver needs — `display: none`,
        `hidden` or a zero-sized box would stop pagination while collapsed.
      */}
      <Row
        variant={ERowVariant.HUGGING}
        className={cn("h-max min-h-full bg-surface-1", {
          "pointer-events-none invisible": isSidebarCollapsed,
        })}
      >
        {sidebarToRender &&
          sidebarToRender({
            title,
            blockUpdateHandler,
            blockIds,
            enableReorder,
            onReorderStart,
            enableSelection,
            canLoadMoreBlocks,
            ganttContainerRef,
            loadMoreBlocks,
            selectionHelpers,
            showAllBlocks,
            isEpic,
          })}
      </Row>

      {!isSidebarCollapsed && (
        <div
          className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize hover:bg-accent-primary/40"
          onMouseDown={() => setIsResizing(true)}
          role="separator"
          aria-label="Resize list"
        />
      )}
    </Row>
  );
});
