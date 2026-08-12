/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Was that a click or a drag", and "where does a pan land".
 *
 * The bugs these pin:
 *
 * 1. Dragging a bar opened the work item. `click` fires after any
 *    mousedown/mouseup pair on the same subtree, and the bar travels with the
 *    cursor, so a move always ended on the element it started on and the peek
 *    always opened over the plan the user was rearranging.
 * 2. The opposite failure, which a naive fix creates: `dx !== 0` classifies an
 *    ordinary jittery click as a drag, and then the peek stops opening at all —
 *    worse, because the panel is the only way into a work item from the chart.
 * 3. A pan measured from where the press began drifts, because reaching either
 *    edge makes the chart prepend or append columns and re-anchor `scrollLeft`
 *    (`chart/root.tsx:74`). Steps between consecutive positions cannot drift.
 *
 * The gesture itself — pointer capture, hit testing, the compositor — needs a
 * real mouse. These are the decisions behind it.
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyPress,
  DRAG_THRESHOLD_PX,
  isDragGesture,
  isPanButton,
  MOUSE_BUTTON_MIDDLE,
  MOUSE_BUTTON_RIGHT,
  panStep,
  suppressNextClick,
} from "./gesture";

describe("isDragGesture", () => {
  it("calls a press that never moved a click", () => {
    expect(isDragGesture({ dx: 0, dy: 0 })).toBe(false);
    expect(classifyPress({ dx: 0, dy: 0 })).toBe("click");
  });

  it("tolerates the pixel or two a real click jitters by", () => {
    // The peek must still open. A `dx !== 0` test fails here, and taking the
    // panel away from the chart is a worse defect than the one being fixed.
    expect(isDragGesture({ dx: 2, dy: 1 })).toBe(false);
    expect(isDragGesture({ dx: -3, dy: 0 })).toBe(false);
  });

  it("calls a press that crossed the threshold a drag", () => {
    expect(isDragGesture({ dx: 12, dy: 0 })).toBe(true);
    expect(classifyPress({ dx: 12, dy: 0 })).toBe("drag");
  });

  it("measures the diagonal, not each axis on its own", () => {
    // 3px right and 3px down is 4.24px travelled. Per-axis (`|dx| > 4 || |dy| >
    // 4`) calls this a click — and a bar dragged across a row moves diagonally,
    // so the per-axis test is systematically too permissive exactly here.
    expect(Math.hypot(3, 3)).toBeGreaterThan(DRAG_THRESHOLD_PX);
    expect(isDragGesture({ dx: 3, dy: 3 })).toBe(true);
  });

  it("does not care which direction the press travelled in", () => {
    expect(isDragGesture({ dx: -40, dy: 0 })).toBe(true);
    expect(isDragGesture({ dx: 0, dy: -40 })).toBe(true);
  });

  it("is exclusive at the threshold, so exactly 4px is still a click", () => {
    expect(isDragGesture({ dx: DRAG_THRESHOLD_PX, dy: 0 })).toBe(false);
    expect(isDragGesture({ dx: DRAG_THRESHOLD_PX + 0.5, dy: 0 })).toBe(true);
  });

  it("accepts a caller-supplied threshold", () => {
    expect(isDragGesture({ dx: 8, dy: 0 }, 20)).toBe(false);
  });
});

describe("isPanButton", () => {
  it("pans on the right button — the gesture the report asked for", () => {
    expect(isPanButton(MOUSE_BUTTON_RIGHT)).toBe(true);
  });

  it("pans on the middle button too, the other idiom people arrive with", () => {
    expect(isPanButton(MOUSE_BUTTON_MIDDLE)).toBe(true);
  });

  it("leaves the primary button alone", () => {
    // It already moves bars, resizes them, links dependencies, reorders rows and
    // marquee-selects. A fifth meaning would have to steal from one of those.
    expect(isPanButton(0)).toBe(false);
  });
});

describe("panStep", () => {
  const limits = { maxLeft: 1000, maxTop: 500 };

  it("moves the content with the cursor, not against it", () => {
    // Drag right by 30 -> earlier dates come into view -> scrollLeft decreases.
    expect(panStep({ left: 200, top: 0 }, { x: 100, y: 0 }, { x: 130, y: 0 }, limits).left).toBe(170);
  });

  it("pans vertically as well as horizontally", () => {
    // One element scrolls in both axes (`#gantt-container` is `overflow-auto`),
    // and a grab that moves the plan sideways but not up reads as a stuck
    // viewport on a plan hundreds of rows long.
    expect(panStep({ left: 0, top: 300 }, { x: 0, y: 100 }, { x: 0, y: 140 }, limits).top).toBe(260);
  });

  it("stops at the left edge instead of going negative", () => {
    expect(panStep({ left: 10, top: 0 }, { x: 0, y: 0 }, { x: 400, y: 0 }, limits).left).toBe(0);
  });

  it("stops at the far edge instead of running past the content", () => {
    expect(panStep({ left: 900, top: 0 }, { x: 400, y: 0 }, { x: 0, y: 0 }, limits).left).toBe(1000);
  });

  it("survives a container that cannot scroll at all", () => {
    // A chart narrower than its pane reports a negative max once the client
    // width is subtracted; clamping to a negative ceiling would scroll it
    // backwards.
    expect(panStep({ left: 0, top: 0 }, { x: 0, y: 0 }, { x: -50, y: -50 }, { maxLeft: -20, maxTop: -20 })).toEqual({
      left: 0,
      top: 0,
    });
  });

  it("is a step between two positions, so an edge re-anchor cannot make it drift", () => {
    // Panning to the left edge prepends columns and adds `width` to scrollLeft.
    // A pan measured from the press origin would fight that; a step just reads
    // wherever the container is now.
    const afterReanchor = { left: 800, top: 0 };
    expect(panStep(afterReanchor, { x: 100, y: 0 }, { x: 110, y: 0 }, limits).left).toBe(790);
  });
});

describe("suppressNextClick", () => {
  it("swallows the click the browser synthesises after a drag", () => {
    const listener = vi.fn();
    document.addEventListener("click", listener);
    suppressNextClick();
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.removeEventListener("click", listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("swallows exactly one click, not every click that follows", () => {
    const listener = vi.fn();
    document.addEventListener("click", listener);
    suppressNextClick();
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.removeEventListener("click", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("disarms itself when the gesture produced no click at all", async () => {
    // A drag released over empty chart fires no click. Left armed, the listener
    // would eat the user's next real click minutes later, on something else.
    const listener = vi.fn();
    document.addEventListener("click", listener);
    suppressNextClick();
    await new Promise((resolve) => setTimeout(resolve, 1));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.removeEventListener("click", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
