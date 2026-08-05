/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Close a popup by clicking away from it or pressing Escape.
 *
 * Written because a comment in this fork claims a bare <details>/<summary> pair
 * "closes on Escape and on an outside click for free". It does not. <details> is
 * a disclosure widget: the only thing that toggles it is its own <summary>. Every
 * menu built on one therefore stays open — over the rest of the toolbar, over
 * whatever you clicked next — until you go back and click the summary again.
 *
 * Escape also puts focus back on the summary. Dismissing a menu that holds the
 * caret and leaving the caret on the element that just disappeared is how a
 * keyboard user ends up back at the top of the page on the next Tab.
 *
 * Deliberately not the same thing as `useModalShell`: a menu is dismissible and
 * does not trap. Tabbing out of one should close it and carry on, not be caught
 * and returned. The two behaviours are different, so they are two files.
 */
import { useEffect, useRef } from "react";

type Options = {
  /** Nothing is bound while this is false, so it can be called unconditionally. */
  open: boolean;
  onDismiss: () => void;
};

/** Attach the returned ref to the popup's root — for a menu, the <details>. */
export const useLightDismiss = <T extends HTMLElement>({ open, onDismiss }: Options) => {
  const ref = useRef<T | null>(null);

  // Through a ref so the effect depends on `open` alone: callers pass an inline
  // arrow, and re-binding on every render is a listener churn nobody asked for.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return undefined;

    // pointerdown, not click: by the time a click completes the thing under the
    // pointer may have moved, and the menu should be gone the moment you commit
    // to somewhere else. Capture phase so a handler that stops propagation
    // on the way up cannot leave the menu stuck open.
    const onPointerDown = (event: Event) => {
      const root = ref.current;
      if (root && !root.contains(event.target as Node)) onDismissRef.current();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const root = ref.current;
      if (!root) return;
      // Only the menu holding the focus answers Escape, so two open menus do not
      // both close on one key, and Escape still reaches whatever is behind an
      // untouched one.
      if (!root.contains(document.activeElement)) return;
      event.stopPropagation();
      onDismissRef.current();
      root.querySelector<HTMLElement>("summary")?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return ref;
};
