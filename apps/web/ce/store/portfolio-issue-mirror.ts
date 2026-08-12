/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The portfolio's copy of a work item and Plane's copy are two different objects,
 * and only one of them is written when somebody edits it.
 *
 * The board expands a project by calling `getProjectItems`, which fills the
 * portfolio store's own `itemMap`; `getRowById` draws the bars from it. The peek
 * panel the board opens on a bar (`ce/components/portfolio/root.tsx`) is Plane's,
 * and every one of its field editors writes through `issues.updateIssue` into
 * `rootStore.issue.issues.issuesMap`. Nothing joined the two, so the reported
 * behaviour was exactly right: the change saved, the server had it, and the bar
 * did not move until the project was collapsed and expanded again.
 *
 * ---------------------------------------------------------------------------
 * Why this is one reaction over nine fields rather than two
 * ---------------------------------------------------------------------------
 *
 * The first version of this file mirrored `start_date` and `target_date`, because
 * those were the two fields the report at the time named. Every other field the
 * board draws from went on being stale, and the next report — "je mets une task à
 * done et ça ne s'actualise pas" — was the same defect wearing `state_id`.
 *
 * So the projection is now everything the portfolio derives a row from, and the
 * list is kept honest by the one below it: a field the bar, the sidebar, the
 * colour scale, the bands or the filters read, and that `issuesMap` can answer,
 * belongs here. `issuesMap` can answer more than it looks — a sprint or a module
 * change from the peek goes through `issueUpdate(..., shouldSync=false)`
 * (`base-issues.store.ts:891` and `:1101`), so `cycle_id` and `module_ids` are
 * written there too, even though the membership ALSO lives in the cycle/module
 * stores. Only the shape differs: `issuesMap` holds ids and a portfolio row holds
 * the objects the server resolved, which is what the resolvers below are for.
 *
 * ---------------------------------------------------------------------------
 * Deletes, which the previous pass left open
 * ---------------------------------------------------------------------------
 *
 * The note it left said absence from `issuesMap` cannot be told apart from "never
 * loaded", so the delete site would have to announce itself. The PREVIOUS
 * SNAPSHOT is that discriminator, and it costs nothing: an id in it was, by
 * construction, present in both maps a moment ago. An id that was there and is
 * not now has left `issuesMap` — and `issue.store.ts` removes from that map in
 * exactly one place, `removeIssue`, which is the delete. Nothing else empties or
 * rebuilds it, so there is no other reading.
 *
 * Doing it here rather than at the delete sites also covers all of them at once:
 * the peek header's own handler, `issueOperations.remove`, the quick-action
 * dropdown and the sub-issue widget are four call sites today and the fifth would
 * arrive without this file being told.
 *
 * Archiving is the same disappearance by another route. `issueArchive` only sets
 * `archived_at` and leaves the row in `issuesMap`, but `PortfolioItemsEndpoint`
 * reads `Issue.issue_objects`, which excludes archived items — so an archived row
 * is one the board would not have fetched, and it goes the same way as a deleted
 * one.
 *
 * ---------------------------------------------------------------------------
 * What it still does not cover
 * ---------------------------------------------------------------------------
 *
 * `disciplines` is not on `TIssue` at all — it is a fork-only per-item value with
 * its own endpoint, so `role-field.tsx` writes it into the portfolio directly,
 * the same way it already drops the work-item timeline's cache.
 *
 * A whole-project refetch would have done all of this and cost a round trip per
 * keystroke on a date field. This costs a comparison over the rows on screen.
 */
import { comparer, reaction } from "mobx";
import type { TIssue } from "@plane/types";
import type { TItemAssignee, TPortfolioItem } from "@/plane-web/types/arribada";
import type { RootStore } from "./root.store";

/**
 * What the board needs that `issuesMap` cannot say in the shape the board holds
 * it: `issuesMap` has a `cycle_id`, a portfolio row has `{ id, name }`.
 *
 * Injected rather than reached for, so the test can hand over three functions
 * instead of standing up Plane's cycle, module and member stores.
 */
