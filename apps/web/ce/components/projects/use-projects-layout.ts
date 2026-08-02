/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Cards or rows on the projects page, remembered between visits.
 *
 * A module-level store rather than a context: the switch is rendered by the page
 * header and read by the list, and those two are far apart in the tree — a
 * provider would have to wrap most of the workspace layout to join them. It is
 * the same shape the timeline's derived caches use.
 */
import { useCallback, useSyncExternalStore } from "react";

export type TProjectsLayout = "cards" | "list";

const STORAGE_KEY = "arribada.projects.layout";

const listeners = new Set<() => void>();
let current: TProjectsLayout | null = null;

const read = (): TProjectsLayout => {
  if (current) return current;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    current = stored === "list" ? "list" : "cards";
  } catch {
    // Private browsing, or storage disabled. The gallery is upstream's default,
    // so falling back to it changes nothing anyone has to notice.
    current = "cards";
  }
  return current;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useProjectsLayout = (): { layout: TProjectsLayout; setLayout: (next: TProjectsLayout) => void } => {
  const layout = useSyncExternalStore(
    subscribe,
    useCallback(() => read(), []),
    // Cards on the server: the stored preference is not readable before
    // hydration, and guessing would be a hydration mismatch.
    useCallback(() => "cards" as TProjectsLayout, [])
  );

  const setLayout = useCallback((next: TProjectsLayout) => {
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session; only its persistence is lost.
    }
    for (const listener of listeners) listener();
  }, []);

  return { layout, setLayout };
};
