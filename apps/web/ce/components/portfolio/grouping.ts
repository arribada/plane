/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Two levels of banding for the portfolio: a GROUP over the project rows, and a
 * SUBGROUP over each project's work items.
 *
 * ---------------------------------------------------------------------------
 * Why the two levels take different axes, and why that is not a shortcut
 * ---------------------------------------------------------------------------
 *
 * The portfolio draws two kinds of row: projects, and — under an expanded one —
 * its work items. They do not carry the same fields. A project has no sprint, no
 * assignee, no priority and no discipline; a work item has all four and no
 * folder. Offering "group by priority" over project rows would be offering a
 * field that does not exist on the thing being grouped: every project would land
 * in the same band, and the control would look broken rather than empty.
 *
 * So the group axis is what a PROJECT has — which folder it is in, and what its
 * last status update said — with `project` meaning "no banding at all", which is
 * the board as it has always looked and therefore the default.
 *
 * The subgroup axis is what a WORK ITEM has, and it is deliberately the same list
 * and the same words as the work-item timeline's own Group control, because
 * "Sprint" has to mean Sprint on both screens. That is also the request's own
 * phrase — a rule *internal to the project* — which is exactly what a band inside
 * one project's rows is.
 *
 * Because the two lists are disjoint, "the subgroup may not equal the group" is
 * not a rule that has to be enforced: there is no value the two share. If a later
 * change gives them an overlap it will have to be enforced then, and
 * `subgroupOptionsFor` is where.
 *
 * ---------------------------------------------------------------------------
 * The indent scheme, at full depth
 * ---------------------------------------------------------------------------
 *
 *   folder band          0px   full-width, uppercase
 *     project row        0px   the portfolio's primary row, unindented
 *       subgroup band   12px   half-height tint, small caps
 *         item         +14px per parent-nesting level, from a 22px base
 *
 * Deepest realistic row: folder → project → subgroup → four nesting levels =
 * 22 + 56 = 78px of indent. GANTT_SIDEBAR_MIN_WIDTH is 240px, so after the
 * chevron and the row's own gaps that leaves roughly 140px of title at the
 * narrowest the sidebar can be dragged, and ~440px at its default. Short, but
 * still a title — and it is the four-level CAP that makes that true. Uncapped, a
 * chain of eight would leave nothing at all. See INDENT_CAP_LEVELS.
 */
import type { TPortfolioItem, TPortfolioProject } from "@/plane-web/types/arribada";
import { priorityColor } from "./colors";

/** Bands over the project rows. */
export type TPortfolioGroupBy = "project" | "folder" | "status";

/** Bands over one project's work items. Same axes, same words, as the work-item
 *  timeline's Group control. `cycle` stays Plane's field name; only the label is
 *  vocabulary, and here it is always a sprint. */
export type TPortfolioSubgroupBy = "none" | "cycle" | "module" | "assignee" | "discipline" | "state" | "priority";

export const PORTFOLIO_GROUP_OPTIONS: { value: TPortfolioGroupBy; label: string; hint?: string }[] = [
  { value: "project", label: "Project", hint: "One row per project — the board as it is" },
  { value: "folder", label: "Folder", hint: "The workspace's own project folders, as swimlanes" },
  { value: "status", label: "Status", hint: "On track, at risk, off track — from the latest update" },
];

export const PORTFOLIO_SUBGROUP_OPTIONS: { value: TPortfolioSubgroupBy; label: string; hint?: string }[] = [
  { value: "none", label: "No subgrouping" },
  { value: "cycle", label: "Sprint" },
  { value: "module", label: "Module", hint: "Hardware, firmware, software — what the setup wizard creates" },
  { value: "assignee", label: "Assignee" },
  { value: "discipline", label: "Discipline", hint: "What the work needs, whether or not anyone holds it" },
  { value: "state", label: "State" },
  { value: "priority", label: "Priority" },
];

/** Reserved for the day the two lists overlap. Today they cannot, and saying so
 *  in code is cheaper than a comment somebody edits past. */
export const subgroupOptionsFor = (
  groupBy: TPortfolioGroupBy
): { value: TPortfolioSubgroupBy; label: string; hint?: string }[] =>
  PORTFOLIO_SUBGROUP_OPTIONS.filter((option) => (option.value as string) !== (groupBy as string));

/** Synthetic row ids. Real ids are UUIDs, so neither can collide, and each
 *  prefix is distinct from the other's so a row can always say what it is. */
export const SUBGROUP_ROW_PREFIX = "__psub__:";
export const isSubgroupRowId = (id: string): boolean => id.startsWith(SUBGROUP_ROW_PREFIX);
/** Scoped to the project: the same module appears under every project that uses
 *  it, and one shared id would collapse them into one collapsible band. */
export const subgroupRowId = (projectId: string, key: string): string => `${SUBGROUP_ROW_PREFIX}${projectId}:${key}`;

/** How deep an indent may go before it stops being an indent and starts being a
 *  margin. Applies to parent-nesting only; the group and subgroup levels are
 *  fixed and are counted separately. */
