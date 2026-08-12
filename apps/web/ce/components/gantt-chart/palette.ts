/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The colours a timeline may paint a bar, and the rule for handing them out.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 *
 * "Colour by assignee" used to hash the person's uuid into an HSL hue. That
 * produces a different colour per person, which is all it was asked for, and it
 * is wrong in the two ways that matter: two people can land four degrees apart,
 * and nothing stops a hue that a red-green colourblind reader cannot separate
 * from the one beside it. Roughly one man in twelve reads this board.
 *
 * So the hues are not generated. They are six fixed steps, and they were chosen
 * by search rather than by eye: candidate sets were enumerated in OKLCH and kept
 * only if they cleared, in BOTH themes and on THIS product's actual surfaces
 * (white, and the navy `--neutral-100` = #0c151f):
 *
 *   - the lightness band and the chroma floor,
 *   - protan/deutan separation ΔE >= 8 (OKLab x100),
 *   - and a normal-vision floor of ΔE >= 15,
 *
 * over **every pair**, not merely adjacent ones — a gantt sorts its rows by date,
 * so any two series can end up touching. Six is the ceiling: no seventh hue
 * clears that gate, which is why the cap below is 6 and not 8. The validator's
 * own words, on the shipped set:
 *
 *   light  worst pair CVD ΔE 11.9 (deutan) · normal-vision ΔE 15.3
 *   dark   worst pair CVD ΔE  8.2 (protan) · normal-vision ΔE 15.5
 *
 * Three steps sit below 3:1 against their surface (light teal 2.02; dark red
 * 2.66 and violet 2.64). That is a documented relief case rather than a failure,
 * and the relief is real here: every bar carries its own name, the sidebar names
 * every row again, the legend names every series, and the CSV export is the
 * table view. Colour is never the only thing saying which series a bar is in.
 *
 * ---------------------------------------------------------------------------
 * What is NOT in this palette
 * ---------------------------------------------------------------------------
 *
 * Done-ness. A finished work item is a STATE, not a seventh series: giving it a
 * hue would both eat a slot and collide with whichever series happened to own
 * that colour. It is drawn with a 45-degree hatch and a tick instead — a
 * channel no series uses, which survives a greyscale print and a screenshot.
 *
 * Cancelled-ness, for the same reason and one more. See the note on the five
 * state groups at the bottom of this file.
 */

/** The most series that can carry their own hue. See the header. */
export const SERIES_CAP = 6;

/**
 * The six steps, per theme. Same six hues; the dark column is those hues
 * re-stepped for the dark surface, not a second palette.
 */
export const SERIES_LIGHT = ["#386be2", "#6da122", "#99151d", "#781e98", "#d8488c", "#33cda4"] as const;
export const SERIES_DARK = ["#467af3", "#70a523", "#b11a24", "#8730a8", "#e65598", "#1d8468"] as const;

/**
 * Two neutrals, and they mean different things.
 *
 * `UNSET` is "this item has no value on this dimension" — nobody is assigned, it
 * is in no sprint. `OTHER` never appears: past six values the tail folds into
 * the LAST slot, which keeps every colour on screen a validated one. Naming the
 * two apart matters because "unassigned" is a fact about the work and "other" is
 * a fact about the palette, and a reader must not confuse them.
 */
export const UNSET_LIGHT = "#64748b";
export const UNSET_DARK = "#94a3b8";

export const seriesPalette = (dark: boolean): readonly string[] => (dark ? SERIES_DARK : SERIES_LIGHT);
export const unsetColor = (dark: boolean): string => (dark ? UNSET_DARK : UNSET_LIGHT);

/** Whether the app is currently painting its dark theme. Plane stamps
 *  `data-theme` on the root and its own CSS matches `[data-theme*="dark"]`, so
 *  that substring is the same test the stylesheet makes — including for the
 *  `dark-contrast` variant. */
export const isDarkSurface = (): boolean => {
  try {
    return (document.documentElement.dataset.theme ?? "").includes("dark");
  } catch {
    return false;
  }
};

// ── one series ───────────────────────────────────────────────────────────────

export type TSeries = {
  /** The value's stable id (a user id, a cycle id, the discipline string). */
  key: string;
  /** What the legend says. */
  label: string;
  color: string;
  /** How many rows carry this value — the legend orders and folds by it. */
  count: number;
  /** Set on the folded slot: the values that were merged into it, named so the
   *  legend can list them rather than swallow them. */
  folded?: string[];
  /** True for the "no value on this dimension" entry. */
  unset?: boolean;
};

export type TColorScale = {
  /** Legend order: the order the slots were handed out. */
  entries: TSeries[];
  /** The bar colour for a row's value. */
  colorOf: (key: string | null | undefined) => string;
  /** Which legend entry a row's value reads under (folded values answer the
   *  folded entry, not themselves). */
  seriesOf: (key: string | null | undefined) => TSeries | undefined;
};

export type TColorSample = {
  key: string | null | undefined;
  label?: string | null;
  /**
   * A colour the value already owns elsewhere in the product — a state's, a
   * label's, a priority's. Passed straight through, and it does NOT consume one
   * of the six slots: repainting a state on this one screen would mean the same
   * state was two colours on two screens, which is worse than an unvalidatable
   * hue the reader has already learnt.
   */
  color?: string | null;
};

/**
 * Hand the six hues out over the values actually present.
 *
 * The order is **frequency descending, then label, then key** — deliberately not
 * first-appearance. Two reasons. Frequency puts the distinct hues on the series
 * that occupy the most bars, so the fold costs the least. And all three keys are
 * computed over the whole set of rows handed in, so filtering the view does not
 * repaint the survivors: a colour follows the entity, never its rank in whatever
 * subset is on screen right now.
 *
 * Past six values the tail is folded into the sixth slot rather than given a
 * generated hue. The folded entry keeps the names of everything inside it, so
 * the legend can say *which* seven people are in there.
 */
export const buildColorScale = (
  samples: TColorSample[],
  options: { dark?: boolean; unsetLabel?: string; cap?: number; order?: string[] } = {}
): TColorScale => {
  const dark = options.dark ?? false;
  const cap = Math.max(1, Math.min(options.cap ?? SERIES_CAP, SERIES_CAP));
  const palette = seriesPalette(dark);

  const counts = new Map<string, { label: string; count: number; color?: string }>();
  let unsetCount = 0;
  for (const sample of samples) {
    const key = sample.key ?? "";
    if (!key) {
      unsetCount += 1;
      continue;
    }
    const seen = counts.get(key);
    if (seen) {
      seen.count += 1;
      // First non-empty label wins, so a row that happens to arrive without one
      // cannot blank a legend entry another row already named.
      if (!seen.label && sample.label) seen.label = sample.label;
      if (!seen.color && sample.color) seen.color = sample.color;
    } else counts.set(key, { label: sample.label ?? key, count: 1, color: sample.color ?? undefined });
  }

  /** A fixed severity order beats frequency where one exists — nobody reads a
   *  priority legend that puts Urgent under Medium. */
  const rank = options.order ? new Map(options.order.map((key, index) => [key, index] as const)) : null;
  // oxlint-disable-next-line unicorn/no-array-sort -- the array is ours alone; toSorted is ES2023 and this workspace targets earlier
  const ranked = [...counts.entries()].sort((a, b) => {
    if (rank) {
      const ra = rank.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
    }
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    const byLabel = a[1].label.localeCompare(b[1].label, undefined, { sensitivity: "base" });
    return byLabel !== 0 ? byLabel : a[0].localeCompare(b[0]);
  });

  const entries: TSeries[] = [];
  const byKey = new Map<string, TSeries>();

  // Values that already own a colour are handed it back and never take a slot,
  // so the six validated hues are spent only on the values that have none.
  const needsSlot = ranked.filter(([, value]) => !value.color);
  const named = needsSlot.length <= cap ? needsSlot : needsSlot.slice(0, cap - 1);
  const slotFor = new Map<string, string>();
  named.forEach(([key], index) => slotFor.set(key, palette[index]));

  for (const [key, value] of ranked) {
    if (!value.color && !slotFor.has(key)) continue; // folded below
    const series: TSeries = {
      key,
      label: value.label,
      color: value.color ?? slotFor.get(key)!,
      count: value.count,
    };
    entries.push(series);
    byKey.set(key, series);
  }

  if (needsSlot.length > cap) {
    const tail = needsSlot.slice(cap - 1);
    const folded: TSeries = {
      key: "__other__",
      label: `Other (${tail.length})`,
      color: palette[cap - 1],
      count: tail.reduce((sum, [, value]) => sum + value.count, 0),
      folded: tail.map(([, value]) => value.label),
    };
    entries.push(folded);
    for (const [key] of tail) byKey.set(key, folded);
  }

  if (unsetCount > 0) {
    const series: TSeries = {
      key: "",
      label: options.unsetLabel ?? "Unset",
      color: unsetColor(dark),
      count: unsetCount,
      unset: true,
    };
    entries.push(series);
    byKey.set("", series);
  }

  const seriesOf = (key: string | null | undefined) => byKey.get(key ?? "");
  return {
    entries,
    seriesOf,
    colorOf: (key) => seriesOf(key)?.color ?? unsetColor(dark),
  };
};

// ── done-ness: a texture, never a hue ────────────────────────────────────────

/** Prefixed to a finished item's label. A tick reads as done in every locale
 *  this product ships, and it survives greyscale, which is the point. */
export const DONE_GLYPH = "✓";

const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** Parse #rgb / #rrggbb. Returns null for anything else — hsl(), a CSS variable,
 *  a colour name — so callers can fall back rather than emit `#NaNNaNNaN`. */
export const parseHex = (color: string): [number, number, number] | null => {
  const value = color.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
};

export const toHex = (rgb: [number, number, number]): string =>
  "#" + rgb.map((c) => clamp255(c).toString(16).padStart(2, "0")).join("");

/** `ratio` of `b` over `a`. Both must be hex; anything else returns `a`, which
 *  is the visible colour rather than a broken one. */
export const mixHex = (a: string, b: string, ratio: number): string => {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;
  const t = Math.max(0, Math.min(1, ratio));
  return toHex([0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * t) as [number, number, number]);
};

/** One sRGB channel, linearised, per WCAG. Module scope rather than nested in
 *  `luminance`: it closes over nothing, so re-creating it three times per call
 *  bought nothing. */
const linearChannel = (c: number): number => {
  const srgb = c / 255;
  return srgb <= 0.039_28 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance, sRGB, per WCAG — the same computation `bar-appearance`
 *  makes, kept here so this module has no dependency on the React side. */
const luminance = (color: string): number => {
  const rgb = parseHex(color);
  if (!rgb) return 1;
  const value = 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2]);
  return Number.isFinite(value) ? value : 1;
};

