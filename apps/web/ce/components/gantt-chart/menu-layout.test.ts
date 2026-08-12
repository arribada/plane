/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "regarde image, nest sub-task le texte sort du menu, pareil pour module."
 *
 * ---------------------------------------------------------------------------
 * What was wrong
 * ---------------------------------------------------------------------------
 *
 * Not the strings, and not the panel widths. The toolbar's control groups carry
 * `whitespace-nowrap` **on purpose** — it is what makes a narrow chart move a
 * whole group onto the next line instead of splitting one down the middle, and
 * the comment in `header.tsx` says so. `white-space` is an INHERITED property,
 * and inheritance does not stop at an absolutely positioned child, so every
 * dropdown opened from one of those groups was forbidden to wrap. Each panel has
 * a fixed width (`w-56`/`w-64`/`w-72`); a 95-character helper sentence in a
 * `w-64` panel therefore ran off the right edge and was clipped mid-word.
 *
 * The fix is per-panel rather than per-string: a panel is not a toolbar control
 * and declares its own `whitespace-normal`. Shortening one sentence would have
 * fixed one entry and left the other five.
 *
 * ---------------------------------------------------------------------------
 * What this test proves, and what it does not
 * ---------------------------------------------------------------------------
 *
 * jsdom has no layout engine: it cannot measure a box, so it cannot see an
 * overflow. This reads the sources instead and pins the two halves of the rule —
 * every panel opts out of nowrap, and the groups that need nowrap still have it.
 * That is enough to catch the regression (a new menu added without the class,
 * or somebody "fixing" the overflow by deleting the group's nowrap and quietly
 * breaking the toolbar's wrapping).
 *
 * It does NOT prove the text fits. Whether a wrapped three-line helper looks
 * right at the narrowest sidebar width, and whether the panel now runs off the
 * BOTTOM of a short viewport, needs a browser.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Every menu opened from the gantt or portfolio toolbars. */
const PANEL_FILES = [
  "./group-by.tsx",
  "./color-by.tsx",
  "./lock-button.tsx",
  "./saved-order.tsx",
  "./export-button.tsx",
  "../../../core/components/gantt-chart/chart/header.tsx",
  "../portfolio/toolbar.tsx",
];

/**
 * A dropdown panel: absolutely positioned, above the chart, with a fixed width.
 * Matching on the shape rather than on a list of line numbers means a menu added
 * next month is covered without anybody remembering to add it here.
 */
const panelsIn = (source: string): string[] =>
  [...source.matchAll(/className="([^"]*absolute[^"]*)"/g)]
    .map((match) => match[1])
    .filter((className) => /\bz-30\b/.test(className) && /\bw-\d/.test(className));

describe("dropdown panels may wrap their own text", () => {
  it.each(PANEL_FILES)("%s", (file) => {
    const panels = panelsIn(read(file));
    expect(panels.length, `no dropdown panel found in ${file} — has the markup changed?`).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel, `panel in ${file} inherits nowrap from its toolbar group`).toContain("whitespace-normal");
    }
  });

  it("covers every panel in the two toolbars, not a sample", () => {
    const total = PANEL_FILES.reduce((sum, file) => sum + panelsIn(read(file)).length, 0);
    // Six in the gantt toolbar (group, colour, lock, saved order, export,
    // display) and five in the portfolio's. A new one is welcome; this is here so
    // that a panel DISAPPEARING from the sweep — renamed classes, a refactor to a
    // shared component — is noticed rather than silently reducing the coverage.
    expect(total).toBeGreaterThanOrEqual(11);
  });
});

describe("the toolbar still wraps group by group", () => {
  // The overflow's obvious fix is to delete the `whitespace-nowrap` that caused
  // it. That would let a narrow chart break a control group in half — the exact
  // thing the toolbar rework was for — and nothing else in the suite would
  // notice, because there is no layout here to notice with.
  it("keeps nowrap on the chart header's control groups", () => {
    const source = read("../../../core/components/gantt-chart/chart/header.tsx");
    expect(source).toContain("whitespace-nowrap");
    // And keeps the ::after touch areas that make a 16px control tappable.
    expect(source).toContain("after:-inset-y-1.5");
  });

  it("keeps nowrap on the groups the issue gantt hands in", () => {
    const source = read("../../../core/components/issues/issue-layouts/gantt/base-gantt-root.tsx");
    expect(source.match(/items-center gap-1\.5 whitespace-nowrap/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
