/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One copy of every checklist on screen, shared by everything that shows one.
 *
 * The same checklist is read from three places at once — the work item page,
 * the peek panel and the list row — and ticking a box in one of them has to be
 * true in the other two straight away. Component state cannot do that, so the
 * cache lives out here, keyed by work item, and every reader subscribes to it.
 *
 * Two caches, because there are two questions. The lines of ONE checklist are
 * fetched per work item, and only for a list somebody actually opened. How full
 * every checklist in a project is comes from a single per-project call — the
 * badges have to be right on every row, and asking per row was an N+1.
 */
import { useCallback, useEffect, useState } from "react";
import type { IState } from "@plane/types";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import { IssueService } from "@/services/issue";
import { ProjectStateService } from "@/services/project";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TIssueChecklistItem, TIssueChecklistSummary } from "@/plane-web/services/arribada.service";

const arribada = new ArribadaService();
const issueService = new IssueService();
const stateService = new ProjectStateService();

type TEntry = { items: TIssueChecklistItem[] | null; loading: boolean };
type TSummaryEntry = { counts: Record<string, TIssueChecklistSummary> | null; loading: boolean };

const entries = new Map<string, TEntry>();
const summaries = new Map<string, TSummaryEntry>();
const listeners = new Map<string, Set<() => void>>();

const keyOf = (projectId: string, issueId: string) => `${projectId}:${issueId}`;
// Namespaced so a project's summary and one of its checklists can never share a
// subscriber set.
const summaryKeyOf = (projectId: string) => `summary:${projectId}`;

const emit = (key: string) => {
  const subscribers = listeners.get(key);
  if (subscribers) for (const notify of subscribers) notify();
};

/** Fetch once per work item. `force` is for after a write, when the cached list
 *  is known to be stale but is still the best thing to show meanwhile. */
const load = async (workspaceSlug: string, projectId: string, issueId: string, force = false) => {
  const key = keyOf(projectId, issueId);
  const entry = entries.get(key);
  if (entry?.loading) return;
  if (entry?.items && !force) return;
  entries.set(key, { items: entry?.items ?? null, loading: true });
  emit(key);
  try {
    const items = await arribada.getIssueChecklist(workspaceSlug, projectId, issueId);
    entries.set(key, { items, loading: false });
  } catch {
    // A checklist that would not load is shown as no checklist. It decorates
    // something that still has to render, and an error banner would say nothing
    // the reader can act on.
    entries.set(key, { items: [], loading: false });
  }
  emit(key);
};

/** Every badge in a project, in one call. Cached for the session. */
const loadSummary = async (workspaceSlug: string, projectId: string, force = false) => {
  const key = summaryKeyOf(projectId);
  const entry = summaries.get(projectId);
  if (entry?.loading) return;
  if (entry?.counts && !force) return;
  summaries.set(projectId, { counts: entry?.counts ?? null, loading: true });
  emit(key);
  try {
    const counts = await arribada.getChecklistSummary(workspaceSlug, projectId);
    summaries.set(projectId, { counts, loading: false });
  } catch {
    // Same reasoning as a checklist that would not load: no badges beats an
    // error on a row the reader came here to read.
    summaries.set(projectId, { counts: {}, loading: false });
  }
  emit(key);
};

/**
 * A write changed how full one of this project's checklists is, so the counts
 * held here are now wrong.
 *
 * Refetched while somebody is watching them, dropped otherwise — a tick made on
 * the work item page must not spend a whole-project call for a list view nobody
 * has open.
 */
const invalidateSummary = (workspaceSlug: string, projectId: string) => {
  if (!summaries.has(projectId)) return;
  if (listeners.get(summaryKeyOf(projectId))?.size) void loadSummary(workspaceSlug, projectId, true);
  else summaries.delete(projectId);
};

// A member can live in another project, whose states the store has no reason to
// have loaded. Asked for directly, once per project, rather than reaching into a
// store that is only guaranteed to know about the project being looked at.
const statesByProject = new Map<string, Promise<IState[]>>();

const projectStates = (workspaceSlug: string, projectId: string) => {
  const cached = statesByProject.get(projectId);
  if (cached) return cached;
  const pending = stateService.getStates(workspaceSlug, projectId).catch(() => [] as IState[]);
  statesByProject.set(projectId, pending);
  return pending;
};

/** How the member's new state actually gets written. Injected rather than chosen
 *  here because the right writer is a store the caller is inside and this module
 *  is not a component — see `useIssueChecklist` for which one and why. */
