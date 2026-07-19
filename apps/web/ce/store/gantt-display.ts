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

  constructor() {
    makeObservable(this, { colorBy: observable.ref, setColorBy: action });
  }

  setColorBy = (v: TGanttColorBy): void => {
    this.colorBy = v;
  };
}

export const ganttDisplay = new GanttDisplayStore();
