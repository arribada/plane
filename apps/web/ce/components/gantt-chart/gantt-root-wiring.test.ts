/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The props and fields the work-item timeline hands over, pinned.
 *
 * Each of these was a one-line omission in `base-gantt-root.tsx` that no rule
 * could catch, because every rule lived in a helper that was simply not called:
 * the export documented `progress` and never set it, dropped the `critical`
 * flag off every edge, the dependency handle was a bare `true`, and the undo
 * button rendered whatever the lock said. The helpers beside this file prove
 * the rules; this proves they are connected to anything.
 *
 * WHY A SOURCE-SHAPE TEST: mounting `BaseGanttRoot` needs the whole mobx root
 * store, the router, the issue stores and a layout — none of which jsdom has.
 * Same precedent as `portfolio/drag-wiring.test.ts`; markers are string
 * literals from the real diff, not invented symbol names.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(__dirname, "../../../core/components/issues/issue-layouts/gantt/base-gantt-root.tsx"),
  "utf8"
);

describe("the work-item timeline's wiring", () => {
  it("exports the progress fill the bars draw, from the same cache", () => {
    expect(source).toContain("peekProjectProgress(workspaceSlug?.toString(), projectId?.toString())");
    expect(source).toContain("progress: progressOf[id]");
  });

  it("exports the arrows with the chain flagged, from the same critical set as the rows", () => {
    expect(source).toContain("markCriticalEdges(graph, slack.critical)");
  });

  it("offers a dependency handle per block, by the bar's own permission, not to everybody", () => {
    expect(source).toContain("enableDependency={canEditBlock}");
    expect(source).not.toMatch(/^\s*enableDependency\s*$/m);
  });

  it("gates the undo on the plan permission, in the handler, the key and the button", () => {
    expect(source).toContain("{isAllowed && <GanttUndoButton onUndo={handleGanttUndo} />}");
    expect(source).toContain("if (!canEditPlanRef.current || !ganttUndo.canUndo) return;");
    expect(source).toContain("ganttUndo.setEditable(isAllowed);");
  });

  it("keeps finished work out of a push", () => {
    expect(source).toContain("finished: new Set(");
  });
});
