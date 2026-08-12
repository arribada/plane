/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which value a row has on the dimension the chart is coloured by.
 *
 * Pure: it is handed a work item and a bag of id-to-name resolvers and answers a
 * `{ key, label, color? }`. The colours, the fold at six series and the legend
 * are `palette.ts`'s problem; deciding that THIS bar belongs to Ruby, or to
 * Sprint 12, or to nobody at all, is this file's.
 *
 * ---------------------------------------------------------------------------
 * Two kinds of dimension, and why they are coloured differently
 * ---------------------------------------------------------------------------
 *
 * `state`, `priority` and `label` already carry a colour that the rest of Plane
 * paints them with — a state's colour is on the board column and on the badge in
 * the item's own header. Repainting them here would mean the same state was two
 * colours on two screens, so the dimension hands its own colour through and the
 * palette leaves it alone. The cost is that those colours are the team's data
 * and cannot be validated for colourblind separation; the mitigation is the one
 * that applies everywhere in this chart — the legend names every series and the
 * bar carries its own label.
 *
 * `assignee`, `cycle`, `module` and `discipline` have no colour anywhere. Those
 * are the ones that used to get a hashed hue, and they are the ones the
 * validated palette exists for.
 *
 * `discipline` deserves a note. It is a fork field, one per work item, free text
 * — so two projects can spell "firmware" differently and land in two bands. That
 * is a data problem rather than a display one, and the timeline is a poor place
 * to fix it: the value is shown exactly as it was typed.
 */
import type { TIssue } from "@plane/types";
import type { TColorSample } from "./palette";

/** The axes a work-item timeline can be coloured by. Deliberately the same list,
 *  and the same words, as the Group control and as the portfolio's subgroup
 *  control: "Sprint" has to mean Sprint on every screen. */
export type TGanttColorBy = "state" | "priority" | "assignee" | "label" | "cycle" | "module" | "discipline";

export const GANTT_COLOR_OPTIONS: { value: TGanttColorBy; label: string; hint?: string }[] = [
  { value: "state", label: "State" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "cycle", label: "Sprint" },
  { value: "module", label: "Module", hint: "Hardware, firmware, software" },
  { value: "discipline", label: "Discipline", hint: "What the work needs, whether or not anyone holds it" },
  { value: "label", label: "Label" },
];

/** What a row with no value on this dimension is called. "Unset" everywhere
 *  would be honest and useless; a funder reading the legend wants the sentence
 *  that is true of the work. */
export const UNSET_LABEL: Record<TGanttColorBy, string> = {
  state: "No state",
  priority: "No priority",
  assignee: "Unassigned",
  label: "No label",
  cycle: "No sprint",
  module: "No module",
  discipline: "No discipline",
};

/** Plane's own priority colours, unchanged, because they are what the priority
 *  icon is painted with on every other screen.
 *
 *  Measured rather than assumed, and the measurement is not flattering: as a
 *  five-colour categorical set on white this FAILS the validator — `high`
 *  (#f97316) and `medium` (#f59e0b) sit ΔE 9.6 apart at normal vision and 6.2
 *  under deuteranopia, well under the 15 and 8 floors. It is kept because
 *  priority is ORDINAL and is never carried by colour alone here: the legend
 *  names each band, the bars carry their own titles, and the order in the legend
 *  is the severity order. Replacing it is a product-wide change, not a gantt
 *  one. */
export const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#dc2626",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#3f76ff",
  none: "#94a3b8",
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

/** Severity order, so the legend does not sort "Urgent" under "Medium". */
export const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"];

export type TDimensionResolvers = {
  getStateById?: (id: string) => { name?: string; color?: string; group?: string } | null | undefined;
  getLabelById?: (id: string) => { name?: string; color?: string } | null | undefined;
  getCycleById?: (id: string) => { name?: string } | null | undefined;
  getModuleById?: (id: string) => { name?: string } | null | undefined;
  getMemberName?: (id: string) => string | undefined;
  /** One discipline per item; the fork enforces that at the database. */
  getDiscipline?: (issueId: string) => string | undefined;
};

/**
 * The value a bar takes on `dimension`.
 *
 * A `null` key means "no value", which the palette draws in a neutral and the
 * legend names with `UNSET_LABEL`. That is a real answer, not a missing one: on
 * a plan, "seven of these are unassigned" is usually the most useful thing the
 * colour says.
 */
export const colorSampleFor = (
  dimension: TGanttColorBy,
  issue: TIssue | null | undefined,
  resolvers: TDimensionResolvers
): TColorSample => {
  if (!issue) return { key: null };
  switch (dimension) {
    case "state": {
      const id = issue.state_id;
      const state = id ? resolvers.getStateById?.(id) : null;
      return id ? { key: id, label: state?.name ?? "State", color: state?.color } : { key: null };
    }
    case "priority": {
      // Plane writes `none` rather than leaving it null, so `none` is a band
      // with a name and not the unset bucket.
      const value = issue.priority ?? "none";
      return { key: value, label: PRIORITY_LABEL[value] ?? value, color: PRIORITY_COLOR[value] };
    }
    case "assignee": {
      // First assignee only. A bar has one fill, and averaging two people's
      // colours would produce a third that means nobody.
      const id = issue.assignee_ids?.[0];
      return id ? { key: id, label: resolvers.getMemberName?.(id) ?? "Someone" } : { key: null };
    }
    case "label": {
      const id = issue.label_ids?.[0];
      const label = id ? resolvers.getLabelById?.(id) : null;
      return id ? { key: id, label: label?.name ?? "Label", color: label?.color ?? undefined } : { key: null };
    }
    case "cycle": {
      const id = issue.cycle_id;
      return id ? { key: id, label: resolvers.getCycleById?.(id)?.name ?? "Sprint" } : { key: null };
    }
    case "module": {
      // An item can sit in several modules; the lowest-named one is the band it
      // is filed under — the same tie-break the portfolio's API applies, so the
      // two screens agree about where a multi-module item lives.
      const ids = issue.module_ids ?? [];
      if (ids.length === 0) return { key: null };
      const named = ids
        .map((id) => ({ id, name: resolvers.getModuleById?.(id)?.name ?? "" }))
        // `.map` above already made a fresh array; toSorted is ES2023 and this
        // workspace type-checks against an earlier lib.
        // oxlint-disable-next-line unicorn/no-array-sort
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return { key: named[0].id, label: named[0].name || "Module" };
    }
    case "discipline": {
      const value = resolvers.getDiscipline?.(issue.id);
      return value ? { key: value, label: value } : { key: null };
    }
    default:
      return { key: null };
  }
};

/** Legend order for the dimensions that have a natural one. Frequency is the
 *  right order for people and sprints; it is the wrong order for a severity. */
export const dimensionOrder = (dimension: TGanttColorBy): string[] | undefined =>
  dimension === "priority" ? PRIORITY_ORDER : undefined;
