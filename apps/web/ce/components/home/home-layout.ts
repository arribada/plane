/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A per-browser custom layout for the Home widgets: which of the two columns each widget sits
 * in, and in what order. `null` means "no custom layout" — the built-in single-column stack.
 * A module observable, read by the dashboard and written by its drag-and-drop, persisted to
 * localStorage. Nothing here is per-workspace or server-side on purpose: it is a personal view
 * preference, and keeping it local means it can never send a half-saved layout to anyone else.
 */
import { action, observable } from "mobx";

const KEY = "arribada-home-layout";

/** Two columns of widget keys. */
export type THomeColumns = [string[], string[]];

const read = (): THomeColumns | null => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2 && Array.isArray(parsed[0]) && Array.isArray(parsed[1])) {
      return [parsed[0].filter((k) => typeof k === "string"), parsed[1].filter((k) => typeof k === "string")];
    }
    return null;
  } catch {
    return null;
  }
};

const write = (columns: THomeColumns | null) => {
  try {
    if (columns) window.localStorage.setItem(KEY, JSON.stringify(columns));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage refused — the layout still works this session, it just is not remembered.
  }
};

const _columns = observable.box<THomeColumns | null>(read());

export const homeLayout = {
  get columns(): THomeColumns | null {
    return _columns.get();
  },
  /** Turn the custom layout on, seeded with every current key in the left column. */
  enable: action((keys: string[]) => {
    const next: THomeColumns = [keys.slice(), []];
    _columns.set(next);
    write(next);
  }),
  /** Move a key to a column at an index, removing it from wherever it was. */
  move: action((key: string, toColumn: 0 | 1, toIndex: number) => {
    const current = _columns.get();
    if (!current) return;
    const next: THomeColumns = [current[0].filter((k) => k !== key), current[1].filter((k) => k !== key)];
    const clamped = Math.max(0, Math.min(toIndex, next[toColumn].length));
    next[toColumn].splice(clamped, 0, key);
    _columns.set(next);
    write(next);
  }),
  /** Back to the built-in single column. */
  reset: action(() => {
    _columns.set(null);
    write(null);
  }),
};
