/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The board where notes stay where you put them.
 *
 * The packed masonry remains the default and is untouched; this branch renders
 * only once at least one note carries stored coordinates. The two never run at
 * the same time, which is what keeps `sort_order` and the coordinates from
 * fighting: in masonry `sort_order` decides everything, on this board it decides
 * nothing and is simply preserved, so tidying up puts the notes back in the
 * order they were in before anyone started dragging.
 *
 * Position is written as an inline `translate`, recomputed on every pointer
 * frame, and carries no transition — the timeline taught us that animating a
 * property the code rewrites each frame makes the thing lag its own pointer.
 * The only motion here lives in stickies-motion.css, behind a
 * prefers-reduced-motion guard, and animates things nothing else writes.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { GripVertical } from "lucide-react";
import { cn } from "@plane/utils";
import { useSticky } from "@/hooks/use-stickies";
import { StickyNote } from "../sticky";
import type { TStickyBox } from "./sticky-free-layout.helpers";
import {
  STICKY_DEFAULT_HEIGHT,
  STICKY_DEFAULT_WIDTH,
  clampStickyBox,
  getCanvasHeight,
  getFallbackBoxes,
} from "./sticky-free-layout.helpers";

/** How far an arrow key moves or grows a note, and how far with shift held. */
const NUDGE_STEP = 8;
const NUDGE_STEP_LARGE = 40;

/** How long the keyboard is given to finish before the note is saved.
 *
 *  A pointer drag is one write because it has an end the browser tells us about.
 *  The keyboard has no such end: holding an arrow key down fires at the OS repeat
 *  rate, and every press used to be its own PATCH, so crossing a board was thirty
 *  requests racing each other to decide where the note finally sat. The note still
 *  moves on the frame the key is pressed — only the write waits. */
const KEYBOARD_COMMIT_DELAY = 400;

type TGesture = {
  stickyId: string;
  mode: "move" | "resize";
  pointerId: number;
  /** Pointer position when the gesture began, in client coordinates. */
  originX: number;
  originY: number;
  /** The note's box when the gesture began. */
  startBox: TStickyBox;
};

type Props = {
  workspaceSlug: string;
  stickyIds: string[];
  /** ARRIBADA: when true the board is a transparent full-page overlay — the canvas lets
   *  clicks fall through to whatever is under it, and only the notes themselves are
   *  interactive. Default false keeps the contained board (the All-stickies modal) unchanged. */
  overlay?: boolean;
};

