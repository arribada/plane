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
    for (const absent of ["Finished", "Cancelled", "Critical path", "Deliverable", "Baseline"])
      expect(plain).not.toContain(absent);
  });

  it("keys a mark as soon as one bar wears it", () => {
    expect(draw([row({ done: true })])).toContain("Finished");
    expect(draw([row({ cancelled: true })])).toContain("Cancelled");
    expect(draw([row({ critical: true })])).toContain("Critical path");
    expect(draw([row({ milestone: true })])).toContain("Deliverable");
  });

  it("does not key Finished over a picture whose only closed bar was cancelled", () => {
    // The two used to be one flag, so a plan whose only closed work had been
    // ABANDONED came out of here keyed "Finished".
    const svg = draw([row({ cancelled: true })]);
    expect(svg).toContain("Cancelled");
    expect(svg).not.toContain("Finished");
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

  it("draws a cancelled bar hollow and struck, and marks its label ✕ rather than ✓", () => {
    // The file leaving the building is the copy a funder reads. A ✓ on abandoned
    // work says it was achieved, and a full-strength bar says it was planned and
    // is still there — which is why the fill goes and the outline stays.
    const svg = draw([row({ cancelled: true, color: "#781e98" })]);
    expect(svg).toContain("✕ STT-1");
    expect(svg).not.toContain("✓ STT-1");
    expect(svg).toContain('fill="none" stroke="#781e98" stroke-width="2"');
    expect(svg).toContain('text-decoration="line-through"');
    // No hatch and no filled bar: the two treatments must not stack.
    expect(svg).not.toContain('fill="url(#done)"');
    expect(svg).not.toContain('fill="#781e98" opacity="0.92"');
  });

  it("does not put a progress shade back inside a cancelled bar", () => {
    // The point of taking the fill away is that abandoned work stops claiming
    // area, and a progress shade is area.
    const svg = draw([row({ cancelled: true, progress: 60 })]);
    expect(svg).not.toContain('fill="#000000" opacity="0.22"');
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

/** The one `<path>` in the file that is a dependency arrow, by its two colours. */
const arrowPath = (svg: string): string =>
  /<path d="([^"]+)" fill="none" stroke="#(?:dc2626|94a3b8)"/.exec(svg)?.[1] ?? "";

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

  /**
   * The exporter was the SECOND renderer of the arrow defect, and the one the
   * on-screen fix was reported to have covered while never touching it. Its own
   * arithmetic was
   *
   *   stop = x2 - 4;  mid = max(min(x1 + 6, stop), stop - 12)
   *
   * which at a zero gap gives `mid = stop = x1 - 4`: a four-pixel horizontal
   * BACKWARDS, a square corner, and a final `H` of zero length so the arrowhead
   * pointed at the floor. The final horizontal was zero for any gap under 22px.
   *
   * It calls the shared router now, so these assert the two properties that
   * matter rather than the shape of one particular formula — which is the trap
   * the previous version of this test fell into.
   */
  const gapCases = [0, 1, 2, 3, 5];

  const drawWithGap = (gap: number): string => {
    const start = new Date(day("2026-03-06").getTime() + gap * 86_400_000);
    const rows = [row({ id: "a" }), row({ id: "b", start, end: new Date(start.getTime() + 3 * 86_400_000) })];
    return draw(rows, [{ from: "a", to: "b" }]);
  };

  it.each(gapCases)("never travels backwards over itself at a %i-day gap", (gap) => {
    const tokens = arrowPath(drawWithGap(gap)).trim().split(/\s+/);
    expect(tokens.length).toBeGreaterThan(2);
    // Horizontal runs only; the router's arcs never reverse a heading.
    let cursorX: number | null = null;
    const moves: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === "M") {
        cursorX = Number(tokens[i + 1]);
        i += 2;
      } else if (tokens[i] === "H" && cursorX !== null) {
        const next = Number(tokens[i + 1]);
        if (Math.abs(next - cursorX) > 0.001) moves.push(next - cursorX);
        cursorX = next;
        i += 1;
      } else if (tokens[i] === "a" && cursorX !== null) {
        cursorX += Number(tokens[i + 6]);
        i += 7;
      }
    }
    // Forward-only, or forward/back/forward through the band — never a forward
    // run followed by a backward one AT THE SAME HEIGHT, which is the doubling
    // back that was reported.
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0]).toBeGreaterThan(0);
    expect(moves[moves.length - 1]).toBeGreaterThan(0);
  });

  it.each(gapCases)("ends on a horizontal long enough to carry the head at a %i-day gap", (gap) => {
    const tokens = arrowPath(drawWithGap(gap)).trim().split(/\s+/);
    // `orient="auto"` takes its bearing from the last segment; a zero-length one
    // aims the head down the vertical before it.
    expect(tokens.at(-2)).toBe("H");
    const stop = Number(tokens.at(-1));
    // Whatever came before the final H, the run into the bar is a real run.
    const beforeIndex = tokens.length - 2;
    let cursorX = 0;
    for (let i = 0; i < beforeIndex; i++) {
      if (tokens[i] === "M") cursorX = Number(tokens[i + 1]);
      else if (tokens[i] === "H") cursorX = Number(tokens[i + 1]);
      else if (tokens[i] === "a") cursorX += Number(tokens[i + 6]);
    }
    expect(Math.abs(stop - cursorX)).toBeGreaterThanOrEqual(6);
  });

  it("puts the arrowhead in user space, so a critical head is not 40% bigger", () => {
    // `markerUnits="strokeWidth"` multiplies the head's box by the line's width,
    // so the same marker drew at two sizes for two severities of the same thing.
    const svg = draw(pair, [{ from: "a", to: "b" }]);
    expect(svg).not.toContain('markerUnits="strokeWidth"');
    expect(svg).toContain('markerUnits="userSpaceOnUse"');
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
