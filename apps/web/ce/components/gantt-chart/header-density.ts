/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * How much of a timeline header label still fits at the current pixels-per-day.
 *
 * Every header cell is laid out at a hard pixel width derived from the chart's
 * `dayWidth`, and every label inside one is a single unbreakable token — "Su",
 * "20", "14-20", "w24". Nothing in the chain clips them, so the moment the zoom
 * takes a cell below the width of its own text the labels paint straight over
 * the next column and the day strip reads "Su14 15 16 W 7Th18".
 *
 * The answer is not to clip — "Su2" is a worse bug than the overlap — and not to
 * shrink the type, because 9px in a 15px column still does not fit. It is to
 * paint less: drop the weekday letter, then thin the day numbers to every
 * 2nd/5th/7th day, then leave the band above to carry the dates. Same idea as
 * the weekend bands, which already only draw at `dayWidth >= 12`.
 *
 * Everything here is a pure function of a width. None of it changes how wide a
 * cell is, so the column geometry that the bars, the today line and the
 * dependency arrows are computed against (all of them arithmetic on `dayWidth`,
 * never a measurement of the header DOM) is untouched.
 */
import { months } from "@/components/gantt-chart/data";

/* -------------------------------------------------------------------------- */
/* text measurement                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Inter Variable advance widths in em, bucketed by character class, rounded up
 * within each bucket. Read out of the shipped `inter-latin-wght-normal.woff2`
 * (hmtx over unitsPerEm 2048) rather than guessed: digits run 0.407 ("1") to
 * 0.646 ("4"), lowercase clusters around 0.59, and W is 0.985 — a single
 * average across all of them is what makes a bucketed estimate wrong.
 *
 * These are the default instance's advances; the header renders at weight 500,
 * which moves them by a percent or two. Rounding each bucket up absorbs that,
 * and every threshold below leaves several pixels of slack on top.
 */
const EM_SPACE = 0.3; // space and the thin punctuation
const EM_HYPHEN = 0.46;
const EM_THIN = 0.42; // i j l t
const EM_SMALL = 0.5; // f r
const EM_DIGIT = 0.65;
const EM_LOWER = 0.6;
const EM_UPPER = 0.7;
const EM_WIDE = 0.99; // m w M W

const emWidthOfChar = (char: string): number => {
  if (" .,:;'!|".includes(char)) return EM_SPACE;
  if ("-–_/".includes(char)) return EM_HYPHEN;
  if ("ijlt".includes(char)) return EM_THIN;
  if ("fr".includes(char)) return EM_SMALL;
  if ("mwMW".includes(char)) return EM_WIDE;
  if (char >= "0" && char <= "9") return EM_DIGIT;
  if (char >= "A" && char <= "Z") return EM_UPPER;
  return EM_LOWER;
};

/** Approximate rendered width of `text` at `fontSizePx`, in pixels. */
export const approxTextWidth = (text: string, fontSizePx: number): number => {
  let em = 0;
  for (const char of text) em += emWidthOfChar(char);
  return em * fontSizePx;
};

/**
 * The width to reason about. `currentViewData?.data.dayWidth` is optional-chained
 * at every call site and is undefined on the first frame — treating that as
 * "infinitely wide" keeps the full label, so the header cannot flash sparse on
 * mount and then fill in.
 */
const usable = (width: number | undefined): number =>
  typeof width === "number" && Number.isFinite(width) && width > 0 ? width : Number.POSITIVE_INFINITY;

/* -------------------------------------------------------------------------- */
/* the day strip (week view)                                                   */
/* -------------------------------------------------------------------------- */

/** Two labels in one cell need daylight between them or they read as one token. */
const LABEL_GAP = 6;
/** `p-1` on a day cell. */
const DAY_CELL_PADDING = 8;
/** `px-1` on the today pill. */
const TODAY_PILL_PADDING = 8;
/** Widest weekday abbreviation — "Su", "Th", "Sa" — at text-11: 13.6px. */
const WEEKDAY_TEXT = 14;
/** Widest two-digit day number at text-11. 13.2px under `tabular-nums`, 14.2px
 *  if the tabular figures ever stop being applied — this covers both. */
const DAY_NUMBER_TEXT = 15;

/** A cell wide enough to hold "Su" and "20" side by side and still read as two. */
const WEEKDAY_MIN = DAY_CELL_PADDING + WEEKDAY_TEXT + LABEL_GAP + DAY_NUMBER_TEXT; // 43
/**
 * The today pill carries its own padding, so today's cell is ~8px hungrier than
 * every other one. A single threshold that ignores that leaves exactly one
 * broken column in an otherwise tidy header, which reads as a rendering glitch
 * rather than as a density choice.
 */
const WEEKDAY_MIN_TODAY = WEEKDAY_MIN + TODAY_PILL_PADDING; // 51
/**
 * Once only numbers are left they are centred, so what matters is the pitch
 * between neighbours rather than the padding — and the widest of them is today's
 * pill, not a bare number.
 */
