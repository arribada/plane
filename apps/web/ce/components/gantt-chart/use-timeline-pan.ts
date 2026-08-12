/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Grab the plan and pull it. Right-button (or middle-button) drag pans the
 * timeline.
 *
 * "sur une vue timeline (portfolio aussi), prends en compte le clic droit qui me
 * permet de déplacer droite/gauche la timeline."
 *
 * Before this the only ways across a plan were the horizontal scrollbar at the
 * very bottom of a tall chart, a shift-wheel most people never learn, and the
 * zoom control — none of which is the gesture anybody arrives with. Every other
 * pannable surface in this product's neighbourhood (a map, a PDF, a drawing
 * tool) answers a press-and-pull, and a Gantt is the same kind of object: a
 * viewport onto something wider than the screen.
 *
 * ── the decisions ───────────────────────────────────────────────────────────
 *
 * WHY THE CONTAINER, AND ONLY HERE. `#gantt-container` is the single scrolling
 * element for both the sidebar and the chart, and it is mounted by
 * `chart/main-content.tsx`, which the per-project timeline AND the portfolio
 * both render. One wiring covers both views; two wirings would be two chances
 * for them to feel different.
 *
 * WHY CAPTURE PHASE. A press that starts ON A BAR has to pan, not begin a bar
 * move. Taking the event on the way down and stopping it there means no
 * descendant handler ever sees a non-primary press — the bar drag, the
 * dependency handle, the row reorder and the marquee selection are all left
 * exactly as they were, rather than each having to learn about panning.
 *
 * WHY IT PANS VERTICALLY TOO. The requirement is left/right, and that is the
 * axis that matters. But this is ONE element scrolling in both directions, and
 * a grab that moves the plan sideways while refusing to move it up reads as a
 * stuck viewport rather than as a deliberate restriction — on a programme with
 * two hundred rows the vertical reach is worth as much. Both axes, from the same
 * grab, is also what every surface this borrows the gesture from does.
 *
 * WHY MIDDLE-BUTTON AS WELL. It is the same gesture in CAD and mapping tools and
 * it costs one comparison. `preventDefault` on its mousedown also suppresses
 * Windows' auto-scroll widget, which would otherwise hijack the drag.
 *
 * THE CONTEXT MENU. Suppressed for the whole press, not merely after movement is
 * detected — because the platforms disagree about WHEN `contextmenu` fires.
 * Windows fires it on mouse-UP, so "suppress once we know it was a pan" would
 * work there; macOS and X11 fire it on mouse-DOWN, before a single pixel has
 * moved, and the menu would open under the cursor and eat the gesture. The cost
 * is that a plain right-click inside the chart no longer opens the browser menu
 * on those platforms. That is the correct trade here — there is no custom
 * context menu on this surface to lose, and a pan that only works on one
 * operating system is not a feature.
 */
import { useEffect, useState, type RefObject } from "react";
import { isDragGesture, isPanButton, panStep, suppressNextClick } from "./gesture";

/**
 * Wires right/middle-button panning onto a scroll container.
 *
 * @returns whether a pan is in progress, for the cursor affordance.
 */
export const useTimelinePan = (containerRef: RefObject<HTMLDivElement | null>): boolean => {
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    // Non-null only between mousedown and mouseup. `armed` is what the
    // contextmenu handler reads, and what makes a torn-down gesture inert.
    let armed: { lastX: number; lastY: number; totalX: number; totalY: number } | null = null;
    // Kept for one turn of the event loop after the release, so Windows — which
    // fires `contextmenu` on mouse-UP — does not pop a menu at the end of a pan
    // the user has just finished.
    let justPanned = false;
    // Local rather than read back off the `isPanning` state: this effect runs
    // once, so the state it closed over is frozen at `false` and would set the
    // flag again on every single mouse move.
    let cursorShown = false;

    const stop = () => {
      if (!armed) return;
      const travel = { dx: armed.totalX, dy: armed.totalY };
      armed = null;
      cursorShown = false;
      setIsPanning(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onWindowBlur);
      if (!isDragGesture(travel)) return;
      justPanned = true;
      setTimeout(() => {
        justPanned = false;
      }, 0);
      // A pan that began over a bar would otherwise open that bar's peek on
      // release — the same defect the bar drag has, reached by a different
      // button. See `gesture.ts`.
      suppressNextClick();
    };

    function onMouseMove(event: MouseEvent) {
      if (!armed) return;
      const container = containerRef.current;
      if (!container) return;
      // Read the container's live offsets every step. Panning to either edge
      // makes the chart extend its date range, and extending it leftwards
      // prepends columns and re-anchors `scrollLeft` (`chart/root.tsx:74`) —
      // an offset remembered from mousedown would be wrong from that moment on
      // and the plan would jump out from under the cursor.
      const next = panStep(
        { left: container.scrollLeft, top: container.scrollTop },
        { x: armed.lastX, y: armed.lastY },
        { x: event.clientX, y: event.clientY },
        {
          maxLeft: container.scrollWidth - container.clientWidth,
          maxTop: container.scrollHeight - container.clientHeight,
        }
      );
      container.scrollLeft = next.left;
      container.scrollTop = next.top;
      armed.totalX += event.clientX - armed.lastX;
      armed.totalY += event.clientY - armed.lastY;
      armed.lastX = event.clientX;
      armed.lastY = event.clientY;
      // Only once it is really a pan, so a right-click that jitters by a pixel
      // does not flash the grabbing cursor.
      if (!cursorShown && isDragGesture({ dx: armed.totalX, dy: armed.totalY })) {
        cursorShown = true;
        setIsPanning(true);
      }
    }

    function onMouseUp() {
      stop();
    }

    // A drag interrupted by an alt-tab or a devtools break never gets its
    // mouseup. Without this the chart would keep panning on the next mouse move
    // with no button held.
    function onWindowBlur() {
      stop();
    }

    const onMouseDown = (event: MouseEvent) => {
      if (!isPanButton(event.button)) return;
      // Stopped here, on the way down: nothing below this node — bar move, bar
      // resize, dependency handle, row reorder, marquee selection — ever sees a
      // non-primary press.
      event.stopPropagation();
      // Suppresses the middle-button auto-scroll widget and the text selection a
      // press would otherwise begin.
      event.preventDefault();
      armed = { lastX: event.clientX, lastY: event.clientY, totalX: 0, totalY: 0 };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      window.addEventListener("blur", onWindowBlur);
    };

    const onContextMenu = (event: MouseEvent) => {
      if (armed || justPanned) event.preventDefault();
    };

    element.addEventListener("mousedown", onMouseDown, { capture: true });
    element.addEventListener("contextmenu", onContextMenu);

    return () => {
      stop();
      element.removeEventListener("mousedown", onMouseDown, { capture: true });
      element.removeEventListener("contextmenu", onContextMenu);
    };
    // The node is the scroll container, mounted once for the life of the chart;
    // `isPanning` is read only to avoid a redundant setState and must not re-run
    // this effect, which would tear down a gesture in progress.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [containerRef]);

  return isPanning;
};