export type TPortfolioMirrorResolvers = {
  getCycleName: (id: string) => string | undefined;
  getModuleName: (id: string) => string | undefined;
  getMember: (id: string) => { name: string; avatar: string | null } | undefined;
};

/**
 * Everything about one work item that the portfolio board draws from and
 * `issuesMap` can answer.
 *
 * Kept in step with its readers by hand, and they are worth naming because a
 * field missing here is a bar that will not refresh:
 *
 *   start/target   the bar's position (`getRowById`)
 *   state          done-ness, and the `state` colour axis
 *   priority       the `priority` colour axis, and the priority filter
 *   parent         sub-task nesting (`itemSubtaskTree`)
 *   name           the bar's label and the sidebar's
 *   cycle          the `cycle` colour axis and the sprint band
 *   modules        the `module` colour axis and the module band
 *   assignees      the avatars, the `assignee` axis, and "assigned to me"
 *   archived       whether the row belongs on the board at all
 *
 * The two list fields are joined rather than kept as arrays only so the
 * structural comparison below is a string compare; the effect reads the real
 * arrays back off `issuesMap`'s row.
 */
type TRowFacts = {
  start: string | null;
  target: string | null;
  state: string | null;
  priority: string | null;
  parent: string | null;
  name: string | null;
  cycle: string | null;
  modules: string;
  assignees: string;
  archived: boolean;
};

const LIST_SEPARATOR = ",";

const factsOf = (issue: TIssue): TRowFacts => ({
  start: issue.start_date ?? null,
  target: issue.target_date ?? null,
  state: issue.state_id ?? null,
  priority: issue.priority ?? null,
  parent: issue.parent_id ?? null,
  name: issue.name ?? null,
  cycle: issue.cycle_id ?? null,
  modules: (issue.module_ids ?? []).join(LIST_SEPARATOR),
  assignees: (issue.assignee_ids ?? []).join(LIST_SEPARATOR),
  archived: !!issue.archived_at,
});

/**
 * The module a portfolio row is filed under: the lowest-named one.
 *
 * An item can be in several and can only be drawn on one row, so the server
 * picks by name (`PortfolioItemsEndpoint`) and this has to pick the same one, or
 * a module change made in the peek would file the row under a different band
 * from the one a refetch puts it in. The id is the tie-break for two modules
 * with the same name, so the answer is stable rather than dependent on the order
 * `module_ids` happens to arrive in.
 */
const lowestNamedModule = (
  ids: string[],
  getName: (id: string) => string | undefined
): { id: string; name: string } | null => {
  if (ids.length === 0) return null;
  const named = ids.map((id) => ({ id, name: getName(id) ?? "" }));
  // oxlint-disable-next-line unicorn/no-array-sort -- the array was just built here; toSorted is ES2023 and this workspace targets earlier
  named.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
  return named[0];
};

/**
 * What changed, in the shape `itemMap` holds it.
 *
 * The object-valued fields prefer the entry the row already carries when the id
 * has not changed: those names came from the server, and rebuilding them from a
 * client store would swap `display_name` for whatever the other store happens to
 * call the same person. A name the resolvers cannot answer is left empty rather
 * than filled with a uuid — `buildColorScale` takes the first non-empty label for
 * a series, so another row in the same sprint supplies it, and a refetch restores
 * the server's. In practice it is unreachable from the peek: the only control
 * that can change one of these had to load the list to offer it.
 */
