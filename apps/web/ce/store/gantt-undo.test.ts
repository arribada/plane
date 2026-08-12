/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One undo entry is one GESTURE, not one work item.
 *
 * A drag with "push dependents" on rewrites a whole chain. An undo that put back
 * only the bar under the cursor would leave the plan halfway between before and
 * after — a state nobody chose. The stack therefore holds a list per entry, and
 * refuses to record an empty one, because a button offering to undo nothing is
 * worse than no button.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ganttUndo } from "./gantt-undo";

const entry = (ids: string[], label?: string) => ({
  projectId: "p1",
  items: ids.map((id) => ({ issueId: id, prev: { start_date: "2026-08-10", target_date: "2026-08-11" } })),
  label,
});

describe("ganttUndo", () => {
  beforeEach(() => ganttUndo.clear());

  it("has nothing to undo when nothing has happened", () => {
    expect(ganttUndo.canUndo).toBe(false);
    expect(ganttUndo.lastLabel).toBeUndefined();
  });

  it("keeps every item one gesture moved in a single entry", () => {
    ganttUndo.push(entry(["a", "b", "c"], "3 work items moved"));
    const popped = ganttUndo.pop();
    expect(popped?.items.map((i) => i.issueId)).toEqual(["a", "b", "c"]);
    expect(ganttUndo.canUndo).toBe(false);
  });

  it("says what the next undo would put back, before it is pressed", () => {
    ganttUndo.push(entry(["a"], "the dates just set"));
    ganttUndo.push(entry(["a", "b"], "2 work items moved"));
    expect(ganttUndo.lastLabel).toBe("2 work items moved");
  });

  it("refuses an entry that would undo nothing", () => {
    ganttUndo.push({ projectId: "p1", items: [] });
    expect(ganttUndo.canUndo).toBe(false);
  });

  it("keeps the stack bounded", () => {
    for (let i = 0; i < 60; i += 1) ganttUndo.push(entry([`a${i}`]));
    expect(ganttUndo.stack.length).toBe(50);
    expect(ganttUndo.stack[0].items[0].issueId).toBe("a10");
  });

  it("forgets everything when the project changes", () => {
    ganttUndo.push(entry(["a"]));
    ganttUndo.clear();
    expect(ganttUndo.canUndo).toBe(false);
  });
});
