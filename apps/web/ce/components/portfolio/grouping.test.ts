/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The portfolio's two levels of banding, as decisions.
 *
 * jsdom has no layout engine, so nothing here measures an indent or proves a
 * header is legible. What it pins is the part that can be wrong without anybody
 * noticing: which band an item lands in, what order the bands come out in, and
 * that the two axis lists cannot collide.
 */
import { describe, expect, it } from "vitest";
import type { TPortfolioItem } from "@/plane-web/types/arribada";
import {
  INDENT_CAP_LEVELS,
  PORTFOLIO_GROUP_OPTIONS,
  PORTFOLIO_SUBGROUP_OPTIONS,
  buildSubgroups,
  isSubgroupRowId,
  subgroupOptionsFor,
  subgroupRowId,
} from "./grouping";

const item = (id: string, over: Partial<TPortfolioItem> = {}): TPortfolioItem => ({
  id,
  name: id,
  sequence_id: 1,
  start_date: null,
  target_date: null,
  state_id: null,
  parent_id: null,
  priority: "none",
  assignees: [],
  ...over,
});

const lookup = (items: TPortfolioItem[]) => {
  const map = new Map(items.map((i) => [i.id, i]));
  return (id: string) => map.get(id);
};

const NO_STATES = { getState: () => undefined };

describe("the two axis lists", () => {
  it("cannot collide, because a project and a work item carry different fields", () => {
    // The decision, pinned: the group axis is what a PROJECT has, the subgroup
    // axis is what a WORK ITEM has. "Group by priority" over project rows would
    // put every project in one band and look broken rather than empty.
    const group = new Set(PORTFOLIO_GROUP_OPTIONS.map((o) => o.value as string));
    const subgroup = new Set(PORTFOLIO_SUBGROUP_OPTIONS.map((o) => o.value as string));
    expect([...group].filter((v) => subgroup.has(v))).toEqual([]);
  });

  it("defaults to one row per project — the board as it already is", () => {
    expect(PORTFOLIO_GROUP_OPTIONS[0].value).toBe("project");
    expect(PORTFOLIO_SUBGROUP_OPTIONS[0].value).toBe("none");
  });

  it("offers the work-item timeline's own words, so Sprint means Sprint on both screens", () => {
    const labels = PORTFOLIO_SUBGROUP_OPTIONS.map((o) => o.label);
    expect(labels).toContain("Sprint");
    expect(labels).toContain("Module");
    expect(labels).toContain("Discipline");
    // Not "Cycle": the fork renamed it everywhere the reader can see, and the key
    // stays `cycle` only because that is Plane's field name and it is code.
    expect(labels).not.toContain("Cycle");
  });

  it("would refuse a subgroup equal to the group, if the lists ever overlapped", () => {
    // Today it filters nothing out. Kept so the rule is a line of code rather
    // than a comment somebody edits past.
    expect(subgroupOptionsFor("project")).toHaveLength(PORTFOLIO_SUBGROUP_OPTIONS.length);
  });
});

describe("subgroup row ids", () => {
  it("are scoped to the project, so one module is two bands under two projects", () => {
    const a = subgroupRowId("project-a", "module-1");
    const b = subgroupRowId("project-b", "module-1");
    expect(a).not.toBe(b);
    expect(isSubgroupRowId(a)).toBe(true);
    // A real id is a UUID, so neither prefix can ever collide with one.
    expect(isSubgroupRowId("d3b07384-d9a0-4c9b-8f3a-1c2e5b6a7d8f")).toBe(false);
  });
});

describe("buildSubgroups", () => {
  it("does nothing at all when there is no subgroup axis", () => {
    expect(buildSubgroups(["a"], lookup([item("a")]), "none", NO_STATES)).toEqual([]);
  });

  it("bands by sprint, and puts the items with none last", () => {
    const items = [
      item("a", { cycle: { id: "s2", name: "Sprint 2" } }),
      item("b"),
      item("c", { cycle: { id: "s1", name: "Sprint 1" } }),
    ];
    const bands = buildSubgroups(["a", "b", "c"], lookup(items), "cycle", NO_STATES);

    expect(bands.map((b) => b.label)).toEqual(["Sprint 1", "Sprint 2", "Not in a sprint"]);
    expect(bands[2].itemIds).toEqual(["b"]);
  });

  it("files a multi-valued item under one band only, by its lowest-named value", () => {
    // An item cannot be drawn on two rows: the same id twice gives it two bars,
    // and every dependency arrow looks a row up by id.
    const items = [
      item("a", {
        assignees: [
          { id: "u2", name: "Zoe", avatar: null },
          { id: "u1", name: "Ana", avatar: null },
        ],
      }),
    ];
    const bands = buildSubgroups(["a"], lookup(items), "assignee", NO_STATES);

    expect(bands).toHaveLength(1);
    expect(bands[0].label).toBe("Ana");
  });

  it("orders priority by urgency rather than alphabetically", () => {
    const items = [item("a", { priority: "low" }), item("b", { priority: "urgent" })];
    const bands = buildSubgroups(["a", "b"], lookup(items), "priority", NO_STATES);

    expect(bands.map((b) => b.label)).toEqual(["Urgent", "Low"]);
  });

  it("bands by discipline, which is a requirement rather than an assignment", () => {
    const items = [item("a", { disciplines: ["firmware", "electronics"] }), item("b")];
    const bands = buildSubgroups(["a", "b"], lookup(items), "discipline", NO_STATES);

    expect(bands.map((b) => b.label)).toEqual(["electronics", "No discipline"]);
  });

  it("keeps the order the items arrived in inside each band", () => {
    // That order is the portfolio's own (date, then sequence). Banding is not a
    // licence to overrule it.
    const items = [
      item("a", { module: { id: "m", name: "Hardware" } }),
      item("b", { module: { id: "m", name: "Hardware" } }),
      item("c", { module: { id: "m", name: "Hardware" } }),
    ];
    const bands = buildSubgroups(["c", "a", "b"], lookup(items), "module", NO_STATES);

    expect(bands[0].itemIds).toEqual(["c", "a", "b"]);
  });

  it("still gives a row to an item the store has not resolved", () => {
    // Otherwise it would vanish the moment subgrouping was switched on, which
    // reads as the board having lost work.
    const bands = buildSubgroups(["ghost"], () => undefined, "module", NO_STATES);

    expect(bands).toHaveLength(1);
    expect(bands[0].itemIds).toEqual(["ghost"]);
    expect(bands[0].label).toBe("No module");
  });

  it("reads a missing axis field as unset rather than crashing", () => {
    // The per-user timeline's payload does not carry cycle/module/disciplines,
    // and an older API has not been redeployed.
    const bands = buildSubgroups(["a"], lookup([item("a")]), "module", NO_STATES);
    expect(bands[0].label).toBe("No module");
  });
});

describe("the indent budget", () => {
  it("caps parent nesting, which is the only level that can grow without limit", () => {
    // Group and subgroup are one step each and fixed. Parent nesting is a chain
    // of arbitrary length, so it is the one that has to be capped — deepest
    // realistic row is 22px + 4 * 14px = 78px, against a 240px minimum sidebar.
    expect(INDENT_CAP_LEVELS).toBe(4);
    expect(22 + INDENT_CAP_LEVELS * 14).toBeLessThan(100);
  });
});
