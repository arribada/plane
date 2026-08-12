/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The complaint, as a test.
 *
 * "je fais un export portfolio, tout est fermé, ça exporte juste la timeline du
 * projet" — the export was a second pass over the project list that merely
 * resembled the board. It ignored the folder swimlanes, the sort, and every
 * project somebody had expanded, so the file and the screen described different
 * things and only one of them was in front of the person who pressed the button.
 *
 * The rows now come from `ganttBlockIds`, which is literally what the chart
 * draws. A collapsed project contributes its own summary row and no work items;
 * an expanded one brings its items with it; and the projects that contributed
 * none are NAMED in the file rather than left for the reader to notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPortfolioCsv, portfolioMeta, portfolioRows, type TPortfolioSource } from "./export";

const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  identifier: name.slice(0, 3).toUpperCase(),
  logo_props: null,
  archived: false,
  start_date: "2026-08-03",
  target_date: "2026-09-30",
  derived_start_date: "2026-08-03",
  derived_target_date: "2026-09-30",
  item_count: 4,
  scheduled_item_count: 4,
  undated_item_count: 0,
  completed_item_count: 1,
  baseline_target_date: null,
  ...extra,
});

const workItem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  sequence_id: Number(id.replace(/\D/g, "")),
  start_date: "2026-08-03",
  target_date: "2026-08-07",
  state_id: null,
  parent_id: null,
  priority: "high" as const,
  assignees: [{ id: "u1", name: "Ada", avatar: null }],
  ...extra,
});

/**
 * A board with a folder band, one EXPANDED project carrying two work items, and
 * one COLLAPSED project carrying none — the exact arrangement the complaint was
 * made about.
 */
const board = (overrides: Partial<TPortfolioSource> = {}): TPortfolioSource => {
  const projects: Record<string, ReturnType<typeof project>> = {
    p1: project("p1", "Marlin"),
    p2: project("p2", "Turtle", { target_date: "2026-09-01", derived_target_date: "2026-10-15" }),
  };
  const items: Record<string, ReturnType<typeof workItem>> = {
    i1: workItem("i1", "Bring-up", { cycle: { id: "c1", name: "Sprint 2" }, disciplines: ["Firmware"] }),
    i2: workItem("i2", "Soak test", { module: { id: "m1", name: "Payload" } }),
  };
  return {
    // Folder header, expanded project + its two items, then a collapsed project.
    ganttBlockIds: ["folder-f1", "p1", "i1", "i2", "p2"],
    sortedProjectIds: ["p1", "p2"],
    isFolderRow: (id) => id.startsWith("folder-"),
    isProjectRow: (id) => !!projects[id],
    getFolderRow: (id) => (id === "folder-f1" ? { name: "Tags", projectCount: 2, collapsed: false } : undefined),
    getProject: (id) => projects[id],
    getItem: (id) => items[id],
    getRowProjectId: (id) => (projects[id] ? id : "p1"),
    isCriticalIssue: (id) => id === "i2",
    colorBy: "priority",
    sortBy: "start_date",
    groupBy: "folder",
    subgroupBy: "none",
    groupByFolder: true,
    expandedProjectIds: new Set(["p1"]),
    priorityFilter: new Set(["high"]),
    assignedToMeOnly: false,
    focusFolderName: null,
    ...overrides,
  } as TPortfolioSource;
};

