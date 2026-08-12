/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Optional grouping for the issue gantt: turns the flat list of block ids into the
 * same list with group headers interleaved, so "the hardware work" is a band on the
 * chart rather than rows you have to pick out by name.
 *
 * The categories are the ones the project already has. The setup wizard creates one
 * module per component — Hardware, Firmware, Software, Project management — so
 * grouping by module needs nothing set up; and labels are Plane's own tags, so
 * anything a team invents for itself groups here too.
 *
 * The gantt fetches ungrouped (canGroup: false) and both panes map over the same id
 * list, so grouping is done here, on what is loaded, rather than by refetching.
 */
import type { TIssue } from "@plane/types";

export type TGanttGroupBy = "none" | "module" | "label" | "assignee" | "state" | "priority" | "cycle";

export const GROUP_BY_OPTIONS: { value: TGanttGroupBy; label: string; hint?: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "module", label: "Module", hint: "Hardware, firmware, software — what the setup wizard creates" },
  { value: "label", label: "Label", hint: "Your own tags" },
  { value: "assignee", label: "Assignee" },
  { value: "state", label: "State" },
  { value: "priority", label: "Priority" },
  // The key stays `cycle` — it is Plane's field name and it is code. Only the
  // label is vocabulary, and here it is only ever a sprint.
  { value: "cycle", label: "Sprint" },
];

/** Prefixes a synthetic row id. Real ids are UUIDs, so this can never collide. */
export const GROUP_ROW_PREFIX = "__ggrp__:";
export const isGroupRowId = (id: string): boolean => id.startsWith(GROUP_ROW_PREFIX);

/**
 * Any row in any gantt's id list that stands for a band rather than a work item.
 *
 * The portfolio's prefixes are written out here rather than imported, because
 * this module is imported BY the portfolio's and the cycle would be real. They
 * are three string constants and the test names all four.
 *
 * This exists because `isGroupRowId` is the wrong question at the two places that
 * count rows: the toolbar's "N work items", and the id list handed to bulk
 * selection. The portfolio has always put `__folder__:` headers in the same list,
 * so a board with three swimlanes reported six projects for six, plus three, and
 * offered three synthetic ids to every bulk action behind "select all".
 */
const SYNTHETIC_ROW_PREFIXES = [GROUP_ROW_PREFIX, "__folder__:", "__pstat__:", "__psub__:"];
export const isSyntheticRowId = (id: string): boolean => SYNTHETIC_ROW_PREFIXES.some((prefix) => id.startsWith(prefix));
export const groupRowId = (key: string): string => `${GROUP_ROW_PREFIX}${key}`;
export const groupKeyFromRowId = (id: string): string => id.slice(GROUP_ROW_PREFIX.length);

/** Sorts last and reads as an answer rather than a blank. */
const UNSET = "__unset__";
const UNSET_LABEL: Record<TGanttGroupBy, string> = {
  none: "",
  module: "No module",
  label: "No label",
  assignee: "Unassigned",
  state: "No state",
  priority: "No priority",
  cycle: "Not in a sprint",
};

// Priority is the one dimension with a meaningful order that is not alphabetical.
const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"];
const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#dc2626",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#3f76ff",
  none: "#94a3b8",
};

export type TGanttGroupResolver = {
  getIssue: (id: string) => TIssue | undefined | null;
  getModule: (id: string) => { name: string } | undefined | null;
  getLabel: (id: string) => { name: string; color?: string | null } | undefined | null;
  getMemberName: (id: string) => string | undefined | null;
  getState: (id: string) => { name: string; color?: string | null; group?: string | null } | undefined | null;
  getCycle: (id: string) => { name: string } | undefined | null;
};

export type TGanttGroup = {
  key: string;
  label: string;
  color?: string;
  ids: string[];
  /** What the band is worth at a glance, so folding it away loses nothing:
   *  when it runs, how long it lasts, and how much of it is finished. */
  start: Date | null;
  end: Date | null;
  /** Calendar days from the group's first start to its last end, inclusive. Not a
   *  sum of durations — the tasks in a band overlap, and adding them up would say a
   *  fortnight of parallel work takes a month. */
  days: number;
  done: number;
};

const DAY_MS = 86_400_000;

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The lowest-named of the values an id list resolves to — the tie-break that keeps
 *  a multi-valued issue on the same row between renders. */
const firstByName = <T extends { name?: string }>(
  ids: string[] | null | undefined,
  lookup: (id: string) => T | undefined | null
): { id: string; value: T } | undefined =>
  (ids ?? [])
    .map((id) => ({ id, value: lookup(id) }))
    .filter((entry): entry is { id: string; value: T } => !!entry.value)
    // toSorted is ES2023 and this workspace targets earlier; .map/.filter already
    // returned a fresh array, so sorting it in place mutates nothing anyone holds.
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort((a, b) => String(a.value.name ?? "").localeCompare(String(b.value.name ?? "")))[0];

