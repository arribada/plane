/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Was that a click or a drag — and which button was it held with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR
 *
 * "Quand je clique sur une tâche simplement, oui ça affiche le détail. Mais si
 * je la déplace sur la timeline c'est un déplacement, je veux pas afficher le
 * détail de la tâche."
 *
 * A bar carries `onMouseDown` (start a move — `use-gantt-resizable.ts`) and
 * `onClick` (open the peek — `issue-layouts/gantt/blocks.tsx`) on overlapping
 * elements. The browser fires `click` after ANY mousedown/mouseup pair on the
 * same subtree, and because the bar travels WITH the cursor the release almost
 * always lands back on the bar it started on. So every drag ended by opening the
 * work item the user had just finished moving, over the plan they were reading.
 *
 * There is no DOM flag for "this mouseup concluded a drag". The only honest
 * discriminator is how far the pointer travelled between press and release, so
 * that is what this measures.
 *
 * WHY DISTANCE AND NOT TIME. Time inverts the answer as often as it gives it: a
 * careful click on a trackpad takes 300 ms and a flick-drag across two months
 * takes 80. A press that did not move is a click however long it was held, and a
 * press that crossed the screen is a drag however fast. Distance is the fact.
 *
 * WHY A THRESHOLD AND NOT `> 0`. A mouse jitters by a pixel or two under a
 * click, and a trackpad tap jitters more; `dx !== 0` would classify most real
 * clicks as drags and the peek would stop opening at all — the opposite defect,
 * and a worse one, because the panel is the only way into the work item from
 * here. Four pixels is the number the dependency handle already chose for the
 * same question (`blockDraggables/handle.tsx`), and it is shared from here now
 * so the two gestures on the same bar cannot disagree about what a click is.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything above the `suppressNextClick` line is pure: it reads numbers and
 * returns a decision. jsdom has no drag physics — no pointer capture, no
 * layout, no compositor — so the gesture itself needs a real mouse, but "is this
 * mouseup a click or a drag" is a question a test can ask without one.
 */

/** Pixels a press may travel and still count as a click. */
export const DRAG_THRESHOLD_PX = 4;

/** How far a press travelled, in CSS pixels. Signed; only the magnitude matters. */
export type TPressTravel = { dx: number; dy: number };

/**
 * Did this press move far enough to be a drag?
 *
 * Euclidean rather than per-axis: a press dragged 3px right and 3px down has
 * travelled 4.24px, and `Math.abs(dx) > 4 || Math.abs(dy) > 4` calls that a
 * click. On a chart where the useful direction is diagonal-ish (a bar moves
 * horizontally while the cursor drifts down a row) the per-axis test is
 * systematically too permissive.
 */
export const isDragGesture = (travel: TPressTravel, thresholdPx: number = DRAG_THRESHOLD_PX): boolean =>
  Math.hypot(travel.dx, travel.dy) > thresholdPx;

/**
 * The same decision, named the way the call sites talk about it.
 *
 * `"click"` means "let the click through — open the peek"; `"drag"` means "this
 * gesture already did its work; swallow the click that is about to follow".
 */
export const classifyPress = (travel: TPressTravel, thresholdPx: number = DRAG_THRESHOLD_PX): "click" | "drag" =>
  isDragGesture(travel, thresholdPx) ? "drag" : "click";

/* ─────────────────────────── panning the chart ─────────────────────────── */

/** Secondary (right) button, as `MouseEvent.button` numbers it. */
export const MOUSE_BUTTON_RIGHT = 2;
/** Auxiliary (middle / wheel) button. */
export const MOUSE_BUTTON_MIDDLE = 1;

/**
 * Whether this button starts a pan.
 *
 * Right AND middle, because they are the two idioms people arrive with — right
 * drag from Gantt tools and spreadsheets, middle drag from maps and CAD — and
 * neither is doing anything else on this surface. The PRIMARY button is
 * deliberately not a pan: it already moves bars, resizes them, draws dependency
 * links, reorders rows and marquee-selects, and a fifth meaning for it would
 * have to steal from one of those.
 */
export const isPanButton = (button: number): boolean => button === MOUSE_BUTTON_RIGHT || button === MOUSE_BUTTON_MIDDLE;

export type TScrollPosition = { left: number; top: number };
export type TPoint = { x: number; y: number };
export type TScrollLimits = { maxLeft: number; maxTop: number };

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), Math.max(max, 0));

/**
 * Where the chart should be scrolled to after the pointer moved from `from` to
 * `to`.
 *
 * The content follows the cursor — grab the plan and pull it — so the scroll
 * offset moves AGAINST the pointer. Dragging right reveals earlier dates, which
 * is the direction every map, PDF viewer and drawing tool agrees on and the
 * opposite of what "scroll right" would do.
 *
 * Deliberately expressed as one STEP between two consecutive pointer positions
 * rather than as an absolute offset from where the press began. Panning to
 * either edge makes the chart extend its date range
 * (`updateCurrentViewRenderPayload`), and extending it to the LEFT prepends
 * columns and re-anchors `scrollLeft` by the width added — `chart/root.tsx:74`.
 * A baseline captured at mousedown is wrong from that moment on, and the plan
 * would jump out from under the cursor mid-pan. A step is immune to it: it only
 * ever asks where the container is NOW.
 */
export const panStep = (
  current: TScrollPosition,
  from: TPoint,
  to: TPoint,
  limits: TScrollLimits
): TScrollPosition => ({
  left: clamp(current.left - (to.x - from.x), limits.maxLeft),
  top: clamp(current.top - (to.y - from.y), limits.maxTop),
});

/* ────────────────────────── swallowing the click ────────────────────────── */

/**
 * Swallow the `click` the browser is about to synthesise for the gesture that
 * has just ended.
 *
 * Capture phase on `document`, which is above React's own root-container
 * listener, so `stopImmediatePropagation` reaches it before any `onClick` in the
 * tree — including `blocks.tsx`'s peek handler, which is in a file this fix
 * deliberately does not touch. That is the point of doing it here: EVERY gesture
 * that ends in a mouseup on a bar (move, both resize edges, a dependency link
 * dragged from a handle, a right-button pan that happened to start over a bar)
 * calls this one function, instead of each of them having to know which onClick
 * handlers exist downstream.
 *
 * The timeout is not optional. A gesture that ends over empty chart produces no
 * click at all, and a listener left armed would eat the user's NEXT real click —
 * minutes later, on something else entirely. `click` is dispatched immediately
 * after `mouseup` and before timers run, so a 0 ms timeout is late enough to
 * catch the click and early enough that nothing else can slip through. This is
 * the same shape `d3-drag` uses, for the same reason.
 */
export const suppressNextClick = (target: EventTarget = document): void => {
  // A FRESH function per call, deliberately. `addEventListener` dedupes on
  // (type, callback, capture), so a module-scope `swallow` would make a second
  // arming a no-op and let the first call's timeout disarm the second's click.
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- per-call identity is the point; see above
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  target.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => target.removeEventListener("click", swallow, { capture: true }), 0);
};
