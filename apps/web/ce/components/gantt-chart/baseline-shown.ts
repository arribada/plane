/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The baseline the chart is CURRENTLY drawing ghosts for, readable synchronously.
 *
 * ---------------------------------------------------------------------------
 * Why a module-level record and not another fetch
 * ---------------------------------------------------------------------------
 *
 * The export has to answer "was a baseline on screen when the button was
 * pressed?", and it has to answer it in the click handler, synchronously —
 * `collectForExport` returns rows, it does not await anything.
 *
 * Refetching would be both a second request and a different question: the
 * snapshot list is an in-flight share with deliberately NO cache (see
 * `baseline-request.ts` — a TTL is how a freshly captured baseline comes back
 * missing from the picker that captured it), so a second call would go to the
 * network and could answer after the file had been written.
 *
 * So the overlay that draws the ghosts publishes what it drew. The rule that
 * falls out of it is exactly the one the export wants: **the file carries the
 * baseline when, and only when, the screen was showing it.** No ghosts on
 * screen, no ghosts in the export — which is the whole point of an export that
 * matches what the reader was looking at.
 *
 * Keyed by workspace and project because two charts can be mounted at once (the
 * portfolio's project rows and a peeked project's items), and one of them
 * publishing must not answer for the other.
 */

export type TBaselineEntry = { start: string | null; target: string | null };

export type TShownBaseline = {
  /** Which snapshot. Empty means "the newest", which is what the server does
   *  with no parameter — so the two halves agree by construction. */
  baselineId: string;
  /** What the reader calls it. A file that says `Compared against "PDR January
   *  2026"` is one somebody can argue with; one that says "compared against the
   *  baseline" is not, because the project has several. */
  name: string;
  entries: Record<string, TBaselineEntry>;
};

const shown = new Map<string, TShownBaseline>();

const keyOf = (workspaceSlug: string, projectId: string) => `${workspaceSlug}|${projectId}`;

/** Called by the overlay every time it settles on a set of ghosts — including
 *  with an empty set, which is a real answer ("nothing is frozen") and must
 *  clear whatever the previous snapshot left behind. */
export const publishShownBaseline = (
  workspaceSlug: string,
  projectId: string,
  baselineId: string,
  name: string,
  entries: Record<string, TBaselineEntry>
): void => {
  shown.set(keyOf(workspaceSlug, projectId), { baselineId, name, entries });
};

export const clearShownBaseline = (workspaceSlug: string, projectId: string): void => {
  shown.delete(keyOf(workspaceSlug, projectId));
};

/** Undefined when no chart for this project has drawn ghosts, which the export
 *  reads as "no baseline was on screen". */
export const shownBaseline = (
  workspaceSlug: string | undefined,
  projectId: string | undefined
): TShownBaseline | undefined => (workspaceSlug && projectId ? shown.get(keyOf(workspaceSlug, projectId)) : undefined);