/**
 * Which group an issue belongs to.
 *
 * Module, label and assignee are many-per-issue, and an issue cannot be drawn on two
 * rows — the same id twice would give it two bars and break every dependency arrow's
 * row lookup. So a multi-valued issue is filed under its first value, sorted by name
 * so the answer does not change between renders. In practice the wizard puts each
 * task in exactly one module, which is the case this is for.
 */
const groupOf = (
  issue: TIssue,
  groupBy: TGanttGroupBy,
  resolve: TGanttGroupResolver
): { key: string; label: string; color?: string } => {
  if (groupBy === "module") {
    const hit = firstByName(issue.module_ids, resolve.getModule);
    return hit ? { key: hit.id, label: hit.value.name } : { key: UNSET, label: UNSET_LABEL.module };
  }
  if (groupBy === "label") {
    const hit = firstByName(issue.label_ids, resolve.getLabel);
    return hit
      ? { key: hit.id, label: hit.value.name, color: hit.value.color ?? undefined }
      : { key: UNSET, label: UNSET_LABEL.label };
  }
  if (groupBy === "assignee") {
    const ids = (issue.assignee_ids ?? [])
      .map((id) => ({ id, name: resolve.getMemberName(id) }))
      .filter((entry): entry is { id: string; name: string } => !!entry.name)
      // oxlint-disable-next-line unicorn/no-array-sort -- see firstByName above
      .sort((a, b) => a.name.localeCompare(b.name));
    const hit = ids[0];
    return hit ? { key: hit.id, label: hit.name } : { key: UNSET, label: UNSET_LABEL.assignee };
  }
  if (groupBy === "state") {
    const state = issue.state_id ? resolve.getState(issue.state_id) : null;
    return state
      ? { key: issue.state_id as string, label: state.name, color: state.color ?? undefined }
      : { key: UNSET, label: UNSET_LABEL.state };
  }
  if (groupBy === "cycle") {
    const cycle = issue.cycle_id ? resolve.getCycle(issue.cycle_id) : null;
    return cycle ? { key: issue.cycle_id as string, label: cycle.name } : { key: UNSET, label: UNSET_LABEL.cycle };
  }
  // priority is always set on an issue, "none" included
  const priority = issue.priority ?? "none";
  return {
    key: priority,
    label: priority.charAt(0).toUpperCase() + priority.slice(1),
    color: PRIORITY_COLOR[priority],
  };
};

/**
 * Group the ids, preserving the order they arrived in inside each group — that order
 * is the display filter's own (manual, start date, priority…), and grouping is not a
 * licence to overrule it.
 */
export const buildGroups = (
  issueIds: string[],
  groupBy: TGanttGroupBy,
  resolve: TGanttGroupResolver
): TGanttGroup[] => {
  if (groupBy === "none") return [];

  const byKey = new Map<string, TGanttGroup>();
  for (const id of issueIds) {
    const issue = resolve.getIssue(id);
    // An issue the store has not loaded yet still needs a row, or it would vanish
    // from the chart the moment grouping is switched on.
    const { key, label, color } = issue
      ? groupOf(issue, groupBy, resolve)
      : { key: UNSET, label: UNSET_LABEL[groupBy], color: undefined };
    const existing = byKey.get(key);
    if (existing) existing.ids.push(id);
    else byKey.set(key, { key, label, color, ids: [id], start: null, end: null, days: 0, done: 0 });
  }

  // Second pass for the numbers: the membership has to be settled first, and this
  // keeps the grouping itself readable.
  for (const group of byKey.values()) {
    let first: number | null = null;
    let last: number | null = null;
    for (const id of group.ids) {
      const issue = resolve.getIssue(id);
      if (!issue) continue;
      const state = issue.state_id ? resolve.getState(issue.state_id) : null;
      if (state?.group === "completed" || state?.group === "cancelled") group.done += 1;
      for (const value of [issue.start_date, issue.target_date]) {
        const date = parseDate(value);
        if (!date) continue;
        const time = date.getTime();
        if (first === null || time < first) first = time;
        if (last === null || time > last) last = time;
      }
    }
    if (first !== null && last !== null) {
      group.start = new Date(first);
      group.end = new Date(last);
      group.days = Math.round((last - first) / DAY_MS) + 1;
    }
  }

  const groups = [...byKey.values()];
  groups.sort((a, b) => {
    // The "none" bucket is always last: it is the leftovers, not a peer.
    if (a.key === UNSET) return 1;
    if (b.key === UNSET) return -1;
    if (groupBy === "priority") return PRIORITY_ORDER.indexOf(a.key) - PRIORITY_ORDER.indexOf(b.key);
    return a.label.localeCompare(b.label);
  });
  return groups;
};

/** The id list both panes render: a header row, then its members unless collapsed. */
export const flattenGroups = (groups: TGanttGroup[], collapsed: ReadonlySet<string>): string[] => {
  const rows: string[] = [];
  for (const group of groups) {
    rows.push(groupRowId(group.key));
    if (!collapsed.has(group.key)) rows.push(...group.ids);
  }
  return rows;
};
