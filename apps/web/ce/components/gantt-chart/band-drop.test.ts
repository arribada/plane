/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Dropping a work item on a band: the decision, not the gesture.
 *
 * The gesture itself needs a real pointer — pragmatic-drag-and-drop reads the
 * native drag events and jsdom fires none of them on its own. What IS testable,
 * and what actually went wrong, is the answer the drop leads to: which work item
 * goes into which sprint, when the drop is refused, and — the whole point of the
 * reported bug — that "nothing happened" is never one of the available outcomes.
 *
 * The reported defect was a sub-task dropped on a sprint band doing nothing at
 * all. Four of the paths below used to be a bare `return`, so a refusal and a
 * success looked the same from the reader's chair. Every case here asserts a
 * NAMED outcome for that reason: a reason code and a sentence, or a write.
 */
import { describe, expect, it } from "vitest";
import {
  GANTT_ROW_DRAG_INSTANCE,
  UNSET_GROUP_KEY,
  describeBandDrop,
  planBandDrop,
  type TBandDropIssue,
  type TBandDropInput,
} from "./band-drop";
import { buildGroups, groupRowId } from "./grouping";

const world = (rows: Record<string, TBandDropIssue>) => ({
  getIssue: (id: string) => rows[id],
  bandOf: (_id: string) => null as string | null,
});

/** A drop with everything sensible filled in, so each test states only what it
 *  is about. */
const drop = (over: Partial<TBandDropInput> & Pick<TBandDropInput, "groupKey" | "groupBy">): TBandDropInput => ({
  source: { id: "issue-1", dragInstanceId: GANTT_ROW_DRAG_INSTANCE },
  canEditPlan: true,
  getIssue: () => ({ id: "issue-1", project_id: "proj" }),
  bandOf: () => null,
  ...over,
});

describe("planBandDrop — the payload and the band", () => {
  it("files the work item the payload names into the sprint the band is of", () => {
    const plan = planBandDrop(
      drop({
        groupKey: "sprint-b",
        groupBy: "cycle",
        source: { id: "issue-7", dragInstanceId: GANTT_ROW_DRAG_INSTANCE },
        getIssue: () => ({ id: "issue-7", project_id: "proj", cycle_id: "sprint-a" }),
      })
    );
    expect(plan).toMatchObject({ kind: "join-sprint", issueId: "issue-7", cycleId: "sprint-b" });
  });

  it("carries a SUB-TASK's own id — a nested row is a work item like any other", () => {
    // The reported case. The sidebar publishes `block.id`, which is the real
    // work item id whether or not the row is drawn indented, so nothing here has
    // to unwrap a parent:child pair. Pinned so a future nesting change that
    // starts minting synthetic row ids fails here rather than 404-ing at runtime.
    const rows = world({
      "child-1": { id: "child-1", project_id: "proj", cycle_id: null },
    });
    const plan = planBandDrop(
      drop({
        groupKey: "sprint-a",
        groupBy: "cycle",
        source: { id: "child-1", dragInstanceId: GANTT_ROW_DRAG_INSTANCE },
        ...rows,
      })
    );
    expect(plan).toEqual({ kind: "join-sprint", issueId: "child-1", cycleId: "sprint-a" });
  });

  it("refuses a drag that is not one of this chart's rows, and says nothing about it", () => {
    const plan = planBandDrop(
      drop({ groupKey: "sprint-a", groupBy: "cycle", source: { id: "x", dragInstanceId: "SOMETHING_ELSE" } })
    );
    expect(plan).toEqual({ kind: "refused", reason: "not-our-drag", message: null });
  });

  it("refuses an empty payload with something to say", () => {
    const plan = planBandDrop(
      drop({ groupKey: "sprint-a", groupBy: "cycle", source: { dragInstanceId: GANTT_ROW_DRAG_INSTANCE } })
    );
    expect(plan).toMatchObject({ kind: "refused", reason: "no-item" });
    expect((plan as { message: string }).message).toBeTruthy();
  });
});

