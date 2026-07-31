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
import type { TGanttGroup } from "./grouping";

export type TGanttGroupContext = {
  /** Empty when grouping is off. */
  byKey: Map<string, TGanttGroup>;
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
};

const EMPTY: TGanttGroupContext = {
  byKey: new Map(),
  isCollapsed: () => false,
  toggle: () => undefined,
};

export const GanttGroupContext = createContext<TGanttGroupContext>(EMPTY);

/** Safe outside a provider: every chart that never groups just reads the empty map. */
export const useGanttGroups = (): TGanttGroupContext => useContext(GanttGroupContext);
