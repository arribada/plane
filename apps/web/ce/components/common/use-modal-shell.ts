/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The four things every dialog owes a keyboard, in one hook.
 *
 * Eight dialogs in this fork hand-roll the same overlay — a fixed backdrop and a
 * panel — and each of them was a trap: no Escape, no focus moved in, focus free to
 * wander behind the backdrop, and the page still scrolling underneath. Worse, the
 * backdrop is a full-screen <button> for click-away, so it lands FIRST in tab
 * order: tabbing into any of these dialogs put the caret on an invisible control
 * whose only action is to throw away what you were doing.
 *
 * A hook rather than a component so it can be dropped into each of them without
 * touching their layout, which is the part they legitimately differ on.
 *
 * It also hands back the two things the first pass left to each caller and three
 * of them then got wrong: an accessible name for the dialog, and a backdrop that
 * closes on click without being a control. Both live here so the next dialog
 * gets them by writing no code at all.
 */
import { useCallback, useEffect, useRef } from "react";

type Options = {
  /** Nothing runs while this is false, so it can be called unconditionally. */
  open: boolean;
  onClose: () => void;
  /** Set while a write is in flight: Escape must not discard work mid-save. */
  busy?: boolean;
  /**
   * The dialog's accessible name — pass the same string the visible heading
   * shows. Without one a screen reader announces "dialog" and nothing else, so
   * arriving in one tells you only that you have arrived somewhere.
   *
   * `aria-label` rather than `aria-labelledby` because every dialog here already
   * has its heading text as a plain string in hand, while an id has to be minted
   * and threaded down to whichever element ends up rendering it — and a shared
   * shell whose title is a prop is exactly where that thread gets dropped. A
   * dangling `aria-labelledby` names the dialog nothing at all, which is worse
   * than the gap it was meant to close.
   */
  label?: string;
};

/** Everything a keyboard can land on, in document order. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Opt out of "focus the first thing" when the first thing is not the point.
 * A dialog whose one job is to take a number should open on that number's
 * field, not on the close button that happens to be earlier in the markup.
 * Declared in the markup rather than passed as a ref or a selector so it sits
 * on the element it describes.
 */
const INITIAL_FOCUS = "[data-modal-initial-focus]";

export const useModalShell = ({ open, onClose, busy = false, label }: Options) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  // Read through refs so the effect below depends on `open` alone. It had `busy`
  // and `onClose` in its deps, and every re-run tears the shell down and builds
  // it again — which means restoring focus to the opener and then dragging it
  // back to the first field. With a caller that passes an inline `onClose` that
  // is every single render: type a character, lose the caret. `busy` flipping
  // did the same thing at exactly the wrong moment, mid-save.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return undefined;

    // Whoever opened it gets the focus back, or it lands on <body> and the next
    // Tab starts from the top of the page.
    restoreTo.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // Skip the click-away backdrop: it is first in the DOM and its only action is
    // to close, which is a hostile place to put someone arriving by keyboard.
    // Falling back to the panel matters for the dialogs that open on "Loading…"
    // and have nothing focusable yet — without it focus stays on the button
    // behind the overlay, and the trap below has nothing to trap.
    const first = panel?.querySelector<HTMLElement>(INITIAL_FOCUS) ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) return;

      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      // Only the edges are intercepted; inside the panel Tab behaves normally.
      if (document.activeElement === edge || !panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open]);

  // Escape is the keyboard route out; this is only the pointer one. Guarded by
  // `busy` for the same reason Escape is: a stray click on the backdrop must not
  // throw away a save that is already on its way.
  const onBackdropClick = useCallback(() => {
    if (!busyRef.current) onCloseRef.current();
  }, []);

  /**
   * Spread onto the panel element. `tabIndex={-1}` makes the panel itself
   * focusable as a fallback for a dialog that contains nothing focusable yet.
   *
   * `backdropProps` go on the click-away layer, which must be a plain element
   * and not the <button> these dialogs kept reaching for: a full-screen button
   * is announced, sits FIRST in tab order, and its only action is to discard
   * what you came to do. `aria-hidden` keeps it out of the accessibility tree
   * entirely — there is nothing there to describe, and no key needs to reach it.
   */
  return {
    panelProps: {
      ref: panelRef,
      role: "dialog" as const,
      "aria-modal": true,
      ...(label ? { "aria-label": label } : {}),
      tabIndex: -1,
    },
    backdropProps: {
      onClick: onBackdropClick,
      "aria-hidden": true,
    },
  };
};