export type TStateWriter = (memberProjectId: string, memberIssueId: string, stateId: string) => Promise<void>;

/**
 * Tick or untick one line.
 *
 * Ticking IS finishing the work item — there is no checklist-only "done" to
 * write — so this moves the member to its project's completed state. Unticking
 * puts it back on the project's default, falling back to any state that is
 * neither completed nor cancelled, so a project whose default is itself a
 * completed state cannot trap a box in the ticked position.
 */
export const setChecklistItemDone = async (
  workspaceSlug: string,
  ownerProjectId: string,
  ownerIssueId: string,
  item: TIssueChecklistItem,
  done: boolean,
  write: TStateWriter
) => {
  const states = await projectStates(workspaceSlug, item.project_id);
  const open = states.filter((state) => state.group !== "completed" && state.group !== "cancelled");
  const target = done
    ? states.find((state) => state.group === "completed")
    : (open.find((state) => state.default) ?? open[0]);
  if (!target) throw new Error(done ? "No completed state in that project" : "No open state in that project");

  await write(item.project_id, item.issue_id, target.id);

  // Patched in place rather than refetched: the write already told us the only
  // thing that changed, and a round trip here would make the box lag the click.
  const key = keyOf(ownerProjectId, ownerIssueId);
  const entry = entries.get(key);
  const index = entry?.items?.findIndex((row) => row.id === item.id) ?? -1;
  if (entry?.items && index !== -1) {
    const items = [...entry.items];
    items[index] = { ...items[index], done, state_id: target.id };
    entries.set(key, { loading: entry.loading, items });
    emit(key);
  }
  invalidateSummary(workspaceSlug, ownerProjectId);
};

/** Puts an existing work item on another one's checklist — the write behind
 *  "move into a work item", read from the owner's side. */
export const addExistingToChecklist = async (
  workspaceSlug: string,
  ownerProjectId: string,
  ownerIssueId: string,
  memberIssueId: string
) => {
  const result = await arribada.addToIssueChecklist(workspaceSlug, ownerProjectId, ownerIssueId, {
    member_issue_id: memberIssueId,
  });
  void load(workspaceSlug, ownerProjectId, ownerIssueId, true);
  invalidateSummary(workspaceSlug, ownerProjectId);
  return result;
};

export type TChecklistHandle = {
  items: TIssueChecklistItem[];
  /** False until the first load lands, so a caller can tell "empty" from "not
   *  asked yet" — the list row must stay silent in the second case. */
  loaded: boolean;
  loading: boolean;
  addByName: (name: string) => Promise<void>;
  addExisting: (memberIssueId: string) => Promise<void>;
  remove: (lineId: string) => Promise<void>;
  toggle: (item: TIssueChecklistItem, done: boolean) => Promise<void>;
};

/** Re-render this component whenever that cache key changes. An empty key
 *  subscribes to nothing, so a caller missing an id still calls the same hooks
 *  in the same order. */
const useCacheKey = (key: string) => {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key) return;
    const notify = () => bump((n) => n + 1);
    const subscribers = listeners.get(key) ?? new Set<() => void>();
    subscribers.add(notify);
    listeners.set(key, subscribers);
    return () => {
      subscribers.delete(notify);
    };
  }, [key]);
};

/**
 * How full one work item's checklist is, without its lines — and null when it
 * has no checklist at all, which is what tells a badge to render nothing rather
 * than a zero.
 *
 * Costs one call per project, not one per row. The open list's own copy wins
 * while it is loaded: ticking patches it in place, so the badge follows the
 * click instead of waiting for the summary to be fetched again.
 */
export const useChecklistCount = (
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  issueId: string | undefined
): TIssueChecklistSummary | null => {
  useCacheKey(projectId ? summaryKeyOf(projectId) : "");
  useCacheKey(projectId && issueId ? keyOf(projectId, issueId) : "");

  useEffect(() => {
    if (workspaceSlug && projectId) void loadSummary(workspaceSlug, projectId);
  }, [workspaceSlug, projectId]);

  if (!projectId || !issueId) return null;
  const items = entries.get(keyOf(projectId, issueId))?.items;
  if (items) return { done: items.filter((row) => row.done).length, total: items.length };
  return summaries.get(projectId)?.counts?.[issueId] ?? null;
};

/**
 * `autoLoad` off is for readers that must not cost a request until asked —
 * nothing in the list view should fetch anything the reader never looks at.
 */