const DAY_NUMBER_PITCH = DAY_NUMBER_TEXT + TODAY_PILL_PADDING + LABEL_GAP; // 29

/** Does the weekday abbreviation still fit beside the day number in this cell? */
export const showsWeekday = (dayWidth: number | undefined, isToday: boolean): boolean =>
  usable(dayWidth) >= (isToday ? WEEKDAY_MIN_TODAY : WEEKDAY_MIN);

/**
 * Label every Nth day. Snapped to a ladder rather than left as a raw ratio: a
 * step of 7 lands on the same weekday every week and 14/28 keep that, which
 * reads as a rhythm instead of as an arbitrary thinning.
 */
const STEP_LADDER = [1, 2, 5, 7, 14, 28];

export const dayNumberStep = (dayWidth: number | undefined): number => {
  const width = usable(dayWidth);
  if (width >= DAY_NUMBER_PITCH) return 1;
  const needed = Math.ceil(DAY_NUMBER_PITCH / Math.max(width, 1));
  return STEP_LADDER.find((step) => step >= needed) ?? STEP_LADDER[STEP_LADDER.length - 1];
};

/** Whole days since the epoch, from the local calendar date. DST-proof, and it
 *  does not mutate the Date it is handed the way the chart's own helpers do. */
const dayNumber = (date: Date): number =>
  Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

/**
 * Whether this day gets a number at the given step.
 *
 * Anchored on today rather than on `getDate() % step`, for two reasons: the
 * pitch is then exactly `step` days everywhere, including across a month
 * boundary, and today is always one of the labelled days — so the one column a
 * reader is looking for survives to the zoom floor without having to be forced
 * in beside a neighbour it would then collide with.
 */
export const showsDayNumber = (date: Date, step: number, anchor: Date): boolean => {
  if (step <= 1) return true;
  return (dayNumber(date) - dayNumber(anchor)) % step === 0;
};

/* -------------------------------------------------------------------------- */
/* the week strip (month view)                                                 */
/* -------------------------------------------------------------------------- */

/** `px-2` on a week cell. */
const WEEK_CELL_PADDING = 16;
/** Widest "14-20" at text-11: four digits and a hyphen, 33.5px. */
const WEEK_RANGE_TEXT = 34;
/** Widest "w24" at text-11 — w is 0.818em, the widest lowercase Inter has. */
const WEEK_NUMBER_TEXT = 24;

/** The today week wears the pill around its range, so the `full` tier has to
 *  clear the range *and* the pill *and* the week number, not just the first and
 *  the last of those. Sizing it without the pill left the current week's "23-29"
 *  a fifth of a millimetre off its own "w33". */
const WEEK_FULL_MIN = WEEK_CELL_PADDING + WEEK_RANGE_TEXT + TODAY_PILL_PADDING + LABEL_GAP + WEEK_NUMBER_TEXT; // 88
const WEEK_RANGE_MIN = WEEK_RANGE_TEXT + TODAY_PILL_PADDING + LABEL_GAP; // 48
const WEEK_START_MIN = DAY_NUMBER_TEXT + TODAY_PILL_PADDING + LABEL_GAP; // 29

/**
 * How much of a week cell's label survives at this cell width.
 * - `full`  — "14-20" and "w24"
 * - `range` — "14-20" alone, centred
 * - `start` — just the day the week starts on, i.e. a week tick
 * - `none`  — the month band above carries it
 */
export type TWeekLabel = "full" | "range" | "start" | "none";

export const weekRowLabel = (cellWidth: number | undefined): TWeekLabel => {
  const width = usable(cellWidth);
  if (width >= WEEK_FULL_MIN) return "full";
  if (width >= WEEK_RANGE_MIN) return "range";
  if (width >= WEEK_START_MIN) return "start";
  return "none";
};

/* -------------------------------------------------------------------------- */
/* the month strip (quarter view)                                              */
/* -------------------------------------------------------------------------- */

/** "Sept" — the longest month short title — at text-11. */
const MONTH_TEXT = 24;
/** `px-2` on the quarter view's today pill. */
const MONTH_PILL_PADDING = 16;

const MONTH_FULL_MIN = MONTH_TEXT + MONTH_PILL_PADDING + 4; // 44
const MONTH_TIGHT_MIN = MONTH_TEXT + TODAY_PILL_PADDING + 2; // 34

/**
 * How much room a month cell has for its label.
 * - `full`  — the today pill can keep its `px-2`
 * - `tight` — the pill drops to `px-1`; a 30-day September at the zoom floor is
 *             37.5px wide and a `px-2` "Sept" pill is 39.8px
 * - `none`  — not reachable at the current zoom floor, kept so lowering the
 *             floor cannot quietly reintroduce an overlap
 */
export type TMonthLabel = "full" | "tight" | "none";

