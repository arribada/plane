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
 * Loads are queued four at a time. The list asks for one checklist per visible
 * row, and twenty parallel GETs would compete with the requests the rows need
 * to render themselves.
 */
import { useCallback, useEffect, useState } from "react";
import type { IState } from "@plane/types";
import { IssueService } from "@/services/issue";
import { ProjectStateService } from "@/services/project";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TIssueChecklistItem } from "@/plane-web/services/arribada.service";

const arribada = new ArribadaService();
const issueService = new IssueService();
const stateService = new ProjectStateService();

type TEntry = { items: TIssueChecklistItem[] | null; loading: boolean };

const entries = new Map<string, TEntry>();
const listeners = new Map<string, Set<() => void>>();

const keyOf = (projectId: string, issueId: string) => `${projectId}:${issueId}`;

const emit = (key: string) => {
  const subscribers = listeners.get(key);
  if (subscribers) for (const notify of subscribers) notify();
};

const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const queue: (() => Promise<void>)[] = [];

const pump = () => {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    // Newest first. Rows enqueue as they scroll into view, so the last thing
    // asked for is the thing on screen; serving in arrival order would spend
    // the whole queue on rows the reader has already scrolled past.
    const job = queue.pop();
    if (!job) return;
    inFlight += 1;
    void job().finally(() => {
      inFlight -= 1;
      pump();
    });
  }
};

/** Fetch once per work item. `force` is for after a write, when the cached list
 *  is known to be stale but is still the best thing to show meanwhile. */
const load = (workspaceSlug: string, projectId: string, issueId: string, force = false) => {
  const key = keyOf(projectId, issueId);
  const entry = entries.get(key);
  if (entry?.loading) return;
  if (entry?.items && !force) return;
  entries.set(key, { items: entry?.items ?? null, loading: true });
  emit(key);
  queue.push(async () => {
    try {
      const items = await arribada.getIssueChecklist(workspaceSlug, projectId, issueId);
      entries.set(key, { items, loading: false });
    } catch {
      // A checklist that would not load is shown as no checklist. It decorates
      // a row that still has to render, and an error banner per row would say
      // nothing useful twenty times over.
      entries.set(key, { items: [], loading: false });
    }
    emit(key);
  });
  pump();
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
  done: boolean
) => {
  const states = await projectStates(workspaceSlug, item.project_id);
  const open = states.filter((state) => state.group !== "completed" && state.group !== "cancelled");
  const target = done
    ? states.find((state) => state.group === "completed")
    : (open.find((state) => state.default) ?? open[0]);
  if (!target) throw new Error(done ? "No completed state in that project" : "No open state in that project");

  await issueService.patchIssue(workspaceSlug, item.project_id, item.issue_id, { state_id: target.id });

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
  load(workspaceSlug, ownerProjectId, ownerIssueId, true);
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
  const [, bump] = useState(0);
  const key = projectId && issueId ? keyOf(projectId, issueId) : "";

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

  useEffect(() => {
    if (autoLoad && workspaceSlug && projectId && issueId) load(workspaceSlug, projectId, issueId);
  }, [autoLoad, workspaceSlug, projectId, issueId]);

  const entry = key ? entries.get(key) : undefined;

  const addByName = useCallback(
    async (name: string) => {
      if (!workspaceSlug || !projectId || !issueId) return;
      await arribada.addToIssueChecklist(workspaceSlug, projectId, issueId, { name });
      load(workspaceSlug, projectId, issueId, true);
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
    },
    [workspaceSlug, projectId, issueId]
  );

  const toggle = useCallback(
    async (item: TIssueChecklistItem, done: boolean) => {
      if (!workspaceSlug || !projectId || !issueId) return;
      await setChecklistItemDone(workspaceSlug, projectId, issueId, item, done);
    },
    [workspaceSlug, projectId, issueId]
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
