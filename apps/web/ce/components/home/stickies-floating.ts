/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A tiny shared toggle: are the Home stickies floating over the whole page, or shown as the
 * normal preview? It is a per-browser preference (localStorage), read by the stickies widget
 * (which owns the button) and by the Home root (which mounts the full-page overlay). A module
 * observable is enough — nothing about this needs the server, and it must be readable from two
 * components that do not share a parent.
 */
import { action, observable } from "mobx";

const KEY = "arribada-stickies-floating";

const readInitial = (): boolean => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const _floating = observable.box<boolean>(readInitial());

export const stickiesFloating = {
  get on(): boolean {
    return _floating.get();
  },
  toggle: action(() => {
    const next = !_floating.get();
    _floating.set(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // A browser that refuses storage just forgets the choice on reload; the toggle still works.
    }
  }),
};