describe("planBandDrop — synthetic rows", () => {
  it("refuses a band header id by name rather than sending it to a uuid route", () => {
    const plan = planBandDrop(
      drop({
        groupKey: "sprint-a",
        groupBy: "cycle",
        source: { id: groupRowId("sprint-b"), dragInstanceId: GANTT_ROW_DRAG_INSTANCE },
      })
    );
    expect(plan).toMatchObject({ kind: "refused", reason: "synthetic-row" });
    expect((plan as { message: string }).message).toContain("heading");
  });

  it.each(["__folder__:hardware", "__pstat__:started", "__psub__:abc"])(
    "refuses the portfolio's synthetic row %s",
    (id) => {
      const plan = planBandDrop(
        drop({ groupKey: "sprint-a", groupBy: "cycle", source: { id, dragInstanceId: GANTT_ROW_DRAG_INSTANCE } })
      );
      expect(plan).toMatchObject({ kind: "refused", reason: "synthetic-row" });
    }
  );

  it("refuses a work item the store has not loaded", () => {
    const plan = planBandDrop(drop({ groupKey: "sprint-a", groupBy: "cycle", getIssue: () => undefined }));
    expect(plan).toMatchObject({ kind: "refused", reason: "unknown-item" });
  });

  it("refuses a draft item, which has no project to file it in", () => {
    const plan = planBandDrop(
      drop({ groupKey: "sprint-a", groupBy: "cycle", getIssue: () => ({ id: "issue-1", project_id: null }) })
    );
    expect(plan).toMatchObject({ kind: "refused", reason: "no-project" });
  });
});

describe("planBandDrop — what may be dropped into", () => {
  it.each(["state", "priority", "assignee", "label", "none"] as const)(
    "refuses a %s band, and explains why rather than doing nothing",
    (groupBy) => {
      const plan = planBandDrop(drop({ groupKey: "some-key", groupBy }));
      expect(plan).toMatchObject({ kind: "refused", reason: "not-assignable" });
      expect((plan as { message: string }).message).toBeTruthy();
    }
  );

  it("refuses a band with no key", () => {
    const plan = planBandDrop(drop({ groupKey: "", groupBy: "cycle" }));
    expect(plan).toMatchObject({ kind: "refused", reason: "not-assignable" });
  });

  it("refuses when the plan is locked, and does not quietly let the server say no", () => {
    // `CycleIssueViewSet` POST is in `GUARDED` in plan_guard.py: without this the
    // write goes out, comes back 403, the store rolls its optimistic update back,
    // and the row snaps home with nothing said.
    const plan = planBandDrop(drop({ groupKey: "sprint-a", groupBy: "cycle", canEditPlan: false }));
    expect(plan).toMatchObject({ kind: "refused", reason: "locked" });
    expect((plan as { message: string }).message).toContain("locked");
  });

  it("refuses a locked plan for module bands too", () => {
    const plan = planBandDrop(drop({ groupKey: "module-a", groupBy: "module", canEditPlan: false }));
    expect(plan).toMatchObject({ kind: "refused", reason: "locked" });
  });
});

describe("planBandDrop — sprints", () => {
  it("takes the item out of its sprint when dropped on the ungrouped band", () => {
    const plan = planBandDrop(
      drop({
        groupKey: UNSET_GROUP_KEY,
        groupBy: "cycle",
        getIssue: () => ({ id: "issue-1", project_id: "proj", cycle_id: "sprint-a" }),
      })
    );
    expect(plan).toEqual({ kind: "leave-sprint", issueId: "issue-1", cycleId: "sprint-a" });
  });

  it("refuses the ungrouped band when the item is already out, instead of a no-op", () => {
    const plan = planBandDrop(
      drop({
        groupKey: UNSET_GROUP_KEY,
        groupBy: "cycle",
        getIssue: () => ({ id: "issue-1", project_id: "proj", cycle_id: null }),
      })
    );
    expect(plan).toMatchObject({ kind: "refused", reason: "already-out" });
  });

  it("refuses the band the item is already in, and names it", () => {
    const plan = planBandDrop(
      drop({
        groupKey: "sprint-a",
        groupBy: "cycle",
        bandLabel: "Sprint A",
        getIssue: () => ({ id: "issue-1", project_id: "proj", cycle_id: "sprint-a" }),
      })
    );
    expect(plan).toMatchObject({ kind: "refused", reason: "already-in-band" });
    expect((plan as { message: string }).message).toContain("Sprint A");
  });

  it("moves an item that is in no sprint at all into one", () => {
    const plan = planBandDrop(
      drop({ groupKey: "sprint-a", groupBy: "cycle", getIssue: () => ({ id: "issue-1", project_id: "proj" }) })
    );
    expect(plan).toMatchObject({ kind: "join-sprint", cycleId: "sprint-a" });
  });
});