export const INDENT_CAP_LEVELS = 4;

const UNSET = "__unset__";
const UNSET_LABEL: Record<TPortfolioSubgroupBy, string> = {
  none: "",
  cycle: "Not in a sprint",
  module: "No module",
  assignee: "Unassigned",
  discipline: "No discipline",
  state: "No state",
  priority: "No priority",
};

const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"];
// Was a duplicate of colors.ts's PRIORITY_COLOR. Imported from there now, so the
// two cannot drift and the theme-aware variant is shared.

export type TPortfolioSubgroup = { key: string; label: string; color?: string; itemIds: string[] };

export type TSubgroupResolver = {
  getState: (id: string) => { name: string; color?: string | null } | undefined | null;
};

/**
 * Which band a work item belongs to.
 *
 * Assignee, module and discipline are many-per-item and an item cannot be drawn
 * on two rows — the same id twice would give it two bars and break every
 * dependency arrow's row lookup. So a multi-valued item is filed under its
 * lowest-named value, which is stable between renders and is the same tie-break
 * the work-item timeline uses, so the two screens agree.
 */
const bandOf = (
  item: TPortfolioItem,
  subgroupBy: TPortfolioSubgroupBy,
  resolve: TSubgroupResolver,
  dark = false
): { key: string; label: string; color?: string } => {
  if (subgroupBy === "cycle") {
    return item.cycle ? { key: item.cycle.id, label: item.cycle.name } : { key: UNSET, label: UNSET_LABEL.cycle };
  }
  if (subgroupBy === "module") {
    return item.module ? { key: item.module.id, label: item.module.name } : { key: UNSET, label: UNSET_LABEL.module };
  }
  if (subgroupBy === "assignee") {
    // toSorted is ES2023 and this workspace targets earlier; the spread already
    // made a fresh array, so sorting it in place mutates nothing anyone holds.
    // oxlint-disable-next-line unicorn/no-array-sort
    const first = [...(item.assignees ?? [])].sort((a, b) => a.name.localeCompare(b.name))[0];
    return first ? { key: first.id, label: first.name } : { key: UNSET, label: UNSET_LABEL.assignee };
  }
  if (subgroupBy === "discipline") {
    // oxlint-disable-next-line unicorn/no-array-sort -- see the assignee branch
    const first = [...(item.disciplines ?? [])].sort((a, b) => a.localeCompare(b))[0];
    return first ? { key: first, label: first } : { key: UNSET, label: UNSET_LABEL.discipline };
  }
  if (subgroupBy === "state") {
    const state = item.state_id ? resolve.getState(item.state_id) : null;
    return state
      ? { key: item.state_id as string, label: state.name, color: state.color ?? undefined }
      : { key: UNSET, label: UNSET_LABEL.state };
  }
  const priority = item.priority ?? "none";
  return {
    key: priority,
    label: priority.charAt(0).toUpperCase() + priority.slice(1),
    color: priorityColor(dark)[priority],
  };
};

/**
 * One project's items banded, keeping the order they arrived in inside each band.
 *
 * That order is the portfolio's own (date, then sequence) and possibly a
 * parent-nested version of it; subgrouping is not a licence to overrule it.
 */
export const buildSubgroups = (
  itemIds: string[],
  getItem: (id: string) => TPortfolioItem | undefined,
  subgroupBy: TPortfolioSubgroupBy,
  resolve: TSubgroupResolver,
  dark = false
): TPortfolioSubgroup[] => {
  if (subgroupBy === "none" || itemIds.length === 0) return [];

  const byKey = new Map<string, TPortfolioSubgroup>();
  for (const id of itemIds) {
    const item = getItem(id);
    // An item the store has not resolved still needs a row, or it would vanish
    // the moment subgrouping was switched on.
    const { key, label, color } = item
      ? bandOf(item, subgroupBy, resolve, dark)
      : { key: UNSET, label: UNSET_LABEL[subgroupBy], color: undefined };
    const existing = byKey.get(key);
    if (existing) existing.itemIds.push(id);
    else byKey.set(key, { key, label, color, itemIds: [id] });
  }

  const bands = [...byKey.values()];
  bands.sort((a, b) => {
    // The "unset" bucket is always last: it is the leftovers, not a peer.
    if (a.key === UNSET) return 1;
    if (b.key === UNSET) return -1;
    if (subgroupBy === "priority") return PRIORITY_ORDER.indexOf(a.key) - PRIORITY_ORDER.indexOf(b.key);
    return a.label.localeCompare(b.label);
  });
  return bands;
};

/** The status band a project falls in. The latest update's own value, or the
 *  honest blank — which is not the same as "on track". */
export const STATUS_BAND_ORDER = ["off_track", "at_risk", "on_track", UNSET];
export const statusBandLabel = (key: string): string =>
  ({ on_track: "On track", at_risk: "At risk", off_track: "Off track" })[key] ?? "No update";

export const projectStatusKey = (
  project: TPortfolioProject | undefined,
  statusOf: (projectId: string) => string | undefined
): string => (project ? (statusOf(project.id) ?? UNSET) : UNSET);
