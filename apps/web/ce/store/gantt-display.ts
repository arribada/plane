/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Shared "colour the gantt bars by…" preference for the issue gantt. A tiny MobX
 * singleton (no root-store wiring): the block renderer reads colorBy, a small
 * toolbar control sets it.
 */
import { action, makeObservable, observable } from "mobx";
import type { TGanttColorBy } from "@/plane-web/components/gantt-chart/color-dimension";
import type { TGanttGroupBy } from "@/plane-web/components/gantt-chart/grouping";

export type { TGanttColorBy };

/** "graph" walks the dependency edges; "default" leaves the display filter's own
 *  order alone. Separate from Plane's order_by because it is not a field sort. */
export type TGanttRowOrder = "default" | "graph";

const STORAGE_KEY = "arribada.gantt.display";

/**
 * One key per workspace.
 *
 * The unscoped key was shared by every workspace a person opens, so grouping a
 * hardware programme by module quietly regrouped an unrelated workspace's board
 * the same way. Scoping is a suffix and a fallback, which is cheap enough that
 * there is no reason to keep the global one.
 *
 * The legacy key is still read when the scoped one is absent, so an existing
 * preference is inherited once rather than reset; the next write goes to the
 * scoped key and the two stop tracking each other from then on.
 */
const keyFor = (scope: string | null): string => (scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY);

/** The workspace slug is the first path segment. Read at construction so the
 *  first paint already has the right workspace's preferences — an effect would
 *  render one frame of the previous workspace's grouping first. Client-side
 *  navigation is handled by setScope. */
const scopeFromLocation = (): string | null => {
  try {
    const first = window.location.pathname.split("/").find(Boolean);
    // Not a slug: the sign-in and workspace-creation paths sit at the root too.
    if (!first || first.startsWith("(") || ["create-workspace", "god-mode", "profile"].includes(first)) return null;
    return first;
  } catch {
    return null;
  }
};

/**
 * The bar colour used to be decided here, per issue, by hashing the assignee's
 * uuid into an HSL hue. It is decided by `color-scale.ts` now, over the whole
 * chart at once, because a colour scale that can only see one row cannot promise
 * that two rows differ — see the note at the top of `palette.ts`.
 */

class GanttDisplayStore {
  colorBy: TGanttColorBy = "state";
  /**
   * Draw finished work distinctly — a 45-degree hatch and a tick, never a
   * separate colour. On by default because "what is already done" is the first
   * question anyone asks a plan, and off is a real answer for the case it was
   * added for: a chart being read for what is LEFT, where the finished bars are
   * noise.
   */
  showCompleted = true;
  groupBy: TGanttGroupBy = "none";
  rowOrder: TGanttRowOrder = "default";
  /** Sub-tasks folded into their parent's row. On by default: a generated plan
   *  is mostly parents with two or three sub-tasks each, and drawn flat it is a
   *  list of forty rows where ten of them are the plan. Unticking it gives back
   *  exactly the flat list this chart drew before. */
  nestSubtasks = true;
  /** Group keys the viewer has folded away. Cleared when the dimension changes,
   *  because a key from one dimension means nothing in another. */
  collapsedGroups = new Set<string>();
  /** Parents whose sub-tasks are folded away. Session-only, like the group folds:
   *  a fold is where you are in a document, not a preference. */
  collapsedSubtasks = new Set<string>();
  /** The grouping a drag consumed, so the toolbar can say the manual order came
   *  from somewhere rather than appearing to have discarded the bands. Null when
   *  the order was never anything but manual. */
  flattenedFrom: TGanttGroupBy | null = null;
  /** Which workspace the persisted preferences belong to. */
  scope: string | null = null;

  constructor() {
    makeObservable(this, {
      colorBy: observable.ref,
      showCompleted: observable.ref,
      groupBy: observable.ref,
      rowOrder: observable.ref,
      nestSubtasks: observable.ref,
      collapsedGroups: observable,
      collapsedSubtasks: observable,
      flattenedFrom: observable.ref,
      scope: observable.ref,
      setColorBy: action,
      setShowCompleted: action,
      setGroupBy: action,
      setRowOrder: action,
      setNestSubtasks: action,
      toggleGroupCollapsed: action,
      setAllGroupsCollapsed: action,
      toggleSubtaskCollapsed: action,
      setAllSubtasksCollapsed: action,
      flattenGrouping: action,
      setScope: action,
    });
    this.scope = scopeFromLocation();
    this.restore();
  }

