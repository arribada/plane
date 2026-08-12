/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a new sub-work item inherits — the decision, not the dialog.
 *
 * Nothing here mounts the create modal. The modal's job is to render a form and
 * post it; the thing that was WRONG was the payload it was handed, and that is a
 * pure function of the parent. Testing it at that level is also the only way to
 * pin the negative half of the rule — that assignees, state and dates are NOT
 * carried down — because "the assignee dropdown is empty" is indistinguishable
 * in jsdom from "the member store never loaded".
 *
 * Two assertions look pedantic and are not. `not.toHaveProperty` rather than
 * `toBeUndefined`: the form spreads this object over
 * `DEFAULT_WORK_ITEM_FORM_VALUES`, and a key present with an `undefined` value
 * overwrites a real default while an absent key does not — the two are the same
 * to `toBeUndefined` and opposite in the form. And the module array is asserted
 * to be a COPY: the parent object comes straight out of the MobX issue map, so
 * handing its array to a form that pushes into it would edit the parent.
 */
import { describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { inheritedSubIssueDefaults, type TInheritableParent } from "./inherited-defaults";

const parentOf = (overrides: Partial<TInheritableParent> = {}): TInheritableParent => ({
  id: "parent-1",
  project_id: "project-1",
  cycle_id: null,
  module_ids: null,
  priority: "none",
  ...overrides,
});

describe("inheritedSubIssueDefaults", () => {
  it("carries the parent's sprint, modules and project down to the child", () => {
    const defaults = inheritedSubIssueDefaults(
      parentOf({ cycle_id: "sprint-5", module_ids: ["module-a", "module-b"] })
    );

    expect(defaults.cycle_id).toBe("sprint-5");
    expect(defaults.module_ids).toEqual(["module-a", "module-b"]);
    expect(defaults.project_id).toBe("project-1");
    expect(defaults.parent_id).toBe("parent-1");
  });

  it("hands the child a copy of the module list, not the parent's own array", () => {
    const parent = parentOf({ module_ids: ["module-a"] });

    const defaults = inheritedSubIssueDefaults(parent);

    expect(defaults.module_ids).not.toBe(parent.module_ids);
  });

  it("omits the sprint entirely when the parent is in none, rather than writing undefined over the default", () => {
    const defaults = inheritedSubIssueDefaults(parentOf({ cycle_id: null, module_ids: null }));

    expect(defaults).not.toHaveProperty("cycle_id");
    expect(defaults).not.toHaveProperty("module_ids");
  });

  it("omits the module list when the parent belongs to no modules at all", () => {
    const defaults = inheritedSubIssueDefaults(parentOf({ module_ids: [] }));

    expect(defaults).not.toHaveProperty("module_ids");
  });

  it("does not inherit assignees, state, dates, estimate or labels", () => {
    // Everything a parent can carry that describes who is doing it, how far
    // along it is, or when — none of which is true of a child by construction.
    const parent = {
      ...parentOf({ cycle_id: "sprint-5" }),
      assignee_ids: ["member-1"],
      state_id: "state-in-progress",
      start_date: "2026-08-01",
      target_date: "2026-08-31",
      estimate_point: "estimate-5",
      label_ids: ["label-1"],
    } as unknown as TInheritableParent;

    const defaults = inheritedSubIssueDefaults(parent);

    expect(defaults).not.toHaveProperty("assignee_ids");
    expect(defaults).not.toHaveProperty("state_id");
    expect(defaults).not.toHaveProperty("start_date");
    expect(defaults).not.toHaveProperty("target_date");
    expect(defaults).not.toHaveProperty("estimate_point");
    expect(defaults).not.toHaveProperty("label_ids");
  });

  it("inherits a priority the parent actually has", () => {
    const defaults = inheritedSubIssueDefaults(parentOf({ priority: "urgent" }));

    expect(defaults.priority).toBe("urgent");
  });

  it("leaves priority alone when the parent has none, because none means untriaged", () => {
    const defaults = inheritedSubIssueDefaults(parentOf({ priority: "none" }));

    expect(defaults).not.toHaveProperty("priority");
  });

  it("lets an explicit value from the caller beat the inherited one", () => {
    const defaults = inheritedSubIssueDefaults(parentOf({ cycle_id: "sprint-5", priority: "urgent" }), {
      cycle_id: "sprint-6",
      priority: "low",
    });

    expect(defaults.cycle_id).toBe("sprint-6");
    expect(defaults.priority).toBe("low");
  });

  it("treats an explicit null as a real answer and clears the inherited sprint", () => {
    // `null` is how this modal spells "no sprint" everywhere else, so a caller
    // that says it must not be quietly overruled by the parent.
    const defaults = inheritedSubIssueDefaults(parentOf({ cycle_id: "sprint-5" }), { cycle_id: null });

    expect(defaults.cycle_id).toBeNull();
  });

  it("treats an explicit undefined as no opinion and keeps the inherited sprint", () => {
    const defaults = inheritedSubIssueDefaults(parentOf({ cycle_id: "sprint-5" }), { cycle_id: undefined });

    expect(defaults.cycle_id).toBe("sprint-5");
  });

  it("still returns the caller's own fields when the parent is not in the store yet", () => {
    // A cold issue map must degrade to the old behaviour — the child keeps its
    // parent and its project — never to a child created with no parent at all.
    const explicit: Partial<TIssue> = { parent_id: "parent-1", project_id: "project-1" };

    expect(inheritedSubIssueDefaults(undefined, explicit)).toEqual(explicit);
    expect(inheritedSubIssueDefaults(null, explicit)).toEqual(explicit);
  });

  it("returns nothing at all when there is neither a parent nor a caller value", () => {
    expect(inheritedSubIssueDefaults(undefined)).toEqual({});
  });
});