const patchFor = (
  issue: TIssue,
  before: TRowFacts,
  facts: TRowFacts,
  current: TPortfolioItem,
  resolvers: TPortfolioMirrorResolvers
): Partial<TPortfolioItem> => {
  const patch: Partial<TPortfolioItem> = {};
  if (facts.start !== before.start) patch.start_date = facts.start;
  if (facts.target !== before.target) patch.target_date = facts.target;
  if (facts.state !== before.state) patch.state_id = facts.state;
  if (facts.parent !== before.parent) patch.parent_id = facts.parent;
  if (facts.name !== before.name && facts.name !== null) patch.name = facts.name;
  if (facts.priority !== before.priority && facts.priority !== null)
    patch.priority = facts.priority as TPortfolioItem["priority"];

  if (facts.cycle !== before.cycle)
    patch.cycle = facts.cycle
      ? current.cycle?.id === facts.cycle
        ? current.cycle
        : { id: facts.cycle, name: resolvers.getCycleName(facts.cycle) ?? "" }
      : null;

  if (facts.modules !== before.modules) {
    const lowest = lowestNamedModule(issue.module_ids ?? [], resolvers.getModuleName);
    patch.module = lowest && current.module?.id === lowest.id ? current.module : lowest;
  }

  if (facts.assignees !== before.assignees) {
    const known = new Map((current.assignees ?? []).map((a) => [a.id, a]));
    patch.assignees = (issue.assignee_ids ?? []).map((id): TItemAssignee => {
      const seen = known.get(id);
      if (seen) return seen;
      const member = resolvers.getMember(id);
      return { id, name: member?.name ?? "", avatar: member?.avatar ?? null };
    });
  }

  return patch;
};

/** The resolvers taken off the root store, which is where the board's own screens
 *  read the same three things from. */
const storeResolvers = (root: RootStore): TPortfolioMirrorResolvers => ({
  getCycleName: (id) => root.cycle.getCycleById(id)?.name,
  getModuleName: (id) => root.module.getModuleById(id)?.name,
  getMember: (id) => {
    const member = root.memberRoot.getUserDetails(id);
    return member
      ? { name: member.display_name || member.first_name || "", avatar: member.avatar_url || null }
      : undefined;
  },
});

/**
 * Keep the portfolio's rows in step with changes made through Plane's stores.
 *
 * Returns the disposer, which the root store has no use for — it lives as long as
 * the tab does — but which a test needs to stop one instance leaking into the next.
 */
export const mirrorIssueChangesIntoPortfolio = (
  root: RootStore,
  resolvers: TPortfolioMirrorResolvers = storeResolvers(root)
): (() => void) =>
  reaction(
    () => {
      const { issuesMap } = root.issue.issues;
      const rows: Record<string, TRowFacts> = {};
      // Only the rows the board is currently showing. `issuesMap` is every work
      // item touched anywhere this session; walking it all would make this cost
      // grow with how long the tab has been open rather than with what is drawn.
      for (const id of Object.keys(root.portfolio.itemMap)) {
        const issue = issuesMap[id];
        if (issue) rows[id] = factsOf(issue);
      }
      return rows;
    },
    (rows, previous) => {
      // The first snapshot is a reading, not a change. Without this the whole
      // board would be written over from `issuesMap` on the reaction's first run.
      if (!previous) return;

      for (const id of Object.keys(previous)) {
        // Present a moment ago in BOTH maps, gone from `issuesMap` now: deleted.
        // (Or gone from `itemMap`, in which case `removeItem` is a no-op — the
        // two cases need no telling apart, which is why this is a plain check.)
        if (!(id in rows)) root.portfolio.removeItem(id);
      }

      for (const [id, facts] of Object.entries(rows)) {
        const before = previous[id];
        // Not in the last snapshot means this is the first time both stores have
        // held the row, which is not a change and must not be treated as one:
        // the board has just fetched it and whatever an older peek left behind in
        // `issuesMap` is the stale copy, not this one.
        if (before === undefined) continue;
        if (facts.archived && !before.archived) {
          root.portfolio.removeItem(id);
          continue;
        }
        const current = root.portfolio.getItem(id);
        if (!current) continue;
        const issue = root.issue.issues.issuesMap[id];
        if (!issue) continue;
        root.portfolio.applyItemFields(id, patchFor(issue, before, facts, current, resolvers));
      }
    },
    // Without this the effect would run on every keystroke anywhere in `issuesMap`,
    // because the data function returns a fresh object each time.
    { equals: comparer.structural }
  );