export const useIssueChecklist = (
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  issueId: string | undefined,
  autoLoad = true
): TChecklistHandle => {
  const key = projectId && issueId ? keyOf(projectId, issueId) : "";
  useCacheKey(key);

  // The store behind whatever view this checklist is being read from — project,
  // cycle, module, view. Ticking a box IS moving the work item to done, and the
  // state chip, the group header and the kanban column that show its state all
  // read the store, not the server. Writing through the raw service updated the
  // row and left all three showing the old state until a reload.
  const { issues: issueStore, issueMap } = useIssuesStore();

  const write = useCallback<TStateWriter>(
    async (memberProjectId, memberIssueId, stateId) => {
      if (!workspaceSlug) return;
      // A checklist member may live in a project this view never loaded — that
      // is the case the raw service was chosen for. The store is not wrong there,
      // it is empty: `updateIssue` finds no local row, skips the optimistic
      // update and still patches the server. So ask the map first and call the
      // service directly when the item is unknown, which is both correct and one
      // less pass through a store that has nothing on screen to move.
      //
      // A few of the stores in the union have no `updateIssue` at all (the draft
      // and profile ones), and they fall down the same path for the same reason.
      //
      // AND the member has to belong to the project this store is showing. The
      // map is the app-wide one — `context.issue.issues.issuesMap`, every issue
      // loaded anywhere this session, including one merely peeked at — so
      // "present in the map" was never "on this list". `updateIssue` does not
      // only patch a row: it calls `updateIssueList`, which files the id into
      // THIS store's `groupedIssueIds` under whichever group the new state_id
      // belongs to, and bumps that group's count. It asks nothing about the
      // project. Ticking a checklist line whose member lives in project B, from
      // a board showing project A, put B's work item into A's Done column and
      // added one to the total, until a reload. Nothing is wrong with the
      // service path for that member; it is on nobody's screen here.
      const belongsToThisView = !!projectId && memberProjectId === projectId;
      if (belongsToThisView && issueMap?.[memberIssueId] && issueStore.updateIssue) {
        await issueStore.updateIssue(workspaceSlug, memberProjectId, memberIssueId, { state_id: stateId });
      } else {
        await issueService.patchIssue(workspaceSlug, memberProjectId, memberIssueId, { state_id: stateId });
      }
    },
    [workspaceSlug, projectId, issueStore, issueMap]
  );

  useEffect(() => {
    if (autoLoad && workspaceSlug && projectId && issueId) void load(workspaceSlug, projectId, issueId);
  }, [autoLoad, workspaceSlug, projectId, issueId]);

  const entry = key ? entries.get(key) : undefined;

  const addByName = useCallback(
    async (name: string) => {
      if (!workspaceSlug || !projectId || !issueId) return;
      await arribada.addToIssueChecklist(workspaceSlug, projectId, issueId, { name });
      void load(workspaceSlug, projectId, issueId, true);
      invalidateSummary(workspaceSlug, projectId);
    },
    [workspaceSlug, projectId, issueId]
  );

  const addExisting = useCallback(
    async (memberIssueId: string) => {
      if (!workspaceSlug || !projectId || !issueId) return;
      await addExistingToChecklist(workspaceSlug, projectId, issueId, memberIssueId);
    },
    [workspaceSlug, projectId, issueId]
  );

  const remove = useCallback(
    async (lineId: string) => {
      if (!workspaceSlug || !projectId || !issueId) return;
      await arribada.removeFromIssueChecklist(workspaceSlug, projectId, issueId, lineId);
      const cacheKey = keyOf(projectId, issueId);
      const current = entries.get(cacheKey);
      if (current?.items) {
        entries.set(cacheKey, { loading: current.loading, items: current.items.filter((row) => row.id !== lineId) });
        emit(cacheKey);
      }
      invalidateSummary(workspaceSlug, projectId);
    },
    [workspaceSlug, projectId, issueId]
  );

  const toggle = useCallback(
    async (item: TIssueChecklistItem, done: boolean) => {
      if (!workspaceSlug || !projectId || !issueId) return;
      await setChecklistItemDone(workspaceSlug, projectId, issueId, item, done, write);
    },
    [workspaceSlug, projectId, issueId, write]
  );

  return {
    items: entry?.items ?? [],
    loaded: !!entry?.items,
    loading: !!entry?.loading,
    addByName,
    addExisting,
    remove,
    toggle,
  };
};
