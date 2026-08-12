/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What the drawn export actually carries.
 *
 * jsdom has no layout engine and no SVG renderer, so nothing here looks at a
 * picture. It reads the markup instead, and asserts the presence of the things
 * whose ABSENCE was the reported defect: an export that "silently omits what the
 * user is looking at". Whether the result is well laid out — whether a long
 * filter list collides with the first bar, whether a legend wraps handsomely —
 * still needs a browser.
 *
 * Each assertion below names a thing that was on screen and not in the file.
 */
import { describe, expect, it } from "vitest";
import { buildGanttSvg, svgCaptions, type TExportMeta, type TExportRow } from "./export";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const row = (over: Partial<TExportRow> = {}): TExportRow => ({
  id: "a",
  kind: "item",
  label: "Bench test the saltwater switch",
  identifier: "STT-1",
  start: day("2026-03-02"),
  end: day("2026-03-06"),
  ...over,
});

const META: TExportMeta = { title: "Sea Turtle Tracker", scope: "view" };
const TODAY = day("2026-03-04");

/** Render with a fixed today so nothing here is dated. */
const draw = (rows: TExportRow[], edges: Parameters<typeof buildGanttSvg>[1] = [], options = {}) =>
  buildGanttSvg(rows, edges, { title: "Sea Turtle Tracker", meta: META, today: TODAY, ...options }) ?? "";

describe("the picture refuses to be empty", () => {
  it("returns null when nothing is dated, rather than a blank calendar", () => {
    expect(buildGanttSvg([row({ start: null, end: null })], [], { title: "T" })).toBeNull();
  });

  it("still draws when only the two-argument call is used", () => {
    // The older call site must keep producing a picture rather than throwing.
    expect(buildGanttSvg([row()], [], { title: "T" })).toContain("<svg");
  });
});

describe("today", () => {
  // THE single most useful mark on an exported plan, and the one it did not
  // have: without it a bar ending last Tuesday and one ending next Tuesday are
  // the same picture.
  it("is drawn, dated, when it falls inside the range", () => {
    const svg = draw([row()]);
    expect(svg).toContain("Today 2026-03-04");
    expect(svg).toMatch(/stroke-dasharray="4 3"/);
  });

  it("is NOT drawn when the plan is entirely in another year", () => {
    // A dashed line pinned to the edge of a chart about next year reads as a
    // deadline.
    const svg = draw([row({ start: day("2029-01-01"), end: day("2029-02-01") })]);
    expect(svg).not.toContain("Today ");
  });
});

describe("the colour rule, and the legend that decodes it", () => {
  it("names what the chart was coloured by", () => {
    const svg = draw([row()], [], {
      meta: { ...META, colorBy: "Assignee", groupBy: "Sprint", sortBy: "manual order" },
    });
    expect(svg).toContain("coloured by Assignee");
    expect(svg).toContain("grouped by Sprint");
    expect(svg).toContain("ordered by manual order");
  });

  it("draws a legend row per series, with its count", () => {
    const svg = draw([row()], [], {
      legend: [
        { label: "Ruby", color: "#386be2", count: 7 },
        { label: "Grant", color: "#6da122", count: 3 },
      ],
    });
    expect(svg).toContain("Ruby (7)");
    expect(svg).toContain("Grant (3)");
    expect(svg).toContain("#386be2");
  });

  it("draws NO series swatches for a single series — the title says what it is", () => {
    const svg = draw([row()], [], { legend: [{ label: "Everything", color: "#386be2", count: 9 }] });
    expect(svg).not.toContain("Everything");
  });

  it("keys only the marks the picture actually contains", () => {
    // A legend is a promise about the picture beside it. A "Critical path" key
    // over a plan with no chain sends the reader hunting for something that is
    // not there, and quietly undermines the entries that ARE true.
    const plain = draw([row()]);
    expect(plain).toContain("Today"); // today IS inside this range
    for (const absent of ["Finished", "Critical path", "Deliverable", "Baseline"]) expect(plain).not.toContain(absent);
  });

  it("keys a mark as soon as one bar wears it", () => {
    expect(draw([row({ done: true })])).toContain("Finished");
    expect(draw([row({ critical: true })])).toContain("Critical path");
    expect(draw([row({ milestone: true })])).toContain("Deliverable");
  });
});

