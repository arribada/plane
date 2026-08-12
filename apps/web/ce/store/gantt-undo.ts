/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A small undo stack for gantt bar date edits.
 *
 * One entry is one GESTURE, not one work item, and that is the whole change from
 * the first version. A drag with "push dependents" on rewrites a whole chain, and
 * an undo that put back only the bar under the cursor would leave the plan in a
 * state nobody ever chose — halfway between before and after. So an entry carries
 * every item the gesture moved, with the dates each of them had beforehand, and
 * Ctrl+Z puts all of them back together.
 *
 * Cleared when the project changes, so undo never crosses projects.
 */
import { action, computed, makeObservable, observable } from "mobx";

export type GanttUndoItem = {
  issueId: string;
  prev: { start_date?: string | null; target_date?: string | null };
};

export type GanttUndoEntry = {
  projectId: string | null | undefined;
  /** Everything one gesture moved. Never empty — `push` drops empties. */
  items: GanttUndoItem[];
  /** What the gesture was, for the button's title: "moved 1 item and 3 dependents". */
  label?: string;
};

class GanttUndoStore {
  stack: GanttUndoEntry[] = [];

  constructor() {
    makeObservable(this, {
      stack: observable.shallow,
      canUndo: computed,
      lastLabel: computed,
      push: action,
      pop: action,
      clear: action,
    });
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  /** What the next Ctrl+Z would put back, so the control can say so before it is
   *  pressed rather than after. */
  get lastLabel(): string | undefined {
    return this.stack.at(-1)?.label;
  }

  push(entry: GanttUndoEntry): void {
    if (!entry.items || entry.items.length === 0) return;
    this.stack.push(entry);
    if (this.stack.length > 50) this.stack.shift();
  }

  pop(): GanttUndoEntry | undefined {
    return this.stack.pop();
  }

  clear(): void {
    this.stack = [];
  }
}

export const ganttUndo = new GanttUndoStore();
