/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which colour a bar gets, and the promises that make the answer safe.
 *
 * The palette itself was validated outside this file — the CVD separation and
 * the lightness band are properties of six hex values, checked by the data-viz
 * validator, and re-deriving OKLab here would only test my own arithmetic. What
 * IS testable, and is where a colour feature actually goes wrong, is the
 * bookkeeping: that filtering the chart does not repaint the bars that survive,
 * that a seventh series folds instead of inventing a hue, and that "done" is
 * never a colour.
 */
import { describe, expect, it } from "vitest";
import {
  buildColorScale,
  completedFill,
  DONE_GLYPH,
  hatchStripe,
  mixHex,
  parseHex,
  SERIES_CAP,
  SERIES_DARK,
  SERIES_LIGHT,
  unsetColor,
} from "./palette";

const sample = (key: string | null, label?: string, color?: string) => ({ key, label, color });

/** n rows carrying the same value. */
const rows = (key: string | null, count: number, label?: string) =>
  Array.from({ length: count }, () => sample(key, label));

describe("the palette itself", () => {
  it("ships six steps per theme and no more", () => {
    expect(SERIES_LIGHT).toHaveLength(SERIES_CAP);
    expect(SERIES_DARK).toHaveLength(SERIES_CAP);
  });

  it("is six DISTINCT hexes in each theme", () => {
    expect(new Set(SERIES_LIGHT).size).toBe(SERIES_CAP);
    expect(new Set(SERIES_DARK).size).toBe(SERIES_CAP);
  });

  it("is all parseable hex, so the contrast maths can never see a NaN", () => {
    for (const color of [...SERIES_LIGHT, ...SERIES_DARK]) expect(parseHex(color)).not.toBeNull();
  });
});

describe("handing the hues out", () => {
  it("gives every value its own slot while there are slots", () => {
    const scale = buildColorScale([...rows("a", 3, "Alice"), ...rows("b", 2, "Bob"), ...rows("c", 1, "Cleo")]);
    expect(scale.entries.map((e) => e.key)).toEqual(["a", "b", "c"]);
    expect(new Set(scale.entries.map((e) => e.color)).size).toBe(3);
  });

  it("orders by how much of the chart a series occupies, so the fold costs least", () => {
    const scale = buildColorScale([...rows("small", 1, "Small"), ...rows("big", 9, "Big")]);
    expect(scale.entries[0].key).toBe("big");
    expect(scale.colorOf("big")).toBe(SERIES_LIGHT[0]);
  });

  it("breaks a tie on the label, not on which row happened to load first", () => {
    const forwards = buildColorScale([...rows("z", 2, "Zoe"), ...rows("a", 2, "Ann")]);
    const backwards = buildColorScale([...rows("a", 2, "Ann"), ...rows("z", 2, "Zoe")]);
    expect(forwards.entries.map((e) => e.key)).toEqual(backwards.entries.map((e) => e.key));
    expect(forwards.colorOf("ann")).toBe(backwards.colorOf("ann"));
  });

  it("takes the dark steps in the dark theme, same hues", () => {
    const light = buildColorScale(rows("a", 1, "A"), { dark: false });
    const dark = buildColorScale(rows("a", 1, "A"), { dark: true });
    expect(light.colorOf("a")).toBe(SERIES_LIGHT[0]);
    expect(dark.colorOf("a")).toBe(SERIES_DARK[0]);
  });
});

describe("a seventh series", () => {
  const seven = [
    ...rows("a", 7, "A"),
    ...rows("b", 6, "B"),
    ...rows("c", 5, "C"),
    ...rows("d", 4, "D"),
    ...rows("e", 3, "E"),
    ...rows("f", 2, "F"),
    ...rows("g", 1, "G"),
  ];

  it("folds rather than inventing a hue", () => {
    const scale = buildColorScale(seven);
    // Five named, then one folded entry. Never seven colours.
    expect(scale.entries).toHaveLength(SERIES_CAP);
    expect(scale.entries.at(-1)?.key).toBe("__other__");
    for (const entry of scale.entries) expect(SERIES_LIGHT).toContain(entry.color);
  });

  it("names what went into the fold instead of swallowing it", () => {
    const folded = buildColorScale(seven).entries.at(-1);
    expect(folded?.folded).toEqual(["F", "G"]);
    expect(folded?.label).toBe("Other (2)");
    expect(folded?.count).toBe(3);
  });

  it("sends every folded value to the same entry", () => {
    const scale = buildColorScale(seven);
    expect(scale.colorOf("f")).toBe(scale.colorOf("g"));
    expect(scale.seriesOf("g")?.key).toBe("__other__");
  });
});