export const monthRowLabel = (cellWidth: number | undefined): TMonthLabel => {
  const width = usable(cellWidth);
  if (width >= MONTH_FULL_MIN) return "full";
  if (width >= MONTH_TIGHT_MIN) return "tight";
  return "none";
};

/* -------------------------------------------------------------------------- */
/* the band above (month / quarter titles)                                     */
/* -------------------------------------------------------------------------- */

/** `m-1` + `px-3` around a band title. */
const TITLE_PADDING = 32;
/** `my-1` + `px-3` — the quarter title has no horizontal margin. */
const QUARTER_TITLE_PADDING = 24;
/** `px-3` around the right-hand label of a band. */
const SIDE_PADDING = 24;
/** `ml-2` + `px-1` + "Current" at text-9. */
const CURRENT_PILL = 52;

const TITLE_FONT = 13;
const MONTH_TITLE_FONT = 14;
const SIDE_FONT = 11;

/** What a band paints: its title, its "Current" pill, its right-hand label. */
export type TBandLabels = {
  /** Never null — something has to pin the band to a point in the calendar. */
  title: string;
  /** Right-hand label, or null when it would touch the title. */
  side: string | null;
  /** Whether the "Current" pill still fits after the title it hangs off. */
  current: boolean;
};

/**
 * Resolve a band's three labels together, in priority order: the title first
 * (longest form that fits, shortest as a floor), then the pill, then whatever
 * room is left for the right-hand label.
 *
 * Deciding them independently is the trap: each one fits beside the title on its
 * own, and all three together do not. That is how the quarter band ended up
 * painting "Q3", a Current pill and a second "Q3" into 115 pixels.
 */
const bandLabels = (
  cellWidth: number | undefined,
  titleCandidates: (string | undefined)[],
  titleFontPx: number,
  titlePaddingPx: number,
  isCurrent: boolean,
  sideCandidates: (string | undefined)[]
): TBandLabels => {
  const width = usable(cellWidth);
  const titles = titleCandidates.filter((candidate): candidate is string => !!candidate);

  let title = titles[titles.length - 1] ?? "";
  for (const candidate of titles) {
    if (titlePaddingPx + approxTextWidth(candidate, titleFontPx) <= width) {
      title = candidate;
      break;
    }
  }

  const titleWidth = titlePaddingPx + approxTextWidth(title, titleFontPx);
  const current = isCurrent && width >= titleWidth + CURRENT_PILL;

  const room = width - titleWidth - (current ? CURRENT_PILL : 0) - LABEL_GAP;
  let side: string | null = null;
  for (const candidate of sideCandidates) {
    // A "Q3" sitting beside a title that has itself collapsed to "Q3" is noise.
    if (!candidate || candidate === title) continue;
    if (SIDE_PADDING + approxTextWidth(candidate, SIDE_FONT) <= room) {
      side = candidate;
      break;
    }
  }

  return { title, side, current };
};

/**
 * Week view's band: the month on the left, the week on the right.
 *
 * A week that straddles two months is titled "Jun 2026 - Jul 2026" — around
 * 160px of text and chrome, against a week block that is 105px wide at the zoom
 * floor. So the title gives way to the month the week starts in, and then to the
 * month alone; the week label goes "Week 30" → "w30" → nothing.
 */
export const weekBandLabels = (
  cellWidth: number | undefined,
  title: string | undefined,
  startMonth: number | undefined,
  startYear: number | undefined,
  weekTitle: string | undefined,
  weekShortTitle: string | undefined
): TBandLabels => {
  const abbreviation = startMonth === undefined ? undefined : months[startMonth]?.abbreviation;
  return bandLabels(
    cellWidth,
    [title, `${abbreviation ?? ""} ${startYear ?? ""}`.trim(), abbreviation],
    TITLE_FONT,
    TITLE_PADDING,
    false,
    [weekTitle, weekShortTitle]
  );
};

/** Month view's per-month band: "february 2026" → "feb 2026" → "feb". */
export const monthBandLabels = (
  cellWidth: number | undefined,
  title: string | undefined,
  shortTitle: string | undefined,
  year: number | undefined,
  isCurrent: boolean
): TBandLabels =>
  bandLabels(
    cellWidth,
    [title, `${shortTitle ?? ""} ${year ?? ""}`.trim(), shortTitle],
    MONTH_TITLE_FONT,
    TITLE_PADDING,
    isCurrent,
    []
  );

/** Quarter view's band: "Jul - Sept 2026" → "Q3", with "Q3" on the right. */
export const quarterBandLabels = (
  cellWidth: number | undefined,
  title: string | undefined,
  shortTitle: string | undefined,
  isCurrent: boolean
): TBandLabels =>
  bandLabels(cellWidth, [title, shortTitle], MONTH_TITLE_FONT, QUARTER_TITLE_PADDING, isCurrent, [shortTitle]);