describe("the rows are the board's rows", () => {
  it("keeps a collapsed project as a summary row and brings no work items with it", () => {
    const { rows, collapsedProjects } = portfolioRows(board(), "view");

    expect(rows.map((r) => [r.kind, r.name])).toEqual([
      ["Project", "Marlin"],
      ["Work item", "Bring-up"],
      ["Work item", "Soak test"],
      ["Project", "Turtle"],
    ]);
    // Named, so the file can say whose work items are not in it.
    expect(collapsedProjects).toEqual(["Turtle"]);
  });

  it("carries the folder swimlane down onto every row under it", () => {
    const { rows } = portfolioRows(board(), "view");
    expect(rows.every((r) => r.folder === "Tags")).toBe(true);
  });

  it("keeps the board's order, not the order the API answered in", () => {
    const { rows } = portfolioRows(board({ ganttBlockIds: ["p2", "p1", "i1", "i2"] }), "view");
    expect(rows.map((r) => r.name)).toEqual(["Turtle", "Marlin", "Bring-up", "Soak test"]);
  });

  it("gives one row per project in scope when the reader asks for everything", () => {
    const { rows } = portfolioRows(board(), "all");
    expect(rows.map((r) => [r.kind, r.name])).toEqual([
      ["Project", "Marlin"],
      ["Project", "Turtle"],
    ]);
  });

  it("skips a band header inside a project — its value is already a column", () => {
    const source = board({
      ganttBlockIds: ["p1", "subgroup-sprint-2", "i1"],
      isSubgroupRow: (id) => id.startsWith("subgroup-"),
    });
    expect(portfolioRows(source, "view").rows.map((r) => r.name)).toEqual(["Marlin", "Bring-up"]);
  });

  it("says whether a project's dates were planned or inferred, and whether it is late", () => {
    const { rows } = portfolioRows(board(), "view");
    const [marlin, , , turtle] = rows;

    expect(marlin.datesFrom).toBe("planned");
    expect(marlin.slipping).toBe(false);
    // Turtle promised 1 September and its work runs to 15 October.
    expect(turtle.slipping).toBe(true);
  });

  it("falls back to the derived dates, and says they are derived", () => {
    const derived = board();
    const original = derived.getProject;
    derived.getProject = (id) => {
      const p = original(id);
      return p && id === "p1" ? { ...p, start_date: null, target_date: null } : p;
    };
    const { rows } = portfolioRows(derived, "view");
    expect(rows[0].datesFrom).toBe("derived from work items");
    expect(rows[0].start).toEqual(new Date("2026-08-03T00:00:00Z"));
  });

  it("carries the sprint, module and discipline the board bands by", () => {
    const { rows } = portfolioRows(board(), "view");
    expect(rows[1].sprint).toBe("Sprint 2");
    expect(rows[1].disciplines).toBe("Firmware");
    expect(rows[2].module).toBe("Payload");
    expect(rows[2].critical).toBe(true);
  });
});

describe("what the file says about the arrangement", () => {
  it("records the bands, the sort, the colour rule and the filters", () => {
    const meta = portfolioMeta(board(), "view", ["Turtle"]);

    expect(meta.groupBy).toBe("folder");
    expect(meta.sortBy).toBe("start_date");
    expect(meta.colorBy).toBe("priority");
    expect(meta.filters).toContain("priority in high (work items only)");
    expect(meta.collapsed).toBe(1);
  });

  it("names the collapsed projects as an omission, not as a footnote nobody reads", () => {
    const meta = portfolioMeta(board(), "view", ["Turtle"]);
    expect(meta.omissions?.join(" ")).toContain("1 collapsed project (Turtle)");
  });

  it("calls a row a row, because half of them are projects", () => {
    const meta = portfolioMeta(board(), "view", ["Turtle"]);
    expect(meta.rowNoun).toBe("row");
    expect(meta.collapsedNoun).toBe("project");
  });

  it("mentions the folder in focus, because it is why the board is a subset", () => {
    const meta = portfolioMeta(board({ focusFolderName: "Tags" }), "view", []);
    expect(meta.title).toBe("Portfolio — Tags");
    expect(meta.filters).toContain('folder "Tags"');
  });
});

