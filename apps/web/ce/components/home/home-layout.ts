/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A per-browser free layout for the Home widgets: each widget carries its own box — where it
 * sits and how big it is — on a canvas you arrange by dragging and resizing, exactly like the
 * free-placement stickies board. `enabled` off means "no custom layout", the built-in
 * single-column stack. A module observable, read by the dashboard and written by its pointer
 * gestures, persisted to localStorage. Nothing here is per-workspace or server-side on purpose:
 * it is a personal view preference, and keeping it local means it can never send a half-saved
 * layout to anyone else.
 */
import { action, observable } from "mobx";

const KEY = "arribada-home-layout";

/** Where one widget sits on the canvas and how big it is, in pixels from the top-left. */
export type THomeBox = { x: number; y: number; width: number; height: number };
export type THomeBoxes = Record<string, THomeBox>;

type TStored = { enabled: boolean; boxes: THomeBoxes };

const isBox = (b: unknown): b is THomeBox =>
  !!b &&
  typeof b === "object" &&
  typeof (b as THomeBox).x === "number" &&
  typeof (b as THomeBox).y === "number" &&
  typeof (b as THomeBox).width === "number" &&
  typeof (b as THomeBox).height === "number";

const read = (): TStored => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return { enabled: false, boxes: {} };
    const parsed = JSON.parse(raw);
    // The old shape was a two-column array. It cannot be mapped to boxes cleanly, so a browser
    // that still holds it simply starts fresh in the single column — nothing is lost that a
    // second "Customise" click does not rebuild.
    if (Array.isArray(parsed)) return { enabled: false, boxes: {} };
    if (parsed && typeof parsed === "object") {
      const boxes: THomeBoxes = {};
      if (parsed.boxes && typeof parsed.boxes === "object") {
        for (const [k, v] of Object.entries(parsed.boxes)) if (isBox(v)) boxes[k] = v;
      }
      return { enabled: !!parsed.enabled, boxes };
    }
    return { enabled: false, boxes: {} };
  } catch {
    return { enabled: false, boxes: {} };
  }
};

const write = (stored: TStored) => {
  try {
    if (stored.enabled) window.localStorage.setItem(KEY, JSON.stringify(stored));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage refused — the layout still works this session, it just is not remembered.
  }
};

const initial = read();
const _enabled = observable.box<boolean>(initial.enabled);
const _boxes = observable.box<THomeBoxes>(initial.boxes);

export const homeLayout = {
  get enabled(): boolean {
    return _enabled.get();
  },
  get boxes(): THomeBoxes {
    return _boxes.get();
  },
  /** Switch between the free canvas and the straight single column. Placements are KEPT either
   *  way, so flipping back and forth never loses an arrangement — that is the whole point of a
   *  toggle rather than the old destructive "Customise/Reset" pair. Widgets not yet placed are
   *  laid out by the layout component itself, so no seeding is needed here. */
  setEnabled: action((value: boolean) => {
    _enabled.set(value);
    write({ enabled: value, boxes: _boxes.get() });
  }),
  /** Remember one widget's box after a drag or resize. */
  setBox: action((key: string, box: THomeBox) => {
    const boxes = { ..._boxes.get(), [key]: box };
    _boxes.set(boxes);
    write({ enabled: _enabled.get(), boxes });
  }),
  /** Forget every placement and re-tidy to the default grid, staying in the free canvas. */
  reset: action(() => {
    _boxes.set({});
    write({ enabled: _enabled.get(), boxes: {} });
  }),
};
