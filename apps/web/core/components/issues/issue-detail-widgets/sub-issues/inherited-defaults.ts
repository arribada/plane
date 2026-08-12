/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a new sub-work item starts out as, given the item it hangs under.
 *
 * The "Create new" sub-item modal pre-filled exactly two fields — `parent_id`
 * and `project_id` — and let every other field fall back to
 * `DEFAULT_WORK_ITEM_FORM_VALUES`. For the Sprint that default is `null`, and
 * `issue-modal/modal.tsx` only ever fills it from the ROUTE
 * (`props.data?.cycle_id ? … : cycleId ? … : null`). A work item detail page has
 * no cycle in its URL. So a sub-task broken out of an item sitting in Sprint 5
 * was born in no sprint at all: it disappeared from the board showing its
 * parent, and the sprint's own burndown stopped counting the work the parent is
 * made of. The parent link was intact the whole time — which is precisely why it
 * read as nesting being broken.
 *
 * What is inherited, and what is not, follows one line: **a container the parent
 * already belongs to is a fact about the child; a judgement somebody made about
 * the parent is not.**
 *
 * INHERITED
 * - `project_id` — a sub-item lives in its parent's project. Already true today;
 *   kept here so the whole payload has one author.
 * - `cycle_id` (Sprint) — if the parent is Sprint 5 work, the work it is made of
 *   is Sprint 5 work. Omitting it does not leave the question open, it answers
 *   it wrongly: the sprint under-reports.
 * - `module_ids` — the same argument. Copied, never aliased, so the form cannot
 *   mutate the parent's array in the MobX store through a shared reference.
 * - `priority` — only when the parent actually has one. Priority describes the
 *   work, not who does it; the pieces of an urgent item are urgent. Plane's
 *   default is `"none"`, which means "nobody has triaged this" rather than
 *   "low", so a parent with no priority hands down nothing and the form's own
 *   default stands. This is the one genuinely arguable entry: it is a default
 *   in a form the creator is looking at, not a value forced on save, and
 *   dropping the two lines below reverses it without touching anything else.
 *
 * NOT INHERITED
 * - `assignee_ids` — a sub-task usually exists because it goes to somebody else.
 *   Inheriting mis-assigns work silently, and in this fork `allow_edit_others`
 *   keys off assignees, so it would quietly widen who may edit the item.
 * - `state_id` — a child that has not been started is not "In progress" because
 *   its parent is. It belongs in the project's default state.
 * - `start_date` / `target_date` — a child spanning its parent's whole window
 *   defeats the point of breaking the parent down, and this fork's rollup and
 *   critical-path code read those dates as if a human had chosen them.
 * - `estimate_point`, `label_ids` — the same class of claim nobody made.
 *
 * Not handled here: the fork's `discipline`. It is not a field on `TIssue` at
 * all — it is an `IssueRole` row written through a separate endpoint after the
 * item exists (`ce/components/issues/issue-details/role-field.tsx`), so it
 * cannot be a form default, and writing it post-save would be exactly the
 * unreviewable write this file is careful not to make.
 */
import type { TIssue } from "@plane/types";

/** The only part of a parent this decision reads. */
export type TInheritableParent = Pick<TIssue, "id" | "project_id" | "cycle_id" | "module_ids" | "priority">;

/**
 * The prepopulated payload for a new child of `parent`.
 *
 * Keys are OMITTED rather than set to `undefined`. The form builds its defaults
 * as `{ ...DEFAULT_WORK_ITEM_FORM_VALUES, ...data }`, and a spread copies a key
 * whose value is `undefined` over the top of a real default — so `priority:
 * undefined` would blank a dropdown that is meant to read "None", and
 * `module_ids: undefined` would replace the documented `null`.
 *
 * `explicit` wins over anything inherited, so a caller can override a field the
 * parent has. Only DEFINED values in `explicit` win: `undefined` there means
 * "no opinion" and leaves the inherited value alone, while `null` is a real
 * answer ("no sprint") and clears it — the same convention the modal itself uses
 * for `cycle_id`.
 *
 * A missing `parent` (the store has not warmed up, or the id is stale) yields
 * `explicit` alone. That is today's behaviour, so the worst case of a cold store
 * is the old defaults, never a child created with no parent at all.
 */
export const inheritedSubIssueDefaults = (
  parent: TInheritableParent | null | undefined,
  explicit: Partial<TIssue> = {}
): Partial<TIssue> => {
  const defaults: Partial<TIssue> = {};

  if (parent) {
    defaults.parent_id = parent.id;
    if (parent.project_id) defaults.project_id = parent.project_id;
    if (parent.cycle_id) defaults.cycle_id = parent.cycle_id;
    if (parent.module_ids && parent.module_ids.length > 0) defaults.module_ids = [...parent.module_ids];
    if (parent.priority && parent.priority !== "none") defaults.priority = parent.priority;
  }

  for (const [key, value] of Object.entries(explicit)) {
    if (value !== undefined) (defaults as Record<string, unknown>)[key] = value;
  }

  return defaults;
};
