/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A per-browser layout mode for the Home widgets, and each widget's box within it.
 *
 *   straight — the built-in single column, unchanged.
 *   semi     — a snap-to-grid canvas: drag and resize freely, but placements land on a grid and
 *              never overlap; moving a widget onto another pushes the others down.
 *   free     — a true free canvas: put anything anywhere, overlaps allowed.
 *
 * Each widget carries its own box (where it sits, how big it is). A module observable, read by
 * the dashboard and written by its pointer gestures, persisted to localStorage. Nothing here is
 * per-workspace or server-side on purpose: it is a personal view preference, and keeping it local
 * means it can never send a half-saved layout to anyone else.
 */
import { action, observable } from "mobx";

const KEY = "arribada-home-layout";

/** Where one widget sits on the canvas and how big it is, in pixels from the top-left. */
export type THomeBox = { x: number; y: number; width: number; height: number };
export type THomeBoxes = Record<string, THomeBox>;

export type THomeMode = "straight" | "semi" | "free";

type TStored = { mode: THomeMode; boxes: THomeBoxes };

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
    if (!raw) return { mode: "straight", boxes: {} };
    const parsed = JSON.parse(raw);
    // The oldest shape was a two-column array; nothing maps cleanly, so start straight.
    if (Array.isArray(parsed)) return { mode: "straight", boxes: {} };
    if (parsed && typeof parsed === "object") {
      const boxes: THomeBoxes = {};
      if (parsed.boxes && typeof parsed.boxes === "object") {
        for (const [k, v] of Object.entries(parsed.boxes)) if (isBox(v)) boxes[k] = v;
      }
      // Migrate the previous shape, which had `enabled: boolean` instead of a mode.
      const mode: THomeMode =
        parsed.mode === "semi" || parsed.mode === "free" || parsed.mode === "straight"
          ? parsed.mode
          : parsed.enabled
            ? "free"
            : "straight";
      return { mode, boxes };
    }
    return { mode: "straight", boxes: {} };
  } catch {
    return { mode: "straight", boxes: {} };
  }
};

const write = (stored: TStored) => {
  try {
    if (stored.mode !== "straight" || Object.keys(stored.boxes).length > 0)
      window.localStorage.setItem(KEY, JSON.stringify(stored));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage refused — the layout still works this session, it just is not remembered.
  }
};

const initial = read();
const _mode = observable.box<THomeMode>(initial.mode);
const _boxes = observable.box<THomeBoxes>(initial.boxes);

export const homeLayout = {
  get mode(): THomeMode {
    return _mode.get();
  },
  /** Whether the dashboard is on a canvas (semi or free) rather than the straight column. Kept
   *  so the header switch and the full-width Home wrapper can ask one question. */
  get enabled(): boolean {
    return _mode.get() !== "straight";
  },
  get boxes(): THomeBoxes {
    return _boxes.get();
  },
  /** Switch layout mode. Placements are KEPT across every switch, so cycling never loses an
   *  arrangement — widgets not yet placed are laid out by the component itself. */
  setMode: action((mode: THomeMode) => {
    _mode.set(mode);
    write({ mode, boxes: _boxes.get() });
  }),
  /** Remember one widget's box after a drag or resize. */
  setBox: action((key: string, box: THomeBox) => {
    const boxes = { ..._boxes.get(), [key]: box };
    _boxes.set(boxes);
    write({ mode: _mode.get(), boxes });
  }),
  /** Replace every box at once — the snap/anti-overlap pass in semi mode commits through here. */
  setBoxes: action((boxes: THomeBoxes) => {
    _boxes.set(boxes);
    write({ mode: _mode.get(), boxes });
  }),
  /** Forget every placement and re-tidy to the default grid, staying in the current canvas. */
  reset: action(() => {
    _boxes.set({});
    write({ mode: _mode.get(), boxes: {} });
  }),
};
