/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which baseline this project's picker is actually showing.
 *
 * `selectedBaselineId` lives on the timeline store, and that store is a singleton
 * per timeline TYPE, not per project. Pick "PDR January 2026" on one project's
 * gantt, walk to another project, and the id came with you — naming a snapshot
 * that belongs to somebody else's plan.
 *
 * What that produced was the worst kind of disagreement: the ghost bars were
 * right and the label was wrong. The server answers an unknown `?baseline=` by
 * falling back to the newest, so the chart drew this project's most recent
 * promise — while the `<select>` beside it held a value matching none of its own
 * options, so it rendered blank, its tooltip vanished, and the delete button with
 * it. A reader comparing against "the baseline" had no way to know which one.
 *
 * The rule is one line: a selection that names no snapshot of the project in
 * front of you is not a selection. Stated here rather than inline so it can be
 * tested without mounting a chart, and so both halves — what to draw, and whether
 * to clear the store — come out of the same answer.
 */

export type TBaselineChoice = {
  /** The id to show as selected. Empty means "the newest", which is also what the
   *  server does with no parameter, so the two halves agree by construction. */
  selected: string;
  /** The stored selection pointed at another project's snapshot (or one that has
   *  since been deleted) and should be cleared. */
  stale: boolean;
};

export const resolveBaselineSelection = (
  storedId: string | null | undefined,
  snapshots: readonly { id: string }[]
): TBaselineChoice => {
  const newest = snapshots[0]?.id ?? "";
  if (!storedId) return { selected: newest, stale: false };
  const known = snapshots.some((snapshot) => snapshot.id === storedId);
  if (known) return { selected: storedId, stale: false };
  return { selected: newest, stale: true };
};
