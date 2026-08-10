/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderFormattedDate } from "@plane/utils";

// A half-open range still tells the reader something, so one missing end is
// rendered rather than swallowed.
export const formatRange = (start: string | null, target: string | null): string => {
  const from = renderFormattedDate(start);
  const to = renderFormattedDate(target);
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "";
};

export const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * How a purchase request's state is drawn, per state.
 *
 * This was a two-way ternary — `status === "approved" ? "Approved" : "Rejected"`
 * — in the audit list a grant reviewer reads. The model has had five states since
 * the procurement fields landed, so the two that record what happened AFTER the
 * money decision, `ordered` and `received`, were both rendered as **"Rejected",
 * in red**. A reviewer reading that list would conclude the organisation had
 * turned down a purchase it had in fact made and taken delivery of.
 *
 * A lookup rather than a chain of ternaries because a chain has to be extended by
 * hand every time the model gains a state, and the failure mode when nobody
 * remembers is precisely the one above: the last branch quietly absorbs it.
 * `statusPill` below falls back to the state's own name in neutral colours, so an
 * unknown state is uninformative — never wrong, and never accusatory.
 */
export type TRequestStatusPill = { label: string; className: string };

const NEUTRAL_PILL = "bg-layer-2 text-tertiary";

export const REQUEST_STATUS_PILL: Record<string, TRequestStatusPill> = {
  pending: { label: "Waiting", className: "bg-warning-subtle text-warning-primary" },
  approved: { label: "Approved", className: "bg-success-subtle text-success-primary" },
  // Ordered is money committed AND placed; received is the parts on the bench.
  // Both are further along than "approved", so neither may look like a refusal.
  ordered: { label: "Ordered", className: "bg-accent-subtle text-accent-primary" },
  received: { label: "Received", className: "bg-success-subtle text-success-primary" },
  rejected: { label: "Rejected", className: "bg-danger-subtle text-danger-primary" },
};

export const statusPill = (status: string | null | undefined): TRequestStatusPill =>
  REQUEST_STATUS_PILL[String(status ?? "")] ?? {
    // Title-cased so a state the server grows before this file knows about it
    // still reads as a word rather than as a database value.
    label: String(status ?? "").replace(/^./, (c) => c.toUpperCase()) || "Unknown",
    className: NEUTRAL_PILL,
  };

/**
 * The word for what the decider did, for the "… by Nadia" byline.
 *
 * Separate from the pill's label because the byline is a sentence: "approved by
 * Nadia" reads, "Approved by Nadia" does not, and "ordered by Nadia" would be
 * wrong — the lead approved it, somebody else placed the order. Everything past
 * the decision therefore still credits the decision.
 */
export const decisionVerb = (status: string | null | undefined): string =>
  String(status ?? "") === "rejected" ? "rejected" : "approved";
