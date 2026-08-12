/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which colour a portfolio row gets, and when a row is finished.
 *
 * jsdom has no layout engine and no paint, so nothing here looks at a picture.
 * It tests the DECISIONS — which value a row has on the axis, which rows are on
 * no axis at all, and which are done — because those are where a colour feature
 * actually goes wrong. Whether the result is handsome still needs a browser.
 */
import { describe, expect, it } from "vitest";
import { SERIES_LIGHT, unsetColor } from "@/plane-web/components/gantt-chart/palette";
import type { TPortfolioItem, TPortfolioProject } from "@/plane-web/types/arribada";
import {
  isItemDone,
  isProjectDone,
  isSeriesDimension,
  PORTFOLIO_COLOR_OPTIONS,
  PORTFOLIO_SUMMARY_COLOR,
  portfolioItemSample,
  portfolioRowColor,
} from "./color";
import { buildPortfolioColorScale } from "./use-portfolio-color";

const item = (over: Partial<TPortfolioItem> = {}): TPortfolioItem => ({
  id: "i1",
  name: "Bench test the saltwater switch",
  sequence_id: 1,
  start_date: "2026-01-01",
  target_date: "2026-01-05",
  state_id: null,
  parent_id: null,
  priority: "none",
  assignees: [],
  ...over,
});

const project = (over: Partial<TPortfolioProject> = {}): TPortfolioProject => ({
  id: "p1",
  name: "Sea Turtle Tracker",
  identifier: "STT",
  logo_props: null,
  archived: false,
  start_date: "2026-01-01",
  target_date: "2026-06-01",
  derived_start_date: "2026-01-01",
  derived_target_date: "2026-06-01",
  item_count: 10,
  scheduled_item_count: 10,
  undated_item_count: 0,
  completed_item_count: 0,
  baseline_target_date: null,
  ...over,
});

describe("the axes on offer", () => {
  it("spells Plane's Cycle as Sprint, like every other control in this fork", () => {
    expect(PORTFOLIO_COLOR_OPTIONS.find((o) => o.value === "cycle")?.label).toBe("Sprint");
  });

  it("offers the work-item timeline's axes, not a second vocabulary", () => {
    const values = PORTFOLIO_COLOR_OPTIONS.map((o) => o.value);
    for (const axis of ["state", "priority", "assignee", "cycle", "module", "discipline"])
      expect(values).toContain(axis);
  });

  it("treats project as identity and everything else as a series", () => {
    // The one dimension that keeps a generated hue, because every row is
    // directly labelled with its own project name — see the note in color.ts.
    expect(isSeriesDimension("project")).toBe(false);
    for (const axis of ["state", "priority", "assignee", "cycle", "module", "discipline"] as const)
      expect(isSeriesDimension(axis)).toBe(true);
  });
});

describe("which value a work item has on the axis", () => {
  it("files a multi-assignee item under its lowest-named owner, so it is on one row", () => {
    const sample = portfolioItemSample(
      "assignee",
      item({
        assignees: [
          { id: "z", name: "Zoe", avatar: null },
          { id: "a", name: "Ann", avatar: null },
        ],
      })
    );
    expect(sample.key).toBe("a");
    expect(sample.label).toBe("Ann");
  });

  it("answers null — not a made-up bucket — when the item is on no sprint", () => {
    expect(portfolioItemSample("cycle", item()).key).toBeNull();
    expect(portfolioItemSample("module", item()).key).toBeNull();
    expect(portfolioItemSample("discipline", item()).key).toBeNull();
  });

  it("passes a state's own colour through rather than repainting it", () => {
    // A state is one colour on the board column, on the badge and here. Two
    // colours on two screens is worse than an unvalidatable hue already learnt.
    const sample = portfolioItemSample("state", item({ state_id: "s1" }), {
      getState: () => ({ name: "In progress", color: "#123456", group: "started" }),
    });
    expect(sample).toMatchObject({ key: "s1", label: "In progress", color: "#123456" });
  });

  it("treats `none` priority as a named band, not as the unset bucket", () => {
    // Plane writes `none` rather than leaving it null, so "None" has a name.
    expect(portfolioItemSample("priority", item({ priority: "none" }))).toMatchObject({ key: "none", label: "None" });
  });
});

