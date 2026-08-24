/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The Home widgets, laid out.
 *
 * Off by default it is the built-in single column, unchanged. "Customise layout" turns the
 * widgets into a free canvas: drag any widget by its top grip to move it anywhere, pull the
 * bottom-right corner to resize it, and both are remembered per browser (homeLayout). A widget
 * resized smaller scrolls its own content rather than clipping it. "Reset layout" returns to the
 * single column and forgets every placement. A widget enabled but not yet placed (a newly
 * turned-on one) is dropped into the next free grid slot, so nothing ever vanishes.
 *
 * The pointer handling mirrors the free-placement stickies board: the live box lives in React
 * state during a gesture (no write per frame), the placement is saved once on pointer-up, and
 * position is an inline `translate` with no transition because it is rewritten every frame.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { GripVertical, RotateCcw } from "lucide-react";
import { cn } from "@plane/utils";
import { homeLayout, type THomeBox } from "./home-layout";

export type THomeWidgetItem = { key: string; node: ReactNode };

type Props = { items: THomeWidgetItem[] };

/** A widget narrower or shorter than this loses the grip or the resize corner. */
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
const DEFAULT_WIDTH = 380;
const DEFAULT_HEIGHT = 320;
const GAP = 16;
/** Room under the lowest widget so the canvas can always be scrolled past. */
const CANVAS_PADDING = 80;

type TGesture = {
  key: string;
  mode: "move" | "resize";
  pointerId: number;
  originX: number;
  originY: number;
  startBox: THomeBox;
};

const clampBox = (box: THomeBox): THomeBox => ({
  x: Math.max(0, box.x),
  y: Math.max(0, box.y),
  width: Math.max(MIN_WIDTH, box.width),
  height: Math.max(MIN_HEIGHT, box.height),
});

export const HomeWidgetsLayout = observer(function HomeWidgetsLayout({ items }: Props) {
  const enabled = homeLayout.enabled;
  const boxes = homeLayout.boxes;
  // refs / state
  const canvasRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<TGesture | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [draft, setDraft] = useState<{ key: string; box: THomeBox } | null>(null);

  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    setCanvasWidth(element.offsetWidth);
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) setCanvasWidth(entry.contentRect.width);
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [enabled]);

  // Default: the built-in single column, exactly as before. The switch into the free canvas
  // lives next to "Manage widgets" in the dashboard header, so there is no inline control here.
  if (!enabled) {
    return (
      <div className="flex flex-col">
        {items.map((i) => (
          <div key={i.key} className="py-4">
            {i.node}
          </div>
        ))}
      </div>
    );
  }

  // Every widget gets a box: its saved one, or the next free grid slot for one never placed.
  // Rebuilt every render so a just-saved placement is read straight back from the observable.
  const step = DEFAULT_WIDTH + GAP;
  const perRow = Math.max(1, Math.floor((canvasWidth || 800) / step));
  const layoutBoxes = new Map<string, THomeBox>();
  let unplaced = 0;
  items.forEach((item) => {
    const stored = boxes[item.key];
    if (stored) {
      layoutBoxes.set(item.key, clampBox(stored));
      return;
    }
    layoutBoxes.set(item.key, {
      x: (unplaced % perRow) * step,
      y: Math.floor(unplaced / perRow) * (DEFAULT_HEIGHT + GAP),
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
    unplaced += 1;
  });

  const boxOf = (key: string): THomeBox =>
    draft?.key === key ? draft.box : (layoutBoxes.get(key) ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  const canvasHeight =
    items.reduce((tallest, item) => {
      const box = boxOf(item.key);
      return Math.max(tallest, box.y + box.height);
    }, 0) + CANVAS_PADDING;

  const beginGesture = (event: React.PointerEvent<HTMLElement>, key: string, mode: TGesture["mode"]) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const startBox = boxOf(key);
    gestureRef.current = { key, mode, pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, startBox };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ key, box: startBox });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.originX;
    const deltaY = event.clientY - gesture.originY;
    const box =
      gesture.mode === "move"
        ? { ...gesture.startBox, x: gesture.startBox.x + deltaX, y: gesture.startBox.y + deltaY }
        : { ...gesture.startBox, width: gesture.startBox.width + deltaX, height: gesture.startBox.height + deltaY };
    setDraft({ key: gesture.key, box: clampBox(box) });
  };

  const endGesture = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const box = draft?.key === gesture.key ? draft.box : gesture.startBox;
    setDraft(null);
    if (
      box.x === gesture.startBox.x &&
      box.y === gesture.startBox.y &&
      box.width === gesture.startBox.width &&
      box.height === gesture.startBox.height
    ) {
      return;
    }
    homeLayout.setBox(gesture.key, clampBox(box));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-3">
        <span className="text-11 text-tertiary">Drag the grip to move, pull the corner to resize</span>
        <button
          type="button"
          onClick={() => homeLayout.reset()}
          className="flex items-center gap-1 rounded px-2 py-1 text-11 font-medium text-tertiary hover:bg-layer-2 hover:text-primary"
        >
          <RotateCcw className="size-3.5" />
          Reset layout
        </button>
      </div>
      <div ref={canvasRef} className="relative w-full" style={{ height: canvasHeight }}>
        {items.map((item) => {
          const box = boxOf(item.key);
          const isActive = draft?.key === item.key;
          return (
            <div
              key={item.key}
              className={cn("absolute top-0 left-0", isActive && "z-10")}
              style={{ translate: `${box.x}px ${box.y}px`, width: box.width, height: box.height }}
            >
              <div className="group/wcard relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1 shadow-sm">
                <button
                  type="button"
                  aria-label={`Move the ${item.key} widget`}
                  className={cn(
                    "flex h-5 flex-shrink-0 cursor-grab touch-none items-center justify-center rounded-t-lg opacity-40 group-hover/wcard:opacity-100 focus-visible:opacity-100",
                    isActive && "cursor-grabbing opacity-100"
                  )}
                  onPointerDown={(event) => beginGesture(event, item.key, "move")}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                >
                  <GripVertical className="size-3.5 rotate-90 text-tertiary" />
                </button>
                <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">{item.node}</div>
                <button
                  type="button"
                  aria-label={`Resize the ${item.key} widget`}
                  className="absolute right-0 bottom-0 z-10 size-4 cursor-nwse-resize touch-none opacity-40 group-hover/wcard:opacity-100 focus-visible:opacity-100 pointer-coarse:size-9"
                  onPointerDown={(event) => beginGesture(event, item.key, "resize")}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                >
                  <span
                    aria-hidden
                    className="border-tertiary absolute right-[3px] bottom-[3px] size-2 border-r-2 border-b-2"
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
