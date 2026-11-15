/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * How a timeline bar should look. Pulled out of the component because it is all
 * decisions about data — is this late, is it a milestone, is this colour dark
 * enough to need pale text — and none of it is about React.
 */
import type { TIssue } from "@plane/types";
import { localEpochDay, toEpochDay } from "./working-days";

export type TBarLook = {
  /** The fill, as given. Never washed out: the veil that used to sit over every
   *  bar cost the colour-by feature most of its meaning. */
  background: string;
  /** Readable on `background`, chosen by luminance rather than by theme — a bar
   *  can be any colour a team picked for a label. */
  text: string;
  /** Past its end date, and still expected. */
  overdue: boolean;
  /** In a `completed` state — delivered. Drawn with a 45° hatch and a tick. */
  done: boolean;
  /**
   * In a `cancelled` state — abandoned. Drawn hollow, struck and marked ✕.
   *
   * It used to answer `done`, which put a tick on work nobody did. Both groups
   * mean the item has left the plan and that is the only thing they share; see
   * the note on the five state groups at the bottom of `palette.ts`.
   */
  cancelled: boolean;
  /** A single day: drawn as a diamond, because a 3px bar is not a shape. */
  milestone: boolean;
};

/**
 * Relative luminance, sRGB, per WCAG. Cheap and exact enough to decide between two
 * text colours; the alternative is a contrast ratio nobody would tune.
 */
const luminance = (hex: string): number => {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (full.length < 6) return 1; // unparseable: assume light, keep dark text
  const channel = (start: number) => {
    const srgb = Number.parseInt(full.slice(start, start + 2), 16) / 255;
    return srgb <= 0.039_28 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const relative = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // A colour that is the right length but not hex parses to NaN, and every
  // comparison against NaN is false — which silently chose white text and made a
  // label vanish on a pale bar. Fall back the same way an unparseable one does.
  return Number.isFinite(relative) ? relative : 1;
};

/** The threshold where white text overtakes near-black against the same fill. */
export const readableOn = (background: string): string => (luminance(background) > 0.42 ? "#111827" : "#ffffff");

export const barLook = (
  issue: TIssue | undefined | null,
  background: string,
  stateGroup: string | undefined | null,
  today: Date = new Date()
): TBarLook => {
  const done = stateGroup === "completed";
  const cancelled = stateGroup === "cancelled";
  // Epoch DAYS, not instants. This used to be `new Date(value)` — UTC midnight
  // — followed by `setHours(0,0,0,0)`, a local getter: west of Greenwich that
  // instant is the previous evening, so an item due today drew the overdue ring
  // for every reader in the Americas and for nobody in Europe. A plan date is a
  // calendar day and is compared with the reader's calendar day; neither side
  // of that comparison has a timezone. See working-days.ts.
  const start = toEpochDay(issue?.start_date);
  const end = toEpochDay(issue?.target_date);
  const now = localEpochDay(today);

  // No percentage here because the overlay already draws one: ProjectProgressEndpoint
  // computes it server-side (a parent's share of completed children, 0 or 100 for a
  // leaf) and GanttAdditionalLayers fills the bar with it. This decides the rest.
  return {
    background,
    text: readableOn(background),
    // Cancelled is not overdue either — nobody is waiting for it. The split of
    // `done` into two must not quietly turn every abandoned item red.
    overdue: !done && !cancelled && end !== null && end < now,
    done,
    cancelled,
    // The bar steps aside for a diamond ONLY when a diamond is actually drawn — and the overlay
    // (GanttAdditionalLayers) draws one for a zero-duration item, start === target. Basing this on
    // "marked" instead let a MARKED multi-day deliverable hide its bar with no diamond behind it,
    // so the row rendered blank. Same-day is the honest predicate: no invisible items, and the
    // bar-transparency and the diamond now agree.
    milestone: start !== null && end !== null && end === start,
  };
};