describe("a project row on an axis projects are not on", () => {
  // a stub scale for this describe block; at module scope it would look like a shared fixture.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const scale = () => "#ff0000";

  it("takes the neutral, not the unassigned bucket", () => {
    // "Nobody owns these twelve projects" is not a fact about the work, and
    // filing them under Unassigned would state it.
    for (const axis of ["assignee", "cycle", "module", "discipline", "state", "priority"] as const) {
      const color = portfolioRowColor(axis, { isProject: true, projectId: "p1", item: undefined }, scale);
      expect(color).toBe(PORTFOLIO_SUMMARY_COLOR);
    }
  });

  it("never takes one of the six validated hues, so it cannot read as a series", () => {
    const color = portfolioRowColor("assignee", { isProject: true, projectId: "p1", item: undefined }, scale);
    expect(SERIES_LIGHT).not.toContain(color);
  });

  it("takes its own hue when the axis IS project", () => {
    const color = portfolioRowColor("project", { isProject: true, projectId: "p1", item: undefined }, scale);
    expect(color).not.toBe(PORTFOLIO_SUMMARY_COLOR);
    // Same project, same colour, every time — colour follows the entity.
    expect(portfolioRowColor("project", { isProject: true, projectId: "p1", item: undefined }, scale)).toBe(color);
  });

  it("takes no part in the scale, so it cannot consume a palette slot", () => {
    // Only the items are sampled; a board of one item and forty projects still
    // gives that item slot one.
    const built = buildPortfolioColorScale(
      { loadedItems: [item({ id: "i1", cycle: { id: "c1", name: "Sprint 1" } })], colorBy: "cycle" },
      {},
      false
    );
    expect(built?.colorOf("c1")).toBe(SERIES_LIGHT[0]);
  });
});

describe("the scale over the board's items", () => {
  const withSprint = (id: string, sprint: string | null) =>
    item({ id, cycle: sprint ? { id: sprint, name: sprint.toUpperCase() } : null });

  it("is null on an identity axis — there is no series to build", () => {
    expect(buildPortfolioColorScale({ loadedItems: [item()], colorBy: "project" }, {}, false)).toBeNull();
  });

  it("names the unset bucket in the board's own words", () => {
    const built = buildPortfolioColorScale({ loadedItems: [withSprint("a", null)], colorBy: "cycle" }, {}, false);
    expect(built?.entries.find((e) => e.unset)?.label).toBe("Not in a sprint");
    expect(built?.colorOf(null)).toBe(unsetColor(false));
  });

  it("does not repaint a survivor when the board is filtered", () => {
    // The scale's domain is every LOADED item, so narrowing what is drawn
    // cannot move a colour. Colour follows the entity, never its rank.
    const everyone = [withSprint("a", "c1"), withSprint("b", "c1"), withSprint("c", "c2"), withSprint("d", "c3")];
    const before = buildPortfolioColorScale({ loadedItems: everyone, colorBy: "cycle" }, {}, false);
    const after = buildPortfolioColorScale({ loadedItems: everyone, colorBy: "cycle" }, {}, false);
    expect(after?.colorOf("c2")).toBe(before?.colorOf("c2"));
  });

  it("puts urgent above medium even though medium is the more common", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => item({ id: `m${i}`, priority: "medium" })),
      item({ id: "u", priority: "urgent" }),
    ];
    const built = buildPortfolioColorScale({ loadedItems: rows, colorBy: "priority" }, {}, false);
    expect(built?.entries.map((e) => e.key)).toEqual(["urgent", "medium"]);
  });

  it("folds a seventh sprint instead of inventing a hue for it", () => {
    const rows = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].flatMap((c, index) =>
      Array.from({ length: 8 - index }, (_, n) => withSprint(`${c}-${n}`, c))
    );
    const built = buildPortfolioColorScale({ loadedItems: rows, colorBy: "cycle" }, {}, false);
    expect(built?.entries).toHaveLength(6);
    expect(built?.entries.at(-1)?.key).toBe("__other__");
    for (const entry of built?.entries ?? []) expect(SERIES_LIGHT).toContain(entry.color);
  });
});

describe("what counts as finished", () => {
  it("reads the state GROUP, so a team may call its done column anything", () => {
    const done = isItemDone(item({ state_id: "s" }), { getState: () => ({ name: "Shipped ✨", group: "completed" }) });
    expect(done).toBe(true);
  });

  it("counts cancelled as finished — the question is what is still ahead", () => {
    expect(isItemDone(item({ state_id: "s" }), { getState: () => ({ name: "Dropped", group: "cancelled" }) })).toBe(
      true
    );
  });

  it("does not call an in-progress item done", () => {
    expect(isItemDone(item({ state_id: "s" }), { getState: () => ({ name: "In progress", group: "started" }) })).toBe(
      false
    );
    expect(isItemDone(item())).toBe(false);
  });

  it("calls a project done only when every one of its items is", () => {
    expect(isProjectDone(project({ item_count: 10, completed_item_count: 10 }))).toBe(true);
    expect(isProjectDone(project({ item_count: 10, completed_item_count: 9 }))).toBe(false);
  });

  it("does not call an EMPTY project done — nothing has happened to it", () => {
    // `0 >= 0` would otherwise hatch every project nobody has filled in yet.
    expect(isProjectDone(project({ item_count: 0, completed_item_count: 0 }))).toBe(false);
    expect(isProjectDone(undefined)).toBe(false);
  });
});
