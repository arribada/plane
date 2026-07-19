/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Dependency handle on a gantt bar. Two ways to link two work items:
 *  - Drag: press this handle, drag to another bar, release -> that bar depends on this one.
 *  - Click: click this handle (it arms, turning blue), then click any bar's handle -> link.
 * Uses pointer capture so pointerup is delivered even when the release happens
 * outside the viewport, and tears the gesture down on pointercancel / unmount —
 * so an aborted drag can never leave a ghost line or fire a stale link. The bar
 * resize/move handlers are untouched; this lives entirely in the additive handles.
 */
import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
import { cn } from "@plane/utils";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { ganttLinking } from "@/plane-web/store/gantt-linking";

type Props = {
  blockId: string;
  side: "left" | "right";
};

const DRAG_THRESHOLD = 4; // px before a press counts as a drag rather than a click

// find the gantt bar under a screen point and return its issue id (bars carry id="issue-<id>")
const targetIssueAt = (x: number, y: number): string | null => {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const bar = el?.closest?.('[id^="issue-"]') as HTMLElement | null;
  if (!bar?.id) return null;
  const id = bar.id.slice("issue-".length);
  return id || null;
};

export const DependencyHandle = observer(function DependencyHandle({ blockId, side }: Props) {
  const store = useTimeLineChartStore();
  const {
    relation: { createCurrentRelation },
  } = useIssueDetail();

  // teardown for a drag that is still in flight (used on unmount)
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      dragCleanup.current?.();
    },
    []
  );

  const source = store.linkingSourceId;
  const isSource = source === blockId;
  const isCandidate = !!source && source !== blockId;

  // create "target depends on source" (source runs first) unless it would self-link
  const link = (target: string, from: string) => {
    if (!target || target === from) return;
    createCurrentRelation(target, "blocked_by", from).catch(() => {});
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // A source armed via an earlier click + a press on a different bar completes
    // the two-click link immediately; a press on the armed source cancels it.
    if (source && source !== blockId) {
      link(blockId, source);
      store.setLinkingSource(null);
      return;
    }
    if (source === blockId) {
      store.setLinkingSource(null);
      return;
    }

    // Arm this bar and start tracking a possible drag.
    store.setLinkingSource(blockId);
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let moved = false;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* capture unsupported — window still gets the events */
    }

    // function declarations (hoisted) so finish can reference the handlers and vice-versa
    function teardown() {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("lostpointercapture", onCancel);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      ganttLinking.clear();
      dragCleanup.current = null;
    }
    function onMove(ev: PointerEvent) {
      if (!moved && (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD)) {
        moved = true;
      }
      if (moved) ganttLinking.setLine({ x1: originX, y1: originY, x2: ev.clientX, y2: ev.clientY });
    }
    function onUp(ev: PointerEvent) {
      teardown();
      if (moved) {
        // a drag: link to whatever bar we released over, then disarm
        const target = targetIssueAt(ev.clientX, ev.clientY);
        if (target) link(target, blockId);
        store.setLinkingSource(null);
      }
      // a plain click (no drag) leaves this bar armed for the two-click gesture
    }
    function onCancel() {
      // pointer cancelled or capture lost (window blur, unmount) — abort, never link
      teardown();
      store.setLinkingSource(null);
    }

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("lostpointercapture", onCancel);
    dragCleanup.current = onCancel;
  };

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      title={
        !source
          ? "Drag to another item to link, or click to start a dependency"
          : isSource
            ? "Click to cancel"
            : "Link: this item depends on the selected one"
      }
      className={cn(
        "absolute top-1/2 z-20 size-3 -translate-y-1/2 cursor-crosshair touch-none rounded-full border-2 border-white shadow transition-opacity hover:opacity-100",
        side === "right" ? "-right-1.5" : "-left-1.5",
        {
          "bg-blue-500 opacity-100 ring-2 ring-blue-300": isSource,
          "bg-emerald-500 opacity-100": isCandidate,
          "bg-neutral-400 opacity-50": !source,
        }
      )}
    />
  );
});