describe("planBandDrop — modules", () => {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- a fresh object per case, so no test can mutate another's fixture
  const inTwoModules = () => ({ id: "issue-1", project_id: "proj", module_ids: ["hardware", "firmware"] });

  it("adds the target and leaves ONLY the band the row was drawn in", () => {
    // The defect: this used to leave every module of the item's that happened to
    // be a band on the chart, so an item in Hardware AND Firmware dropped on
    // Software lost both — which is exactly what the code's own comment said it
    // must not do.
    const plan = planBandDrop(
      drop({
        groupKey: "software",
        groupBy: "module",
        getIssue: inTwoModules,
        bandOf: () => "hardware",
      })
    );
    expect(plan).toEqual({ kind: "join-modules", issueId: "issue-1", add: ["software"], remove: ["hardware"] });
  });

  it("removes nothing when the row was in the leftovers band", () => {
    const plan = planBandDrop(
      drop({
        groupKey: "software",
        groupBy: "module",
        getIssue: () => ({ id: "issue-1", project_id: "proj", module_ids: [] }),
        bandOf: () => UNSET_GROUP_KEY,
      })
    );
    expect(plan).toEqual({ kind: "join-modules", issueId: "issue-1", add: ["software"], remove: [] });
  });

  it("removes nothing when the band it was drawn in is not one of its modules", () => {
    const plan = planBandDrop(
      drop({
        groupKey: "software",
        groupBy: "module",
        getIssue: () => ({ id: "issue-1", project_id: "proj", module_ids: ["firmware"] }),
        bandOf: () => "hardware",
      })
    );
    expect(plan).toEqual({ kind: "join-modules", issueId: "issue-1", add: ["software"], remove: [] });
  });

  it("takes the item out of EVERY module when dropped on 'No module'", () => {
    // Leaving one behind would file the row under that module's band instead,
    // which reads as a drop that landed somewhere else.
    const plan = planBandDrop(
      drop({ groupKey: UNSET_GROUP_KEY, groupBy: "module", getIssue: inTwoModules, bandOf: () => "hardware" })
    );
    expect(plan).toEqual({ kind: "leave-modules", issueId: "issue-1", remove: ["hardware", "firmware"] });
  });

  it("refuses 'No module' when the item is in none", () => {
    const plan = planBandDrop(
      drop({
        groupKey: UNSET_GROUP_KEY,
        groupBy: "module",
        getIssue: () => ({ id: "issue-1", project_id: "proj", module_ids: [] }),
      })
    );
    expect(plan).toMatchObject({ kind: "refused", reason: "already-out" });
  });

  it("refuses a module the item is already in", () => {
    const plan = planBandDrop(
      drop({ groupKey: "firmware", groupBy: "module", getIssue: inTwoModules, bandOf: () => "hardware" })
    );
    expect(plan).toMatchObject({ kind: "refused", reason: "already-in-band" });
  });
});

describe("the sentinel this file duplicates", () => {
  it("is the key buildGroups actually files an item with no sprint under", () => {
    // `UNSET` is private to grouping.ts. If it ever drifts, "take it out of its
    // sprint" silently becomes "put it in the sprint whose id is `__unset__`",
    // which is a 404 on a uuid route.
    const groups = buildGroups(["issue-1"], "cycle", {
      getIssue: () => ({ id: "issue-1", cycle_id: null }) as never,
      getModule: () => null,
      getLabel: () => null,
      getMemberName: () => null,
      getState: () => null,
      getCycle: () => null,
    });
    expect(groups.map((group) => group.key)).toEqual([UNSET_GROUP_KEY]);
  });

  it("matches the dragInstanceId the sidebar rows publish", () => {
    // `gantt-dnd-HOC.tsx` is upstream's and writes this literal inline.
    expect(GANTT_ROW_DRAG_INSTANCE).toBe("GANTT_REORDER");
  });
});

describe("describeBandDrop", () => {
  it("says where a work item went", () => {
    expect(describeBandDrop({ kind: "join-sprint", issueId: "i", cycleId: "c" }, "Sprint B")).toContain("Sprint B");
    expect(describeBandDrop({ kind: "leave-sprint", issueId: "i", cycleId: "c" })).toContain("sprint");
  });

  it("counts the memberships a 'No module' drop removed", () => {
    expect(describeBandDrop({ kind: "leave-modules", issueId: "i", remove: ["a", "b"] })).toContain("2");
    expect(describeBandDrop({ kind: "leave-modules", issueId: "i", remove: ["a"] })).toContain("module");
  });

  it("hands back the refusal's own sentence", () => {
    expect(describeBandDrop({ kind: "refused", reason: "locked", message: "no." })).toBe("no.");
    expect(describeBandDrop({ kind: "refused", reason: "not-our-drag", message: null })).toBe("");
  });
});
