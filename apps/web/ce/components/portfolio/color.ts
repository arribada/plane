/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which value a portfolio row has on the dimension the board is coloured by, and
 * whether that row is finished.
 *
 * Pure. It is handed a row and a bag of resolvers and answers a `{ key, label,
 * color? }`; handing out the six validated hues, folding the seventh series and
 * naming the legend are `gantt-chart/palette.ts`'s problem. This file only
 * decides that THIS bar belongs to Ruby, or to Sprint 12, or to nothing at all.
 *
 * ---------------------------------------------------------------------------
 * The board draws two kinds of row, and they are not on the same axes
 * ---------------------------------------------------------------------------
 *
 * A portfolio row is either a PROJECT summary or one of that project's WORK
 * ITEMS. A project has no sprint, no assignee, no priority and no discipline —
 * the same asymmetry `grouping.ts` had to reason about for the two levels of
 * banding, and it lands here for the same reason.
 *
 * Colouring a project row by a field a project does not have would file every
 * project under "Unassigned", which reads as a fact about the work — "nobody
 * owns these twelve projects" — and is not one. So on every dimension except
 * `project`, a project summary bar is drawn in a NEUTRAL and takes no part in
 * the scale: it is not an unset value, it is a row that is not on that axis. The
 * legend says so in as many words rather than leaving the reader to work out why
 * the bold bars are all grey.
 *
 * ---------------------------------------------------------------------------
 * Why `project` keeps its hashed hue
 * ---------------------------------------------------------------------------
 *
 * Every other dimension is a SERIES encoding — several rows share a value, and
 * the only thing saying which value is the colour — so it goes through the
 * validated six-step palette and folds past six.
 *
 * `project` is not that. There is exactly one project per project, the project's
 * name is written inside its own bar AND again in the sidebar, and a board of
 * twenty-four projects folded to six would be six colours and eighteen rows in
 * "Other", which is worse than useless. Colour there is a repeated identity cue
 * on a directly-labelled row, not an encoding that has to be decoded — so it
 * keeps `projectColor`'s hashed hue, and it is deliberately the one dimension
 * that draws NO series legend. See the note on direct labels in the legend.
 */
import type { TColorSample } from "@/plane-web/components/gantt-chart/palette";
import type { TPortfolioColorBy, TPortfolioItem, TPortfolioProject } from "@/plane-web/types/arribada";
import { PRIORITY_COLOR, projectColor } from "./colors";

export const PORTFOLIO_COLOR_OPTIONS: { value: TPortfolioColorBy; label: string; hint?: string }[] = [
  { value: "project", label: "Project", hint: "One hue per project — the board as it has always looked" },
  { value: "state", label: "State" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "cycle", label: "Sprint" },
  { value: "module", label: "Module", hint: "Hardware, firmware, software" },
  { value: "discipline", label: "Discipline", hint: "What the work needs, whether or not anyone holds it" },
];

/** What a work item with no value on this dimension is called. Deliberately the
 *  same words as the work-item timeline's `UNSET_LABEL` and as the portfolio's
 *  own subgroup bands: "Not in a sprint" has to mean the same thing on all
 *  three screens. */
export const PORTFOLIO_UNSET_LABEL: Record<TPortfolioColorBy, string> = {
  project: "No project",
  state: "No state",
  priority: "No priority",
  assignee: "Unassigned",
  cycle: "Not in a sprint",
  module: "No module",
  discipline: "No discipline",
};

/** Severity order, so the legend never sorts "Urgent" under "Medium". */
export const PORTFOLIO_PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"];

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

/** The colour a project summary bar takes on a dimension projects are not on.
 *  A slate that is in neither the light nor the dark six, so it can never be
 *  mistaken for a series. */
export const PORTFOLIO_SUMMARY_COLOR = "#64748b";

export type TPortfolioColorResolvers = {
  /** Plane's own state record. `group` is what decides done-ness; `color` is what
   *  the state is painted with on every other screen, and is passed through. */
  getState?: (id: string) => { name?: string; color?: string | null; group?: string } | null | undefined;
};

/**
 * `project` is an identity dimension over rows that are already labelled, so it
 * is the one place a hashed hue is the right answer. Everything else is a series
 * encoding and goes through the validated palette.
 */
export const isSeriesDimension = (dimension: TPortfolioColorBy): boolean => dimension !== "project";

/**
 * The value one work item takes on `dimension`.
 *
 * Multi-valued fields are filed under their lowest-named value — the same
 * tie-break `grouping.ts` applies when it bands them, so a board that is grouped
 * by module and coloured by module cannot disagree with itself about which
 * module an item is in.
 */
