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
import { useParams } from "next/navigation";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { NARROW_BLOCK_PX } from "@/components/gantt-chart/constants";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { ganttLinking } from "@/plane-web/store/gantt-linking";
import { invalidateProjectRelations } from "@/plane-web/components/gantt-chart/use-project-relations";
import { invalidateProjectSlack } from "@/plane-web/components/gantt-chart/use-project-slack";
import { isDragGesture, suppressNextClick } from "@/plane-web/components/gantt-chart/gesture";

type Props = {
  blockId: string;
  side: "left" | "right";
};

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
  const { workspaceSlug, projectId } = useParams();
  const {
    relation: { createCurrentRelation },
  } = useIssueDetail();

  /**
   * The arrows and the critical path are derived server-side and cached per
   * project, so a new link is invisible until the cache is dropped. Without this
   * the line the user just drew saves correctly and never appears — which reads
   * as the drag having failed, and invites them to draw it again.
   */
  const refreshDerived = () => {
    if (typeof workspaceSlug !== "string" || typeof projectId !== "string") return;
    invalidateProjectRelations(workspaceSlug, projectId);
    invalidateProjectSlack(workspaceSlug, projectId);
  };

  // teardown for a drag that is still in flight (used on unmount)
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      dragCleanup.current?.();
    },
    []
  );

  const source = store.linkingSourceId;
  const narrow = (store.getBlockById(blockId)?.position?.width ?? Number.POSITIVE_INFINITY) < NARROW_BLOCK_PX;
  const isSource = source === blockId;
  const isCandidate = !!source && source !== blockId;

  // create "target depends on source" (source runs first) unless it would self-link
  const link = (target: string, from: string) => {
    if (!target || target === from) return;
    // A dependency the server refused — a cycle, a cross-project link, a lost
    // connection — used to disappear without a word: the line the user had just
    // drawn was simply gone at the next refresh, with nothing to explain it.
    createCurrentRelation(target, "blocked_by", from)
      .then(refreshDerived)
      .catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Couldn't link these two",
          message: "The dependency wasn't saved. It may create a loop, or the connection dropped.",
        });
      });
  };

  // The click (no-drag) outcome, shared by pointer and keyboard. Returns true
  // when the interaction is fully resolved (link completed or source toggled
  // off) so the pointer path can stop before it arms drag tracking. Keyboard
  // users get the exact same two-step link as a click, without touching the
  // drag gesture below.
  const toggleLink = (): boolean => {
    // A source armed via an earlier click + a press on a different bar completes
    // the two-click link immediately; a press on the armed source cancels it.
    if (source && source !== blockId) {
      link(blockId, source);
      store.setLinkingSource(null);
      return true;
    }
    if (source === blockId) {
      store.setLinkingSource(null);
      return true;
    }
    // Arm this bar. For a pointer this then begins drag tracking; for a
    // keyboard this is the whole action (the second key press links).
    store.setLinkingSource(blockId);
    return false;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Space would otherwise scroll the chart; both keys must not bubble to the
    // bar's own handlers.
    e.preventDefault();
    e.stopPropagation();
    toggleLink();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Only the primary button links. Right and middle now pan the chart
    // (`use-timeline-pan.ts`), and this handler used to arm a dependency on ANY
    // button — so a right-press that happened to land on a handle turned the bar
    // blue and left it waiting to link to whatever was clicked next. Returned
    // without stopping the event, so the press reaches the pan.
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Resolve the click-equivalent outcome first. If it completed the two-click
    // link or cancelled the armed source, there is no drag to track.
    if (toggleLink()) return;

    // This bar is now armed — start tracking a possible drag.
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
      // One shared answer to "was that a click or a drag", so the two gestures
      // living on the same bar cannot disagree about it. The per-axis test this
      // replaces called a 3px-by-3px diagonal a click.
      if (!moved && isDragGesture({ dx: ev.clientX - startX, dy: ev.clientY - startY })) moved = true;
      if (moved) ganttLinking.setLine({ x1: originX, y1: originY, x2: ev.clientX, y2: ev.clientY });
    }
    function onUp(ev: PointerEvent) {
      teardown();
      if (moved) {
        // A link dragged onto another bar releases OVER that bar, and the
        // browser follows a pointerup with a click. Without this the item the
        // user linked TO opened its peek on top of the chart the instant the
        // arrow was drawn.
        suppressNextClick();
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
      onKeyDown={onKeyDown}
      aria-label="Link this work item to another"
      title={
        !source
          ? "Drag to another item to link, or click to start a dependency"
          : isSource
            ? "Click to cancel"
            : "Link: this item depends on the selected one"
      }
      // On a short bar the handle steps fully outside it. At z-20 it sits above
      // the move area, so half of it overlapping a twelve-pixel bar left nothing
      // to grab — the bar could not be dragged at all at the coarser scales.
      className={cn(
        "shadow absolute top-1/2 z-20 size-3 -translate-y-1/2 cursor-crosshair touch-none rounded-full border-2 border-white transition-opacity hover:opacity-100",
        // The 12px dot is far below a tappable target. The ::after overlay grows
        // the hit area to ~44px without taking any layout, so the bar-edge
        // offsets below stay visually identical and pointer capture is unaffected
        // (the press still lands on this same button). Same pattern the subtask
        // and milestone toggles use.
        "after:absolute after:-inset-4 after:content-['']",
        narrow ? (side === "right" ? "-right-3" : "-left-3") : side === "right" ? "-right-1.5" : "-left-1.5",
        {
          "bg-blue-500 ring-blue-300 opacity-100 ring-2": isSource,
          "bg-success-primary opacity-100": isCandidate,
          "bg-neutral-400 opacity-75": !source,
        }
      )}
    />
  );
});