export const StickiesFree = observer(function StickiesFree(props: Props) {
  const { workspaceSlug, stickyIds, overlay = false } = props;
  // store hooks
  const { stickies, updateStickyLayout } = useSticky();
  // state
  const [canvasWidth, setCanvasWidth] = useState(0);
  /** The box being dragged right now. Kept in React state, never in the store,
   *  so a gesture costs no mobx write and no network call per frame. */
  const [draft, setDraft] = useState<{ stickyId: string; box: TStickyBox } | null>(null);
  /** The note that just landed, so it can flash once and be found by eye. */
  const [landedId, setLandedId] = useState<string | null>(null);
  // refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<TGesture | null>(null);
  /** The last keyboard-made box that has not been written yet, and the timer
   *  that will write it. */
  const pendingRef = useRef<{ stickyId: string; box: TStickyBox } | null>(null);
  const commitTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    setCanvasWidth(element.offsetWidth);
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) setCanvasWidth(entry.contentRect.width);
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  // Stored coordinates, per note. A note counts as placed only when it has both
  // an x and a y; width and height fall back so that a row half-written by an
  // older client still renders something sane rather than a zero-sized note.
  const placedBoxes = useMemo(() => {
    const boxes = new Map<string, TStickyBox>();
    stickyIds.forEach((id) => {
      const sticky = stickies[id];
      if (!sticky || sticky.position_x == null || sticky.position_y == null) return;
      boxes.set(
        id,
        clampStickyBox({
          x: sticky.position_x,
          y: sticky.position_y,
          width: sticky.width ?? STICKY_DEFAULT_WIDTH,
          height: sticky.height ?? STICKY_DEFAULT_HEIGHT,
        })
      );
    });
    return boxes;
  }, [stickyIds, stickies]);

  const fallbackBoxes = useMemo(
    () =>
      getFallbackBoxes(
        stickyIds.filter((id) => !placedBoxes.has(id)),
        Array.from(placedBoxes.values()),
        canvasWidth
      ),
    [stickyIds, placedBoxes, canvasWidth]
  );

  const getBox = useCallback(
    (stickyId: string): TStickyBox => {
      if (draft?.stickyId === stickyId) return draft.box;
      return (
        placedBoxes.get(stickyId) ??
        fallbackBoxes.get(stickyId) ?? {
          x: 0,
          y: 0,
          width: STICKY_DEFAULT_WIDTH,
          height: STICKY_DEFAULT_HEIGHT,
        }
      );
    },
    [draft, placedBoxes, fallbackBoxes]
  );

  const canvasHeight = useMemo(() => getCanvasHeight(stickyIds.map((id) => getBox(id))), [stickyIds, getBox]);

  const commit = useCallback(
    (stickyId: string, box: TStickyBox) => {
      const clamped = clampStickyBox(box);
      setLandedId(stickyId);
      void updateStickyLayout(workspaceSlug, stickyId, {
        position_x: clamped.x,
        position_y: clamped.y,
        width: clamped.width,
        height: clamped.height,
      }).catch(() => {
        // The store has already rolled the note back to where it was; the
        // catch exists so an offline drag cannot reject unhandled.
      });
    },
    [updateStickyLayout, workspaceSlug]
  );

  /** Write whatever the keyboard has left pending, now. */
  const flushPending = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    commit(pending.stickyId, pending.box);
    // The store applies the layout optimistically, so by the time this returns
    // `placedBoxes` already holds the box the draft was showing — dropping the
    // draft in the same tick swaps one for the other with nothing in between.
    setDraft((current) => (current?.stickyId === pending.stickyId ? null : current));
  }, [commit]);

  /** Show the new box at once, save it when the keyboard stops. */
  const scheduleCommit = useCallback(
    (stickyId: string, box: TStickyBox) => {
      pendingRef.current = { stickyId, box };
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        flushPending();
      }, KEYBOARD_COMMIT_DELAY);
    },
    [flushPending]
  );

  // Leaving the board mid-nudge must not throw the last presses away. The ref
  // indirection is what lets the unmount effect run once, on unmount, and still
  // call the current flush rather than the one from the first render.
  const flushRef = useRef(flushPending);
  useEffect(() => {
    flushRef.current = flushPending;
  }, [flushPending]);
  useEffect(() => () => flushRef.current(), []);

  // The flash is a one-shot: clearing it lets the same note flash again the
  // next time it lands, which it would not if the class simply stayed on.
  useEffect(() => {
    if (!landedId) return;
    const timer = window.setTimeout(() => setLandedId(null), 900);
    return () => window.clearTimeout(timer);
  }, [landedId]);

  const beginGesture = (event: React.PointerEvent<HTMLElement>, stickyId: string, mode: TGesture["mode"]) => {
    // Left button only: a right-click drag has its own meaning, and a
    // two-finger gesture should scroll the board rather than move a note.
    if (event.button !== 0) return;
    // The primary pointer only. A second finger landing on the board raises a
    // fresh pointerdown, and without this it overwrote `gestureRef` — the first
    // finger's capture then went unheard, its pointerup matched no gesture, and
    // the note it was carrying snapped back to where the drag began. Which is
    // exactly what the comment above promises will not happen.
    if (!event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    // Anything the keyboard was still holding is written before the pointer
    // takes over, so a debounced nudge cannot land on top of the drag that
    // followed it.
    flushPending();
    const startBox = getBox(stickyId);
    gestureRef.current = {
      stickyId,
      mode,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startBox,
    };
    // Capture on the handle, so the gesture survives the pointer outrunning the
    // note — which it always does on a fast drag.
    event.currentTarget.setPointerCapture(event.pointerId);
    // preventDefault above stops the text selection a drag would otherwise
    // paint across the board, but it also suppresses the focus a click nor-
    // mally gives a button — and the handle's focus is what the arrow keys
    // need. So focus it by hand.
    event.currentTarget.focus();
    setDraft({ stickyId, box: startBox });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.originX;
    const deltaY = event.clientY - gesture.originY;
    const box =
      gesture.mode === "move"
        ? { ...gesture.startBox, x: gesture.startBox.x + deltaX, y: gesture.startBox.y + deltaY }
        : {
            ...gesture.startBox,
            width: gesture.startBox.width + deltaX,
            height: gesture.startBox.height + deltaY,
          };
    setDraft({ stickyId: gesture.stickyId, box: clampStickyBox(box) });
  };

  const endGesture = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const box = draft?.stickyId === gesture.stickyId ? draft.box : gesture.startBox;
    setDraft(null);
    // Nothing moved — no write, so an accidental click on the handle does not
    // count as a placement.
    if (
      box.x === gesture.startBox.x &&
      box.y === gesture.startBox.y &&
      box.width === gesture.startBox.width &&
      box.height === gesture.startBox.height
    ) {
      return;
    }
    commit(gesture.stickyId, box);
  };

  // A pointer-only board is unusable without a mouse, and both handles are
  // focusable buttons, so the arrow keys drive whichever one has focus: the grip
  // moves the note, the corner grows and shrinks it. Same keys, same steps, same
  // shift-for-a-bigger-step — the handle the user reached for is what decides
  // which of the two it means.
  const handleArrowKeys = (event: React.KeyboardEvent<HTMLElement>, stickyId: string, mode: TGesture["mode"]) => {
    const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const current = getBox(stickyId);
    const next = clampStickyBox(
      mode === "move"
        ? { ...current, x: current.x + offset[0], y: current.y + offset[1] }
        : { ...current, width: current.width + offset[0], height: current.height + offset[1] }
    );
    // Draft first so the note answers the key on the same frame; the write is
    // debounced behind it, because a held arrow key is one intention and not
    // thirty.
    setDraft({ stickyId, box: next });
    scheduleCommit(stickyId, next);
  };

  return (
    // No overflow rule here on purpose: the page already scrolls, and clipping
    // at this box would make a note dragged past the right edge unreachable.
    <div
      ref={canvasRef}
      // ARRIBADA: in overlay mode the empty canvas must not eat clicks meant for the widgets
      // underneath — only the notes (below) opt back into pointer events.
      className={cn("stickies-free-canvas relative w-full", overlay && "pointer-events-none")}
      style={{ height: canvasHeight }}
    >
      {stickyIds.map((stickyId) => {
        const box = getBox(stickyId);
        const isActive = draft?.stickyId === stickyId;
        return (
          <div
            key={stickyId}
            data-sticky-id={stickyId}
            data-lifted={isActive ? "true" : undefined}
            className={cn(
              "absolute top-0 left-0",
              // ARRIBADA: the note itself is interactive even when the canvas is click-through.
              overlay && "pointer-events-auto",
              landedId === stickyId && "sticky-landed"
            )}
            style={{
              // No transition on this. It is rewritten every pointer frame.
              translate: `${box.x}px ${box.y}px`,
              width: box.width,
              height: box.height,
            }}
          >
            {/* The handle and the grip are siblings of the note, not children,
                so the hover group has to live here for them to reveal on hover. */}
            <div className="group/sticky relative flex h-full w-full flex-col">
              {/* In flow, not overlaid. An absolutely-positioned handle still
                  swallows clicks while it is at opacity-0, and it sat over the
                  editor's first line — you could not put a caret there. */}
              <button
                type="button"
                aria-label="Move this sticky. Use the arrow keys to nudge it."
                className={cn(
                  // touch-none, or a touch drag scrolls the board and the
                  // browser cancels the pointer mid-gesture.
                  "flex h-5 flex-shrink-0 cursor-grab touch-none items-center justify-center rounded-t-sm opacity-40 group-hover/sticky:opacity-100 focus-visible:opacity-100",
                  isActive && "cursor-grabbing opacity-100"
                )}
                onPointerDown={(event) => beginGesture(event, stickyId, "move")}
                onPointerMove={handlePointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                onKeyDown={(event) => handleArrowKeys(event, stickyId, "move")}
              >
                <GripVertical className="size-3.5 rotate-90 text-placeholder" />
              </button>

              <StickyNote workspaceSlug={workspaceSlug} stickyId={stickyId} className="min-h-0 flex-1" />

              {/* The grip does overlay the note's bottom corner, which is the
                  one place a resize handle is looked for. It only matters on
                  hover, and hover is also when it becomes visible.

                  16px is a corner a mouse can hit and a finger cannot. It grows
                  to 36 on a coarse pointer only: the button sits over the editor,
                  so on a mouse the smaller square costs the note nothing, and
                  giving every user the touch-sized one would take a thumb's worth
                  of the last line away from people who never needed it. The mark
                  it draws is positioned from the corner, so it does not move.

                  The arrow keys resize from here, as they move from the grip —
                  the corner was pointer-only, which meant a note could be placed
                  without a mouse and then never resized. */}
              <button
                type="button"
                aria-label="Resize this sticky. Use the arrow keys to grow or shrink it."
                className="absolute right-0 bottom-0 z-10 size-4 cursor-nwse-resize touch-none rounded-br-sm opacity-40 group-hover/sticky:opacity-100 focus-visible:opacity-100 pointer-coarse:size-9"
                onPointerDown={(event) => beginGesture(event, stickyId, "resize")}
                onPointerMove={handlePointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                onKeyDown={(event) => handleArrowKeys(event, stickyId, "resize")}
              >
                <span
                  aria-hidden
                  className="border-placeholder absolute right-[3px] bottom-[3px] size-2 border-r-2 border-b-2"
                />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
});
