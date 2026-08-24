/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The list of independent per-project widgets a person has added to their Home. The reusable
 * Project widget (project + Tasks/Budget/Spend) can be dropped on the dashboard as many times as
 * wanted, each pinned to its own project — this is just the roster of their ids. Each instance
 * keeps its own project/view choice under its own localStorage key (see project-spotlight-widget);
 * here we only remember which instances exist and in what order. A per-browser preference, like
 * the free layout it sits on: nothing here is per-workspace or server-side.
 */
import { action, observable } from "mobx";

const KEY = "arribada-project-widgets";

const read = (): string[] => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const write = (ids: string[]) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage refused — the widgets still work this session, they just are not remembered.
  }
};

/** The per-instance config key, shared with project-spotlight-widget. */
export const projectWidgetConfigKey = (id: string) => `arribada-project-spotlight:${id}`;

const newId = (): string => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
};

const _ids = observable.box<string[]>(read());

export const projectWidgets = {
  get ids(): string[] {
    return _ids.get();
  },
  /** Add one more project widget and return its id. */
  add: action((): string => {
    const id = newId();
    const next = [..._ids.get(), id];
    _ids.set(next);
    write(next);
    return id;
  }),
  /** Remove a project widget and forget its pinned project/view. */
  remove: action((id: string) => {
    const next = _ids.get().filter((x) => x !== id);
    _ids.set(next);
    write(next);
    try {
      window.localStorage.removeItem(projectWidgetConfigKey(id));
    } catch {
      /* ignore */
    }
  }),
};
