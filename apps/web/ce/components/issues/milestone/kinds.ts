/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What the three milestone kinds are called on screen, in one place.
 *
 * The timeline, the property row and the marker beside a name all have to say
 * the same word for the same mark — a "Gate" on the chart that reads "Review" in
 * the panel is two features as far as anybody using it is concerned.
 */
import type { TMilestoneKind } from "@/plane-web/components/gantt-chart/use-project-milestones";

export const MILESTONE_KINDS: TMilestoneKind[] = ["delivery", "gate", "review"];

export const MILESTONE_KIND_LABEL: Record<TMilestoneKind, string> = {
  delivery: "Delivery",
  gate: "Gate",
  review: "Review",
};

/** What the mark means, for the tooltip on a marker and the hint under the
 *  property row. Written for somebody who has never met the word "gate". */
export const MILESTONE_KIND_HINT: Record<TMilestoneKind, string> = {
  delivery: "Something is handed over on this date",
  gate: "Work downstream cannot start until this is passed",
  review: "A decision is taken on this date",
};
