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
 */
import { useEffect, useRef } from "react";

type Options = {
  /** Nothing runs while this is false, so it can be called unconditionally. */
  open: boolean;
  onClose: () => void;
  /** Set while a write is in flight: Escape must not discard work mid-save. */
  busy?: boolean;
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

export const useModalShell = ({ open, onClose, busy = false }: Options) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    // Whoever opened it gets the focus back, or it lands on <body> and the next
    // Tab starts from the top of the page.
    restoreTo.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // Skip the click-away backdrop: it is first in the DOM and its only action is
    // to close, which is a hostile place to put someone arriving by keyboard.
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.stopPropagation();
        onClose();
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
  }, [open, busy, onClose]);

  /**
   * Spread onto the panel element. `tabIndex={-1}` makes the panel itself
   * focusable as a fallback for a dialog that contains nothing focusable yet.
   */
  return {
    panelProps: {
      ref: panelRef,
      role: "dialog" as const,
      "aria-modal": true,
      tabIndex: -1,
    },
  };
};