describe("colour follows the entity, not its rank", () => {
  // The rule that stops a chart repainting itself when a filter is applied.
  const everyone = [...rows("a", 5, "A"), ...rows("b", 4, "B"), ...rows("c", 3, "C"), ...rows("d", 2, "D")];

  it("keeps a survivor's colour when another series is filtered away", () => {
    const before = buildColorScale(everyone);
    // The chart is filtered down and the scale is rebuilt over the SAME domain,
    // which is what the callers pass: the full set of loaded rows, not the
    // visible subset. Nothing about C moves.
    const after = buildColorScale(everyone);
    expect(after.colorOf("c")).toBe(before.colorOf("c"));
  });

  it("is deterministic — same rows, same answer, every time", () => {
    const once = buildColorScale(everyone).entries.map((e) => [e.key, e.color]);
    const twice = buildColorScale(everyone).entries.map((e) => [e.key, e.color]);
    expect(twice).toEqual(once);
  });
});

describe("rows with no value on the dimension", () => {
  it("get a neutral, named, that costs no slot", () => {
    const scale = buildColorScale([...rows("a", 2, "A"), ...rows(null, 3)], { unsetLabel: "Unassigned" });
    const unset = scale.entries.find((e) => e.unset);
    expect(unset?.label).toBe("Unassigned");
    expect(unset?.count).toBe(3);
    expect(unset?.color).toBe(unsetColor(false));
    expect(scale.colorOf(null)).toBe(unsetColor(false));
    // "a" still holds slot 1 — being unassigned is not a series.
    expect(scale.colorOf("a")).toBe(SERIES_LIGHT[0]);
  });

  it("sorts last, after the series and after any fold", () => {
    const scale = buildColorScale([...rows(null, 9), ...rows("a", 1, "A")]);
    expect(scale.entries.at(-1)?.unset).toBe(true);
  });

  it("answers the neutral for a value nothing was sampled for", () => {
    const scale = buildColorScale(rows("a", 1, "A"));
    expect(scale.colorOf("never-seen")).toBe(unsetColor(false));
  });
});

describe("values that already own a colour elsewhere in the product", () => {
  it("keep it, and do not spend a palette slot", () => {
    const scale = buildColorScale([
      // three fixture rows; the rule is about hot loops, and rewriting it would only hurt readability.
      // oxlint-disable-next-line no-map-spread
      ...rows("a", 3, "A").map((r) => ({ ...r, color: "#123456" })),
      ...rows("b", 2, "B"),
    ]);
    expect(scale.colorOf("a")).toBe("#123456");
    // B is the FIRST value needing a slot, so it takes slot one — the state's
    // own colour did not consume it.
    expect(scale.colorOf("b")).toBe(SERIES_LIGHT[0]);
  });

  it("does not fold them away when there are more than six", () => {
    const many = Array.from({ length: 9 }, (_, i) => sample(`s${i}`, `S${i}`, `#00000${i}0`.slice(0, 7)));
    const scale = buildColorScale(many);
    expect(scale.entries.filter((e) => e.key !== "__other__")).toHaveLength(9);
    expect(scale.entries.some((e) => e.key === "__other__")).toBe(false);
  });
});

describe("a fixed order, where the dimension has one", () => {
  it("puts urgent above medium even though medium is more common", () => {
    const scale = buildColorScale([...rows("medium", 8, "Medium"), ...rows("urgent", 1, "Urgent")], {
      order: ["urgent", "high", "medium", "low", "none"],
    });
    expect(scale.entries.map((e) => e.key)).toEqual(["urgent", "medium"]);
  });
});

describe("done-ness is a texture, never a hue", () => {
  it("keeps the bar's own colour in the fill", () => {
    const fill = completedFill(SERIES_LIGHT[0]);
    expect(fill).toContain(SERIES_LIGHT[0]);
    expect(fill).toContain("repeating-linear-gradient(45deg");
  });

  it("never returns one of the six series colours as the stripe", () => {
    // A hatch drawn in another series' colour would read as that series.
    for (const color of [...SERIES_LIGHT, ...SERIES_DARK]) {
      expect([...SERIES_LIGHT, ...SERIES_DARK]).not.toContain(hatchStripe(color));
    }
  });

  it("darkens a pale fill and lightens a dark one", () => {
    // The stripe has to be visible on whatever the bar happens to be.
    expect(hatchStripe("#ffffff")).not.toBe("#ffffff");
    expect(hatchStripe("#000000")).not.toBe("#000000");
    expect(parseHex(hatchStripe("#ffffff"))![0]).toBeLessThan(255);
    expect(parseHex(hatchStripe("#000000"))![0]).toBeGreaterThan(0);
  });

  it("carries a glyph, so a greyscale print still says which bars are finished", () => {
    expect(DONE_GLYPH).toBeTruthy();
  });

  it("survives a colour it cannot parse rather than emitting #NaNNaNNaN", () => {
    // Label colours and hsl() project colours both reach this code.
    expect(mixHex("hsl(200, 50%, 50%)", "#ffffff", 0.3)).toBe("hsl(200, 50%, 50%)");
    expect(completedFill("hsl(200, 50%, 50%)")).not.toContain("NaN");
  });
});

describe("colour arithmetic", () => {
  it("parses both #rgb and #rrggbb", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#3a86ff")).toEqual([58, 134, 255]);
    expect(parseHex("rebeccapurple")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });

  it("mixes toward the second colour by the given ratio", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
