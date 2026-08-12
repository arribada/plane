/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Carries the computed gantt groups to the two panes that render them. The sidebar
 * and the chart map over the same id list from opposite sides of the tree, so the
 * groups have to reach both without either owning them.
 *
 * A context rather than the MobX display store on purpose: the groups are derived
 * from the loaded issues on every render, and writing derived state into an
 * observable during render is how you get "changed observable in a reaction" and a
 * render loop. This is computed once in the layout root and read from there.
 */
import { createContext, useContext } from "react";
import type { TGanttGroup, TGanttGroupBy } from "./grouping";

/**
 * What the two panes need to know about sub-task nesting.
 *
 * On the same context as the groups because it is the same problem: a row's
 * shape is decided in the layout root, from the loaded issues, and both panes
 * have to agree about it or the bars stop lining up with their labels.
 */
export type TGanttSubtaskContext = {
  /** False everywhere the chart does not nest, which is every chart that never
   *  provides this context, plus the one the reader has switched it off on. */
  enabled: boolean;
  depthOf: (id: string) => number;
  /** Direct children present on this chart, not the work item's own count. */
  childCountOf: (id: string) => number;
  parentOf: (id: string) => string | null;
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Every row on this chart that has children — what "fold all" folds. */
  parentIds: string[];
  /** The span the folded children cover when it reaches outside the parent's own
   *  bar, so a fold never hides work without saying so. Null otherwise. */
  rollupOf: (id: string) => { start: Date; end: Date } | null;
};

const NO_PARENTS: string[] = [];

const NO_SUBTASKS: TGanttSubtaskContext = {
  enabled: false,
  depthOf: () => 0,
  childCountOf: () => 0,
  parentOf: () => null,
  isCollapsed: () => false,
  toggle: () => undefined,
  parentIds: NO_PARENTS,
  rollupOf: () => null,
};

export type TGanttGroupContext = {
  /** Empty when grouping is off. */
  byKey: Map<string, TGanttGroup>;
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
  /** What the bands are bands OF. A drop onto a band means something different
   *  for each: joining a sprint is a real edit, whereas "drop onto High" would
   *  quietly re-prioritise, so only some are accepted. */
  groupBy: TGanttGroupBy;
  /** Move a work item into the band, or null when this grouping cannot be set by
   *  dropping. The layout root owns the mutation; the header only reports the
   *  gesture. */
  assign: ((issueId: string, groupKey: string) => Promise<void>) | null;
  /** Sub-task nesting. Independent of grouping — either can be on without the
   *  other — and computed in the same place for the same reason. */
  subtasks: TGanttSubtaskContext;
};

const EMPTY: TGanttGroupContext = {
  byKey: new Map(),
  isCollapsed: () => false,
  toggle: () => undefined,
  groupBy: "none",
  assign: null,
  subtasks: NO_SUBTASKS,
};

export const GanttGroupContext = createContext<TGanttGroupContext>(EMPTY);

/** Safe outside a provider: every chart that never groups just reads the empty map. */
export const useGanttGroups = (): TGanttGroupContext => useContext(GanttGroupContext);