/** The stripe colour for a hatch over `fill`: whichever of near-black or white
 *  reads on it, pulled a third of the way back toward the fill so the bar still
 *  reads as its own series colour rather than as a barber's pole. */
export const hatchStripe = (fill: string): string => mixHex(fill, luminance(fill) > 0.42 ? "#111827" : "#ffffff", 0.34);

export const HATCH_PERIOD = 10; // px, one light + one dark band

/**
 * The CSS fill for a completed bar: its own series colour, hatched at 45deg.
 *
 * A gradient rather than an opacity change on purpose. Fading a finished bar is
 * the obvious move and it is the wrong one twice over — it makes the colour-by
 * choice unreadable exactly where it is most useful ("who finished what"), and
 * on a dark theme a faded bar and a pale series colour are the same picture.
 */
export const completedFill = (fill: string): string => {
  const stripe = hatchStripe(fill);
  const half = HATCH_PERIOD / 2;
  return `repeating-linear-gradient(45deg, ${fill} 0 ${half}px, ${stripe} ${half}px ${HATCH_PERIOD}px)`;
};

// ── the five state groups, and which of them get a treatment ─────────────────
//
// Plane groups every state into one of five: `backlog`, `unstarted` (Todo),
// `started` (In progress), `completed` (Done) and `cancelled`. Two of them are
// drawn distinctly here and three are deliberately drawn plain.
//
// COMPLETED keeps the 45° hatch and the tick, as above.
//
// CANCELLED gets its own treatment, and getting one is the point: it used to
// share the tick. `isItemDone` and `barLook` both answered "done" for either
// group, because the question the toggle was written for is "what is still
// ahead of me" and a cancelled item is not — which is true, and which put a ✓
// on work that was abandoned. A tick means achieved. On a board a funder reads,
// that is not a shade of meaning.
//
// The treatment is a bar with NO FILL: its outline in its own series colour, the
// label in the ordinary text token with a line through it, and a ✕ where the
// tick would be. Four things decided it.
//
//   * "A cancelled item still occupying a full-strength bar overstates a plan" is
//     a statement about AREA. Removing the fill removes the area and keeps the
//     extent, so the row still says what had been planned without claiming it.
//   * Not a fade. Fading is the obvious move and it is wrong twice over — it
//     makes the colour-by choice unreadable exactly where it is useful, and on a
//     dark surface a faded bar and a pale series colour are the same picture.
//     That argument is already why `completedFill` is a hatch; it applies here
//     with more force, since a fade would ALSO have to be told apart from a
//     hatch.
//   * Not a third diagonal. 45° is done and 135° is "dates inferred"; a third
//     angle on one board is a texture nobody can decode. An absence of fill is
//     not on the texture axis at all.
//   * Not hidden by default. Work that vanishes with nothing said is the failure
//     this fork keeps having to fix, and a cancelled item that held a slot in a
//     plan is exactly what somebody comparing against a baseline came to see.
//
// It carries three redundant channels — no fill, a struck label, a ✕ — and not
// one of them is a colour, so it survives greyscale, a screenshot and
// forced-colors. It also cannot collide with the hatches, because it has none.
//
// BACKLOG, UNSTARTED and STARTED are drawn plain, and that is a decision rather
// than an omission:
//
//   * They are the ordinary run of work. A default that is marked is not a
//     default, and marking three of five groups leaves the reader decoding the
//     majority of the board.
//   * `state` is already one of the colour-by axes, and a state carries the
//     team's OWN colour, which `portfolioItemSample` and `colorSampleFor` pass
//     straight through rather than repainting. A reader who wants progress
//     encoded already has an exact encoding for it — and a second, fixed
//     treatment on top would put two different state encodings on one bar.
//   * The board already carries colour-by, two hatches, a tick, a ✕, a critical
//     ring, a milestone diamond, a progress fill, a baseline ghost, avatars and
//     an overdue ring. A fifth visual language is not a feature.
//
// Done and cancelled earn theirs because they are the two groups that mean the
// work has LEFT the plan, which is a different kind of fact from how far along
// it is.

/** Prefixed to a cancelled item's label, where a finished one gets a tick.
 *  A multiplication sign rather than the letter x: it is the glyph the reader
 *  already knows from every dismiss control in the product. */
export const CANCELLED_GLYPH = "✕";

/** How thick the outline of a cancelled bar is. 2px rather than a hairline
 *  because three of the twelve series steps sit below 3:1 against their surface
 *  — a documented relief case for a filled bar, and one a 1px line would lean on
 *  harder than it should. The label and the glyph are the primary channels
 *  either way. */
export const CANCELLED_OUTLINE_WIDTH = 2;

/**
 * The CSS for a cancelled bar: nothing inside it, its series colour around it.
 *
 * Returned as a style object rather than a background string — unlike
 * `completedFill`, this has to switch the fill OFF, and a caller that spread a
 * background-image over a `backgroundColor` it had already set would get a bar
 * that is hollow and coloured at the same time.
 */
export const cancelledFill = (fill: string): { backgroundColor: string; backgroundImage: string; border: string } => ({
  backgroundColor: "transparent",
  backgroundImage: "none",
  border: `${CANCELLED_OUTLINE_WIDTH}px solid ${fill}`,
});