describe("what the bars are wearing", () => {
  it("hatches a finished bar rather than fading it, and ticks its label", () => {
    // Fading is the obvious move and is wrong twice over — see palette.ts.
    const svg = draw([row({ done: true })]);
    expect(svg).toContain('fill="url(#done)"');
    expect(svg).toContain("✓ STT-1");
  });

  it("leaves an unfinished bar unhatched", () => {
    // Nothing done means no hatch anywhere — not on a bar, and not in the
    // legend either, because the legend only keys what was drawn. One done row
    // produces exactly two: the bar and its legend swatch.
    // kept beside its only caller; at module scope it would be a lone assertion helper 100 lines away.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const hatches = (svg: string) => svg.split('fill="url(#done)"').length - 1;
    expect(hatches(draw([row()]))).toBe(0);
    expect(hatches(draw([row({ done: true })]))).toBe(2);
  });

  it("paints the bar the colour the row was carrying, not a fixed blue", () => {
    // The whole reported defect: Export from a chart coloured by assignee used
    // to hand back a chart coloured by state.
    expect(draw([row({ color: "#781e98" })])).toContain('fill="#781e98"');
  });

  it("draws a marked deliverable as a diamond, not a 3px sliver", () => {
    const svg = draw([row({ milestone: true, start: day("2026-03-04"), end: day("2026-03-04") })]);
    // A diamond is a path with four corners; a bar is a rect.
    expect(svg).toMatch(/<path d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ Z"/);
  });

  it("draws the part-done fill the screen writes inside the bar", () => {
    expect(draw([row({ progress: 40 })])).toContain('opacity="0.22"');
  });

  it("rings the critical chain in red", () => {
    expect(draw([row({ critical: true })])).toContain('stroke="#dc2626"');
  });
});

describe("the baseline", () => {
  it("draws a hollow dashed ghost when one was on screen", () => {
    const svg = draw([row({ baselineStart: day("2026-03-02"), baselineEnd: day("2026-03-04") })]);
    expect(svg).toMatch(/fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3 2"/);
  });

  it("names WHICH frozen plan, because a project has several", () => {
    const svg = draw([row({ baselineStart: day("2026-03-02"), baselineEnd: day("2026-03-04") })], [], {
      meta: { ...META, baselineName: "PDR January 2026" },
    });
    expect(svg).toContain("Compared against the baseline “PDR January 2026”");
    expect(svg).toContain("Baseline “PDR January 2026”");
  });

  it("says nothing about a baseline when none was shown", () => {
    expect(draw([row()])).not.toContain("Compared against");
  });

  it("widens the range so a ghost outside the live plan is not clipped off", () => {
    // The ghost that ran past the plan is the one worth seeing — that IS the
    // comparison.
    const svg = draw([row({ baselineEnd: day("2026-09-01"), baselineStart: day("2026-03-02") })]);
    expect(svg).toContain("2026-09");
  });
});

describe("dependency arrows", () => {
  const pair = [row({ id: "a" }), row({ id: "b", start: day("2026-03-09"), end: day("2026-03-12") })];

  it("carries an arrowhead, so the line has a direction", () => {
    const svg = draw(pair, [{ from: "a", to: "b" }]);
    expect(svg).toContain("<marker");
    expect(svg).toContain('marker-end="url(#ah)"');
  });

  it("uses the red head on the critical chain", () => {
    expect(draw(pair, [{ from: "a", to: "b", critical: true }])).toContain('marker-end="url(#ahc)"');
  });

  it("never turns its middle segment backwards at a short gap", () => {
    // The same failure the on-screen router had: `x2 - 12` sits LEFT of where
    // the arrow had got to when the two bars nearly touch, and the line draws a
    // little Z in the seam.
    for (const gap of [0, 1, 2, 3]) {
      const start = new Date(day("2026-03-06").getTime() + gap * 86_400_000);
      const rows = [row({ id: "a" }), row({ id: "b", start, end: new Date(start.getTime() + 3 * 86_400_000) })];
      const svg = draw(rows, [{ from: "a", to: "b" }]);
      const path = /<path d="M ([\d.]+) [\d.]+ H ([\d.]+)(?: V [\d.]+ H ([\d.]+))?"/.exec(svg);
      expect(path).not.toBeNull();
      const [x1, mid, stop] = [Number(path![1]), Number(path![2]), Number(path![3] ?? path![2])];
      expect(mid).toBeGreaterThanOrEqual(Math.min(x1, stop) - 12.01);
      expect(stop).toBeGreaterThanOrEqual(mid);
    }
  });

  it("ends on a horizontal, so the head takes its bearing from the run into the bar", () => {
    const svg = draw(pair, [{ from: "a", to: "b" }]);
    const path = /<path d="([^"]+)" fill="none"/.exec(svg)?.[1] ?? "";
    expect(path.trim().split(" ").at(-2)).toBe("H");
  });
});

describe("provenance — what a recipient needs and had to guess", () => {
  it("stamps when it was generated and where from", () => {
    expect(draw([row()])).toContain("Generated 2026-03-04 from Arribada Plane");
  });

  it("says how much was folded away rather than looking complete", () => {
    const svg = draw([row()], [], { meta: { ...META, collapsed: 3 } });
    expect(svg).toContain("3 folded groups are not drawn below");
  });

  it("names the filters in force", () => {
    const svg = draw([row()], [], { meta: { ...META, filters: ["priority is urgent, high"] } });
    expect(svg).toContain("priority is urgent, high");
  });

  it("names what is NOT in the picture", () => {
    const svg = draw([row()], [], { meta: { ...META, omissions: ["recorded effort in days"] } });
    expect(svg).toContain("recorded effort in days");
  });

  it("is a document, not only a picture — it has a title and a description", () => {
    const svg = draw([row()]);
    expect(svg).toContain("<title>Sea Turtle Tracker — timeline</title>");
    expect(svg).toContain("<desc>");
  });

  it("escapes a project name that contains markup", () => {
    // Work item names arrive from GitHub issue titles through the triage
    // importer; nothing between a stranger typing one and this renderer
    // validates it.
    const svg = draw([row({ label: '<script>alert("x")</script>' })]);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("the caption block", () => {
  it("counts work items, not band headers", () => {
    const lines = svgCaptions(META, 5, 3);
    expect(lines[0]).toContain("3 work items");
  });

  it("says so when the reader asked for everything rather than the view", () => {
    expect(svgCaptions({ ...META, scope: "all" }, 3, 3)[0]).toContain("ignoring what was folded");
  });

  it("reconciles the two counts rather than letting them contradict", () => {
    // A caption saying 3 over a picture of 5 rows is worse than no caption.
    expect(svgCaptions(META, 5, 3).some((line) => line.includes("5 rows drawn"))).toBe(true);
  });
});
