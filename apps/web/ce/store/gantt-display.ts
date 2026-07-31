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
import type { TIssue } from "@plane/types";
import type { TGanttGroupBy } from "@/plane-web/components/gantt-chart/grouping";

/** "graph" walks the dependency edges; "default" leaves the display filter's own
 *  order alone. Separate from Plane's order_by because it is not a field sort. */
export type TGanttRowOrder = "default" | "graph";

const STORAGE_KEY = "arribada.gantt.display";

export type TGanttColorBy = "state" | "priority" | "assignee" | "label";

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#dc2626",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#3f76ff",
  none: "#94a3b8",
};

const hashHue = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
};

// Bar colour for the selected dimension; null => keep the default (state) colour.
export const ganttBarColor = (
  colorBy: TGanttColorBy,
  issue: TIssue | undefined | null,
  getLabelColor: (id: string) => string | null | undefined
): string | null => {
  if (!issue) return null;
  if (colorBy === "priority") return PRIORITY_COLOR[issue.priority ?? "none"] ?? PRIORITY_COLOR.none;
  if (colorBy === "assignee") {
    const a = issue.assignee_ids?.[0];
    return a ? `hsl(${hashHue(a)}, 55%, 52%)` : "#94a3b8";
  }
  if (colorBy === "label") {
    const l = issue.label_ids?.[0];
    return (l && getLabelColor(l)) || "#94a3b8";
  }
  return null;
};

class GanttDisplayStore {
  colorBy: TGanttColorBy = "state";
  groupBy: TGanttGroupBy = "none";
  rowOrder: TGanttRowOrder = "default";
  /** Group keys the viewer has folded away. Cleared when the dimension changes,
   *  because a key from one dimension means nothing in another. */
  collapsedGroups = new Set<string>();

  constructor() {
    makeObservable(this, {
      colorBy: observable.ref,
      groupBy: observable.ref,
      rowOrder: observable.ref,
      collapsedGroups: observable,
      setColorBy: action,
      setGroupBy: action,
      setRowOrder: action,
      toggleGroupCollapsed: action,
      setAllGroupsCollapsed: action,
    });
    this.restore();
  }

  setColorBy = (v: TGanttColorBy): void => {
    this.colorBy = v;
    this.persist();
  };

  setGroupBy = (v: TGanttGroupBy): void => {
    this.groupBy = v;
    this.collapsedGroups = new Set();
    this.persist();
  };

  setRowOrder = (v: TGanttRowOrder): void => {
    this.rowOrder = v;
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

  /** Both sides best-effort: localStorage is unavailable in some privacy modes, and
   *  a display preference is not worth an exception. */
  private restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { colorBy, groupBy, rowOrder } = JSON.parse(raw) as {
        colorBy?: TGanttColorBy;
        groupBy?: TGanttGroupBy;
        rowOrder?: TGanttRowOrder;
      };
      if (colorBy) this.colorBy = colorBy;
      if (groupBy) this.groupBy = groupBy;
      if (rowOrder) this.rowOrder = rowOrder;
    } catch {
      // keep the defaults
    }
  }

  private persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ colorBy: this.colorBy, groupBy: this.groupBy, rowOrder: this.rowOrder })
      );
    } catch {
      // session-only
    }
  }
}

export const ganttDisplay = new GanttDisplayStore();