describe("the CSV", () => {
  it("leads with provenance a parser skips and a spreadsheet shows", () => {
    const { rows, collapsedProjects } = portfolioRows(board(), "view");
    const csv = buildPortfolioCsv(rows, portfolioMeta(board(), "view", collapsedProjects));
    const lines = csv.split("\n");

    expect(lines[0].startsWith("# Portfolio")).toBe(true);
    const header = lines.find((line) => !line.startsWith("#")) ?? "";
    expect(header.startsWith("Folder,Row,Project,Key,Name,Owners,Discipline,Sprint,Module")).toBe(true);
    expect(csv).toContain("1 collapsed project (Turtle)");
  });

  it("neutralises a project name that would otherwise execute", () => {
    const hostile = board();
    const original = hostile.getProject;
    hostile.getProject = (id) => {
      const p = original(id);
      return p && id === "p1" ? { ...p, name: '=HYPERLINK("http://evil.test")' } : p;
    };
    const { rows } = portfolioRows(hostile, "view");
    expect(buildPortfolioCsv(rows, portfolioMeta(hostile, "view", []))).toContain("'=HYPERLINK");
  });

  it("counts working days, not calendar days", () => {
    const { rows } = portfolioRows(board(), "view");
    const csv = buildPortfolioCsv(rows, portfolioMeta(board(), "view", []));
    // Bring-up runs Mon 3 to Fri 7 August: five working days.
    const row = csv.split("\n").find((line) => line.includes("Bring-up")) ?? "";
    expect(row.split(",")).toContain("5");
  });
});

/* ------------------------------------------------------- the reader's day --- */

const WEST = "America/Los_Angeles"; // UTC-7/-8
const EAST = "Pacific/Auckland"; // UTC+12/+13

/**
 * Run a body in a named timezone. A copy of the one in
 * gantt-chart/export.test.ts rather than a shared import: importing a test file
 * from another test file registers its cases in both, and doubling a suite to
 * save eight lines is a bad trade.
 */
const inZone = <T>(zone: string, body: () => T): T => {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return body();
  } finally {
    // `= undefined` would write the STRING "undefined" and leave the rest of the
    // run in UTC — the one offset where none of this reproduces.
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};

/** The CSV row for a named item, split into columns. Nothing on this board holds
 *  a comma, so the split lines up with PORTFOLIO_COLUMNS. */
const columnsFor = (name: string): string[] => {
  const { rows } = portfolioRows(board(), "view");
  const csv = buildPortfolioCsv(rows, portfolioMeta(board(), "view", []));
  return (csv.split("\n").find((line) => line.includes(name)) ?? "").split(",");
};

describe("a plan date is a plain day, not an instant", () => {
  it("counts a Mon–Fri work item as five working days wherever the reader is", () => {
    // Bring-up runs Monday 3 to Friday 7 August. The count comes from the gantt
    // exporter's `workingDays`, which used to read the LOCAL weekday of a
    // UTC-anchored date: west of Greenwich the week read as Sunday to Thursday
    // and this column said 4. The test above only ever proved it in whichever
    // zone the runner happened to be in.
    const workingDaysColumn = () => columnsFor("Bring-up")[12];
    expect(inZone(WEST, workingDaysColumn)).toBe("5");
    expect(inZone(EAST, workingDaysColumn)).toBe("5");
  });

  it("prints a stored plan date as the day it was stored, in every zone", () => {
    // The guard on the OTHER half of the rule. `iso()` in export.ts reads a
    // UTC-midnight plan date back as UTC on purpose, and anybody who "fixes" it
    // into a local-day helper moves every printed date off the bar it belongs to
    // — for the whole hemisphere, silently, in a column a funder reconciles.
    const startColumn = () => columnsFor("Bring-up")[10];
    expect(inZone(WEST, startColumn)).toBe("2026-08-03");
    expect(inZone(EAST, startColumn)).toBe("2026-08-03");
  });
});

describe("the stamp on a portfolio file", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the day the reader made it, not Greenwich's", () => {
    const stamp = (zone: string) => {
      const { rows } = portfolioRows(board(), "view");
      return inZone(zone, () => buildPortfolioCsv(rows, portfolioMeta(board(), "view", [])));
    };
    // Eight in the morning on the 13th in Auckland, and the file used to be
    // stamped — and named — for the 12th.
    vi.setSystemTime(new Date("2026-08-12T20:00:00Z"));
    expect(stamp(EAST)).toContain("# Exported 2026-08-13.");
    // Ten in the evening on the 12th in California, stamped the 13th.
    vi.setSystemTime(new Date("2026-08-13T05:00:00Z"));
    expect(stamp(WEST)).toContain("# Exported 2026-08-12.");
  });
});
