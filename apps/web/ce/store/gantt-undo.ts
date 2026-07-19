/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A tiny undo stack for gantt bar date edits. The bar drag/resize handler records
 * each issue's dates BEFORE the change; Ctrl+Z (or the Undo button) re-applies the
 * previous dates. Cleared when the project changes so undo never crosses projects.
 */
import { action, computed, makeObservable, observable } from "mobx";

export type GanttUndoEntry = {
  projectId: string | null | undefined;
  issueId: string;
  prev: { start_date?: string | null; target_date?: string | null };
};

class GanttUndoStore {
  stack: GanttUndoEntry[] = [];

  constructor() {
    makeObservable(this, {
      stack: observable.shallow,
      canUndo: computed,
      push: action,
      pop: action,
      clear: action,
    });
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  push(entry: GanttUndoEntry): void {
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
