/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A row list that changes when the rows change — which is not the same thing as
 * the array holding them changing.
 *
 * The timeline derives everything a reader looks at from two values that are both
 * stable by design and therefore both lie to `useMemo`:
 *
 *  - `issues.groupedIssueIds[ALL_ISSUES]` is a MobX observable array. A delete goes
 *    through lodash `pull` (`base-issues.store.ts:1230`), which SPLICES IN PLACE and
 *    hands the same array back. MobX notifies, so the component re-renders — but
 *    `Object.is(before, after)` is true, so every memo keyed on it returns its
 *    cached value. The deleted row stays on the chart. An ADD goes through `concat`
 *    on the same line above, which mints a new array, which is why creating a work
 *    item did show up and deleting one did not.
 *
 *  - `getIssueById` is a `computedFn`, i.e. one stable function for the life of the
 *    store. Changing a field mutates the issue object in place, so neither the
 *    lookup nor the object it returns ever gets a new identity. `buildGroups`,
 *    `buildSubtaskTree` and the dependency-violation walk all read those fields
 *    inside a `useMemo`, so dropping a work item on a sprint band wrote `cycle_id`,
 *    re-rendered, and drew the row in the band it came from.
 *
 * MobX's own reactivity is intact throughout: the component DOES re-render. What is
 * broken is the React memo boundary in front of it, and the honest fix is a
 * dependency that tracks the CONTENT rather than the identity. That is what this is.
 *
 * Deliberately not a bump-after-every-write counter like `derived-revision.ts`. That
 * one guards module-scope caches the fork fetches itself, where the write and the
 * cache are both ours and the list of writes is closed. Here the writes are Plane's
 * — a peek panel, a bulk operation, a store method three layers down — and any fix
 * that needs each of them to remember to call something is a fix that goes stale
 * again the next time upstream adds a mutation. This cannot: it re-reads the facts
 * every render and notices when they differ.
 */
import { useRef } from "react";
import type { TIssue } from "@plane/types";

/** What the lookup has to answer. Narrower than `TIssue` so a test can hand over a
 *  plain object rather than build a whole work item. */
export type TRowLookup = (id: string) => Partial<TIssue> | undefined | null;

/** Stands in for a work item the store has not loaded, so "absent" and "loaded
 *  with no sprint" are different answers. A symbol rather than a string because a
 *  string sentinel is one that could, in principle, be somebody's id. */
const MISSING = Symbol("row not loaded");

/**
 * Everything the row pipeline reads off a work item, pushed flat onto `out`.
 *
 * Flat primitives rather than a joined string on purpose: this runs once per row
 * per render, and comparing values costs nothing while building strings to compare
 * costs an allocation per row. The list-valued fields push their own length first,
 * so `["a"]` and `["a", "b"]` cannot collide with a neighbouring field's value.
 *
 * Kept in step with its readers by hand — `buildGroups` (module/label/assignee/
 * state/cycle/priority, and start/target for the band summary), `buildSubtaskTree`
 * (parent) and the violation walk (start/target). A field read by a memo and absent
 * here is a row that will not refresh; a field here and read by nobody costs one
 * comparison.
 */
const collectRowFacts = (out: unknown[], issue: Partial<TIssue> | undefined | null): void => {
  if (!issue) {
    out.push(MISSING);
    return;
  }
  out.push(
    issue.cycle_id ?? null,
    issue.state_id ?? null,
    issue.priority ?? null,
    issue.parent_id ?? null,
    issue.start_date ?? null,
    issue.target_date ?? null
  );
  for (const list of [issue.module_ids, issue.label_ids, issue.assignee_ids]) {
    out.push(list?.length ?? 0);
    if (list) for (const id of list) out.push(id);
  }
};

const NO_ROWS: string[] = [];

/**
 * The rows on the chart, as a list that gets a NEW identity whenever anything the
 * timeline derives from them has changed — a row added or removed, or a field one
 * of the derivations reads.
 *
 * A list rather than a revision number on purpose. A number would have to be added
 * to each memo's dependency array without appearing in its body, which the
 * exhaustive-deps rule reports as an unnecessary dependency and the next reader
 * deletes — reintroducing the bug silently, since nothing about the memo looks
 * wrong afterwards. Feeding the memo this list instead makes the dependency the
 * thing it actually walks, so it cannot be tidied away.
 *
 * The copy is not incidental either: it hands the memos a plain array rather than
 * the store's observable one, which cannot then be spliced out from under a value
 * they are still holding.
 *
 * Reading each field here is also what keeps MobX tracking them. `observer` only
 * subscribes to what a render actually reads, and a memo that returns its cached
 * value reads nothing — so before this, the FIRST change to a grouping field
 * re-rendered with a stale memo and the SECOND did not re-render at all, because
 * the read that had been tracking it never happened again.
 */
export const useRowSnapshot = (ids: readonly string[], getIssue: TRowLookup): string[] => {
  const facts = useRef<unknown[] | null>(null);
  const snapshot = useRef<string[]>(NO_ROWS);

  const next: unknown[] = [];
  for (const id of ids) {
    next.push(id);
    collectRowFacts(next, getIssue(id));
  }

  const before = facts.current;
  // Written during render rather than in an effect: a memo in the same render has
  // to see the new list, and an effect runs after the paint that was supposed to
  // show it. A render React discards can advance this without committing, which
  // costs one extra recompute on the render that replaces it and is never wrong —
  // the memo's own cache is discarded with it.
  if (before === null || before.length !== next.length || next.some((value, index) => before[index] !== value)) {
    facts.current = next;
    snapshot.current = [...ids];
  }

  return snapshot.current;
};
