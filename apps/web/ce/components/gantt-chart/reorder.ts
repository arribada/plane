/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a gantt reorder hands back to the drop that triggered it.
 *
 * `onReorderStart` already existed for the SORTED case: a view ordered by start
 * date has no manual order to insert into, so the sequence on screen is written
 * down AS the manual order before the drop lands. Grouping is the same problem
 * one step further — the reader is looking at bands, and dragging a row is how
 * they say "forget the bands, this is the order I want". Both are handled by the
 * same hook, so there is one place where "the arrangement in front of the reader
 * becomes the manual order" is decided.
 *
 * Two things have to come BACK from that hook, and neither could before:
 *
 *  - the sequence itself. React has not re-rendered by the time the drop runs, so
 *    the `blockIds` prop is still the pre-flatten list — with group headers in it.
 *    Computing neighbours from that list picks a header as a neighbour and asks a
 *    store that has never heard of it for a sort_order.
 *  - the sort_order each id now carries. The freeze rewrote them server-side and
 *    the local store still holds the old ones, so the midpoint arithmetic would be
 *    computed against numbers nobody is looking at and the row would land
 *    somewhere else entirely.
 */

/** Matches `ORDER_STEP` in `plane/arribada/views.py::_apply_issue_order`, which
 *  writes `sort_order = (index + 1) * ORDER_STEP`. Pinned on both sides by a
 *  test — the drop's arithmetic is only right while the two agree. */
export const ORDER_STEP = 1000;

export type TReorderStart = {
  /** The sequence the drop should be computed against: real work items only, in
   *  the order the reader is looking at. */
  blockIds: string[];
  /** The sort_order the freeze just gave each id. */
  sortOrderOf: (id: string) => number | undefined;
};

/** The freeze wrote `(index + 1) * ORDER_STEP` down the list, so the answer is a
 *  lookup rather than anything the client has to be told. */
export const frozenOrder = (blockIds: string[]): TReorderStart => {
  const index = new Map(blockIds.map((id, position) => [id, (position + 1) * ORDER_STEP]));
  return { blockIds, sortOrderOf: (id) => index.get(id) };
};

/**
 * Move `dragId` to where `dropId` sits, in a sequence that is only PART of a
 * longer one.
 *
 * The portfolio's saved order covers every project on the board; a focused
 * folder, or a board narrowed by a filter, shows a subset. Reordering the subset
 * and storing it would delete every project that was not on screen, so the
 * positions the subset occupies are rewritten in place and everything else is
 * left exactly where it was.
 */
export const reorderWithinSubset = (full: string[], visible: string[], dragId: string, dropId: string): string[] => {
  const from = visible.indexOf(dragId);
  const to = visible.indexOf(dropId);
  if (from === -1 || to === -1 || from === to) return full;

  const moved = [...visible];
  moved.splice(from, 1);
  moved.splice(to, 0, dragId);

  const inVisible = new Set(visible);
  let cursor = 0;
  const out = full.map((id) => (inVisible.has(id) ? (moved[cursor++] as string) : id));
  // Anything visible but missing from the full list — a project the saved order
  // has never seen — is appended rather than dropped on the floor.
  for (const id of moved.slice(cursor)) out.push(id);
  return out;
};
