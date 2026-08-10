/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The pill that called a completed purchase a refusal.
 *
 * `budget-block.tsx` drew a decided purchase request with a two-way ternary:
 * `r.status === "approved" ? "Approved" : "Rejected"`, and the same shape again
 * for the "…by Nadia" byline. The model has had five states since the procurement
 * fields landed, so the two that record what happened AFTER the money decision —
 * `ordered` and `received` — both came out as **"Rejected", in red**, in the audit
 * list a grant reviewer reads. A reviewer reading it would conclude the
 * organisation had turned down a purchase it had in fact made and taken delivery
 * of, and there was nothing else on that row to contradict it.
 *
 * The rule these tests hold is stronger than "ordered says Ordered": no state
 * other than `rejected` may EVER be drawn as a refusal, including a state this
 * file has never heard of. That is the assertion that would have caught the bug
 * when `ordered` and `received` were added, and the one that catches the next
 * state somebody adds to the model.
 *
 * Every test here fails against HEAD, where neither export exists.
 */
import { describe, expect, it } from "vitest";
import { decisionVerb, REQUEST_STATUS_PILL, statusPill } from "./helpers";

/** Every value `ProcurementRequest.STATUS_CHOICES` can hold, from models.py. */
const MODEL_STATUSES = ["pending", "approved", "rejected", "ordered", "received"];

describe("the purchase-request status pill", () => {
  it("never calls a state that is not a refusal a refusal", () => {
    // The whole bug, stated once. Colour as well as word: red is the half a
    // reader takes in before they have read anything.
    for (const status of MODEL_STATUSES.filter((s) => s !== "rejected")) {
      const pill = statusPill(status);
      expect(pill.label, `${status} must not read as a refusal`).not.toMatch(/reject/i);
      expect(pill.className, `${status} must not be drawn in the danger colour`).not.toMatch(/danger/);
    }
  });

  it("still calls a refusal a refusal", () => {
    // Without this, everything above would also pass on a lookup that had simply
    // stopped saying "Rejected" at all.
    expect(statusPill("rejected").label).toBe("Rejected");
    expect(statusPill("rejected").className).toMatch(/danger/);
  });

  it("names every state the model can hold", () => {
    // A ternary chain has to be extended by hand for each new state, and the
    // failure mode when nobody remembers is precisely the one this file is about:
    // the last branch quietly absorbs it.
    for (const status of MODEL_STATUSES) {
      expect(Object.keys(REQUEST_STATUS_PILL)).toContain(status);
      expect(statusPill(status).label.length).toBeGreaterThan(0);
    }
  });

  it("says ordered and received are further along, not further back", () => {
    expect(statusPill("ordered").label).toBe("Ordered");
    expect(statusPill("received").label).toBe("Received");
    // Received is the good end of the process and is drawn like it.
    expect(statusPill("received").className).toMatch(/success/);
  });

  it("falls back to something uninformative rather than to something wrong", () => {
    // A state the server grows before this file knows about it. Neutral is the
    // only honest answer; the previous else-branch's answer was an accusation.
    const unknown = statusPill("part_shipped");
    expect(unknown.label).not.toMatch(/reject/i);
    expect(unknown.className).not.toMatch(/danger|success/);
    expect(unknown.label).toBe("Part_shipped");
  });

  it("does not crash on the absent status a stale cached row can carry", () => {
    for (const empty of [null, undefined, ""]) {
      const pill = statusPill(empty);
      expect(pill.label).not.toMatch(/reject/i);
      expect(pill.className).not.toMatch(/danger/);
    }
  });
});

describe("the byline verb", () => {
  it("credits the decision, not the delivery", () => {
    // "ordered by Nadia" would be wrong: the lead approved it, whoever placed the
    // order placed it. Everything past the decision still credits the decision.
    expect(decisionVerb("approved")).toBe("approved");
    expect(decisionVerb("ordered")).toBe("approved");
    expect(decisionVerb("received")).toBe("approved");
  });

  it("still says rejected where somebody rejected it", () => {
    expect(decisionVerb("rejected")).toBe("rejected");
  });
});