  /** Point the store at a workspace. Cheap and idempotent, so it can be called
   *  from an effect on every render of the chart. */
  setScope = (scope: string | null | undefined): void => {
    const next = scope ?? null;
    if (next === this.scope) return;
    this.scope = next;
    // A fold refers to keys from the workspace being left behind.
    this.collapsedGroups = new Set();
    this.collapsedSubtasks = new Set();
    this.flattenedFrom = null;
    this.restore();
  };

  setColorBy = (v: TGanttColorBy): void => {
    this.colorBy = v;
    this.persist();
  };

  setShowCompleted = (v: boolean): void => {
    this.showCompleted = v;
    this.persist();
  };

  setGroupBy = (v: TGanttGroupBy): void => {
    this.groupBy = v;
    this.collapsedGroups = new Set();
    // Picking a grouping by hand answers "where did my bands go?" itself.
    this.flattenedFrom = null;
    this.persist();
  };

  setRowOrder = (v: TGanttRowOrder): void => {
    this.rowOrder = v;
    this.persist();
  };

  setNestSubtasks = (v: boolean): void => {
    this.nestSubtasks = v;
    // Folds are meaningless once the rows are flat again, and stale folds would
    // hide rows the moment nesting came back on.
    if (!v) this.collapsedSubtasks = new Set();
    this.persist();
  };

  toggleGroupCollapsed = (key: string): void => {
    const next = new Set(this.collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsedGroups = next;
  };

  setAllGroupsCollapsed = (keys: string[], collapsed: boolean): void => {
    this.collapsedGroups = collapsed ? new Set(keys) : new Set();
  };

  toggleSubtaskCollapsed = (id: string): void => {
    const next = new Set(this.collapsedSubtasks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsedSubtasks = next;
  };

  setAllSubtasksCollapsed = (ids: string[], collapsed: boolean): void => {
    this.collapsedSubtasks = collapsed ? new Set(ids) : new Set();
  };

  /**
   * A drag has turned the bands into a plain sequence.
   *
   * The rows do not move — the caller has already written the grouped sequence
   * down as the manual order — so all this does is drop the headers and remember
   * what they were, which is the difference between "the grouping was consumed"
   * and "the grouping vanished".
   */
  flattenGrouping = (from: TGanttGroupBy): void => {
    if (from === "none") return;
    this.groupBy = "none";
    this.collapsedGroups = new Set();
    this.flattenedFrom = from;
    this.persist();
  };

  /** Both sides best-effort: localStorage is unavailable in some privacy modes, and
   *  a display preference is not worth an exception. */
  private restore() {
    // Back to the defaults first. Without this, switching workspaces would keep
    // whatever the previous one had wherever the new one has stored nothing —
    // which is the leak the scoped key exists to close.
    this.colorBy = "state";
    this.showCompleted = true;
    this.groupBy = "none";
    this.rowOrder = "default";
    this.nestSubtasks = true;
    try {
      const raw = localStorage.getItem(keyFor(this.scope)) ?? localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { colorBy, showCompleted, groupBy, rowOrder, nestSubtasks } = JSON.parse(raw) as {
        colorBy?: TGanttColorBy;
        showCompleted?: boolean;
        groupBy?: TGanttGroupBy;
        rowOrder?: TGanttRowOrder;
        nestSubtasks?: boolean;
      };
      if (colorBy) this.colorBy = colorBy;
      if (groupBy) this.groupBy = groupBy;
      if (rowOrder) this.rowOrder = rowOrder;
      // Not `if (nestSubtasks)`: false is the whole point of storing it.
      if (typeof nestSubtasks === "boolean") this.nestSubtasks = nestSubtasks;
      if (typeof showCompleted === "boolean") this.showCompleted = showCompleted;
    } catch {
      // keep the defaults
    }
  }

  private persist() {
    try {
      localStorage.setItem(
        keyFor(this.scope),
        JSON.stringify({
          colorBy: this.colorBy,
          showCompleted: this.showCompleted,
          groupBy: this.groupBy,
          rowOrder: this.rowOrder,
          nestSubtasks: this.nestSubtasks,
        })
      );
    } catch {
      // session-only
    }
  }
}

export const ganttDisplay = new GanttDisplayStore();