export const portfolioItemSample = (
  dimension: TPortfolioColorBy,
  item: TPortfolioItem,
  resolvers: TPortfolioColorResolvers = {}
): TColorSample => {
  switch (dimension) {
    case "state": {
      const state = item.state_id ? resolvers.getState?.(item.state_id) : null;
      return item.state_id && state
        ? { key: item.state_id, label: state.name ?? "State", color: state.color ?? undefined }
        : { key: null };
    }
    case "priority": {
      // Plane writes `none` rather than leaving it null, so "None" is a band with
      // a name and not the unset bucket.
      const priority = item.priority ?? "none";
      return { key: priority, label: PRIORITY_LABEL[priority] ?? priority, color: PRIORITY_COLOR[priority] };
    }
    case "assignee": {
      // oxlint-disable-next-line unicorn/no-array-sort -- the spread already made a fresh array
      const first = [...(item.assignees ?? [])].sort((a, b) => a.name.localeCompare(b.name))[0];
      return first ? { key: first.id, label: first.name } : { key: null };
    }
    case "cycle":
      return item.cycle ? { key: item.cycle.id, label: item.cycle.name } : { key: null };
    case "module":
      return item.module ? { key: item.module.id, label: item.module.name } : { key: null };
    case "discipline": {
      // oxlint-disable-next-line unicorn/no-array-sort -- see the assignee branch
      const first = [...(item.disciplines ?? [])].sort((a, b) => a.localeCompare(b))[0];
      return first ? { key: first, label: first } : { key: null };
    }
    default:
      return { key: null };
  }
};

/**
 * Which of Plane's five state groups a work item is in: `backlog`, `unstarted`,
 * `started`, `completed` or `cancelled`.
 *
 * The GROUP, not the state name — a workspace can call its done column anything,
 * and the group is the only thing that survives being renamed. Undefined when
 * the item has no state, or when the state store has not loaded it yet, and
 * every caller here treats that as "the ordinary run of work" rather than
 * guessing.
 */
export const itemStateGroup = (item: TPortfolioItem, resolvers: TPortfolioColorResolvers = {}): string | undefined =>
  item.state_id ? resolvers.getState?.(item.state_id)?.group : undefined;

/**
 * Whether a work item is FINISHED — delivered, not abandoned.
 *
 * `cancelled` used to answer true here as well, on the reasoning that the toggle
 * answers "what is still ahead of me" and a cancelled item is not. That reading
 * of the toggle is right and the conflation was still wrong: it drew a ✓ on
 * abandoned work, and a tick means achieved. The two groups now have two
 * treatments — see the note at the bottom of `palette.ts` — and `isItemCancelled`
 * is the other half.
 */
export const isItemDone = (item: TPortfolioItem, resolvers: TPortfolioColorResolvers = {}): boolean =>
  itemStateGroup(item, resolvers) === "completed";

/** Whether a work item was abandoned. Off the board, like a finished one, and
 *  not the same fact about it. */
export const isItemCancelled = (item: TPortfolioItem, resolvers: TPortfolioColorResolvers = {}): boolean =>
  itemStateGroup(item, resolvers) === "cancelled";

/**
 * Whether a project is finished — every work item in it is.
 *
 * A project with no items at all is NOT done. Nothing has happened to it, and
 * `0 === 0` would otherwise hatch every empty project on the board.
 */
export const isProjectDone = (project: TPortfolioProject | undefined): boolean =>
  !!project && !!project.item_count && (project.completed_item_count ?? 0) >= project.item_count;

/**
 * The colour a row is painted, given a scale.
 *
 * `scaleColorOf` is the scale built over the whole board; it is only consulted
 * for rows that are actually on the dimension. Project rows on a work-item
 * dimension short-circuit to the neutral before they can reach it — which is the
 * whole point of the split, and the reason this function exists rather than
 * every caller reimplementing the fall-throughs.
 */
export const portfolioRowColor = (
  dimension: TPortfolioColorBy,
  row: { isProject: boolean; projectId: string | undefined; item: TPortfolioItem | undefined },
  scaleColorOf: (key: string | null | undefined) => string,
  resolvers: TPortfolioColorResolvers = {}
): string => {
  if (dimension === "project") return row.projectId ? projectColor(row.projectId) : PORTFOLIO_SUMMARY_COLOR;
  if (row.isProject || !row.item) return PORTFOLIO_SUMMARY_COLOR;
  return scaleColorOf(portfolioItemSample(dimension, row.item, resolvers).key);
};
