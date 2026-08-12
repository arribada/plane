/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What to do when one end of a work item's window is dragged past the other.
 *
 * Setting a start date after the end date used to be impossible and unexplained:
 * the two pickers clamped each other (`maxDate` on start, `minDate` on end), so
 * the day you wanted was simply not clickable. No message, no reason, no way to
 * say what you actually meant — which is almost always "the whole thing moved",
 * not "I want a task that ends before it begins". A refusal that says nothing is
 * the same silent-failure class this fork spent a week removing from its writes;
 * having it in a date picker instead of an HTTP catch does not make it better.
 *
 * So the picker accepts the date and this decides what it implies. Three answers:
 *
 *   "ok"        the pair is still in order; write the one field.
 *   "shift"     it would invert, and there is a coherent reading — move BOTH and
 *               keep the duration. The caller asks before applying it.
 *   "no-pair"   the other end is not set, so nothing can invert. Write the field.
 *
 * DURATION IS COUNTED IN WORKING DAYS, floored at one, which is
 * `_working_days_between`'s definition and the one every other duration in this
 * fork uses — the budget charges by it, the cascade preserves it, the slack tails
 * are drawn in it. Counting calendar days here instead would mean a task moved
 * across a weekend came back a different length from the one the bar renders, and
 * the two halves of the product would disagree about what a week of work is.
 */
import { addWorkingDays, fromEpochDay, toEpochDay, weekdaysBetween } from "./working-days";

export type TDateField = "start_date" | "target_date";

export type TDatePairEdit =
  /** The edit is fine as it stands. `patch` is the single field to write. */
  | { kind: "ok"; patch: { start_date?: string | null; target_date?: string | null } }
  /** The other end is not set — there is no pair to invert. */
  | { kind: "no-pair"; patch: { start_date?: string | null; target_date?: string | null } }
  /**
   * Applying it alone would put the start after the end. `patch` moves both and
   * keeps the duration; `duration` is what to say in the question.
   */
  | {
      kind: "shift";
      patch: { start_date: string; target_date: string };
      /** Working days the item spans, before and after — it is preserved. */
      duration: number;
      /** The end that has to follow, so the question can name it. */
      moving: TDateField;
      /** What that end currently says. */
      movingFrom: string;
    };

type TCurrent = { start_date?: string | null; target_date?: string | null };

export const resolveDatePairEdit = (
  field: TDateField,
  next: string | null,
  current: TCurrent,
  isHoliday?: (iso: string) => boolean
): TDatePairEdit => {
  // Clearing a date can never invert a pair.
  if (!next) return { kind: "ok", patch: { [field]: null } };

  const other: TDateField = field === "start_date" ? "target_date" : "start_date";
  const otherIso = current[other];
  if (!otherIso) return { kind: "no-pair", patch: { [field]: next } };

  const chosen = toEpochDay(next);
  const existing = toEpochDay(otherIso);
  if (chosen === null || existing === null) return { kind: "ok", patch: { [field]: next } };

  const inverts = field === "start_date" ? chosen > existing : chosen < existing;
  if (!inverts) return { kind: "ok", patch: { [field]: next } };

  // The span it has now, in working days, floored at one — a task takes at least
  // a day, and a same-day item must not come back zero-length.
  const currentStart = toEpochDay(current.start_date ?? null);
  const currentTarget = toEpochDay(current.target_date ?? null);
  const duration =
    currentStart !== null && currentTarget !== null && currentTarget >= currentStart
      ? Math.max(1, weekdaysBetween(currentStart, currentTarget))
      : 1;

  // Move the other end to keep that span: forward from a new start, backward from
  // a new end. Symmetric on purpose — fixing only one direction would leave the
  // mirror case silently blocked, which is the bug being fixed.
  const partner =
    field === "start_date"
      ? addWorkingDays(chosen, duration - 1, isHoliday)
      : addWorkingDays(chosen, -(duration - 1), isHoliday);

  // Beyond any horizon a plan can mean. Better to write the one field the person
  // named than to invent a partner date from unusable data.
  if (partner === null) return { kind: "ok", patch: { [field]: next } };

  return {
    kind: "shift",
    patch:
      field === "start_date"
        ? { start_date: next, target_date: fromEpochDay(partner) }
        : { start_date: fromEpochDay(partner), target_date: next },
    duration,
    moving: other,
    movingFrom: otherIso,
  };
};
