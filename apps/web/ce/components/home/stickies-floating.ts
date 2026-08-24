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
const HIDDEN_KEY = "arribada-stickies-hidden";

const readFlag = (key: string): boolean => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

const writeFlag = (key: string, value: boolean) => {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // A browser that refuses storage just forgets the choice on reload; the toggle still works.
  }
};

const _floating = observable.box<boolean>(readFlag(KEY));
const _hidden = observable.box<boolean>(readFlag(HIDDEN_KEY));

export const stickiesFloating = {
  get on(): boolean {
    return _floating.get();
  },
  toggle: action(() => {
    const next = !_floating.get();
    _floating.set(next);
    writeFlag(KEY, next);
  }),
};

/** Whether every sticky is hidden from the Home (the widget preview AND the floating overlay). */
export const stickiesHidden = {
  get on(): boolean {
    return _hidden.get();
  },
  toggle: action(() => {
    const next = !_hidden.get();
    _hidden.set(next);
    writeFlag(HIDDEN_KEY, next);
  }),
};
