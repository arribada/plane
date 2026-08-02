/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A revision counter per project, for the three module-scope caches that hold
 * everything the timeline derives from dates: relations, slack, progress.
 *
 * Dropping a cache entry is not enough on its own. Each hook fetches inside a
 * `useEffect` keyed on `${slug}/${projectId}`, so a component already mounted
 * when the cache is cleared never re-runs the effect — it keeps rendering the
 * value it captured. That is the actual defect: the caches were being cleared by
 * invalidators that, as it turned out, nothing ever called, and even once called
 * they would only have helped the NEXT mount. Dragging a bar left the float
 * tails, the red critical arrows and the parent progress fills all showing the
 * pre-drag answer until a hard reload, because a module-scope Map survives
 * client-side navigation.
 *
 * So invalidation does two things: drop the entry, then bump a number the hooks
 * depend on. `useSyncExternalStore` is what makes the second half reach mounted
 * components, and it is the right primitive here rather than a context because
 * the caches are module-scope too — a provider would have to wrap the whole
 * timeline to reach them, and the store is what the caches already are.
 */
import { useCallback, useSyncExternalStore } from "react";

const revisions = new Map<string, number>();
const listeners = new Set<() => void>();

const keyFor = (workspaceSlug: string, projectId: string) => `${workspaceSlug}/${projectId}`;

/**
 * Mark everything derived from a project's dates as out of date.
 *
 * Call after any write that moves a bar or changes the graph: a drag, a resize,
 * a dependency created or deleted, a state change that flips an item's progress.
 */
export const bumpProjectRevision = (workspaceSlug: string, projectId: string): void => {
  const key = keyFor(workspaceSlug, projectId);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The current revision for a project, re-rendering the caller when it changes.
 *
 * Hooks put this in their effect's dependency array; that is the whole contract.
 * Zero when nothing has been invalidated yet, so the first fetch is unaffected.
 */
export const useProjectRevision = (workspaceSlug: string | undefined, projectId: string | undefined): number => {
  const key = workspaceSlug && projectId ? keyFor(workspaceSlug, projectId) : null;
  const getSnapshot = useCallback(() => (key ? (revisions.get(key) ?? 0) : 0), [key]);
  // Same value on the server: nothing has been invalidated before hydration, and
  // returning a live counter here would be a hydration mismatch waiting to happen.
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
};
