/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which way a dependency points.
 *
 * The bug this pins: the two-way ternary used elsewhere in this fork —
 * "`blocked_by` means related→issue, everything else means issue→related" —
 * points `finish_after` and `start_after` BACKWARDS. Harmless-ish for row order;
 * fatal for anything that moves dates, which would push the predecessor when the
 * successor was dragged.
 */
import { describe, expect, it } from "vitest";
import { graphEdges } from "./edges";

const rel = (issue_id: string, related_issue_id: string, relation_type: string) => ({
  issue_id,
  related_issue_id,
  relation_type,
});

describe("graphEdges", () => {
  it("points finish_before from the issue to the related item", () => {
    expect(graphEdges([rel("a", "b", "finish_before")])).toEqual([{ from: "a", to: "b", kind: "FS" }]);
  });

  it("points blocked_by from the blocker", () => {
    expect(graphEdges([rel("a", "b", "blocked_by")])).toEqual([{ from: "b", to: "a", kind: "FS" }]);
  });

  it("points finish_after from the RELATED item — the case the ternary got wrong", () => {
    expect(graphEdges([rel("a", "b", "finish_after")])).toEqual([{ from: "b", to: "a", kind: "FS" }]);
  });

  it("points start_after from the RELATED item — the other case the ternary got wrong", () => {
    expect(graphEdges([rel("a", "b", "start_after")])).toEqual([{ from: "b", to: "a", kind: "SS" }]);
  });

  it("marks start_before as a start-to-start constraint", () => {
    expect(graphEdges([rel("a", "b", "start_before")])).toEqual([{ from: "a", to: "b", kind: "SS" }]);
  });

  it("drops a relation type that says nothing about when either item happens", () => {
    // `relates_to` is a note between two items. Scheduling on it would move dates
    // nobody sequenced.
    expect(graphEdges([rel("a", "b", "relates_to"), rel("a", "b", "duplicate")])).toEqual([]);
  });

  it("drops a self-link", () => {
    expect(graphEdges([rel("a", "a", "blocked_by")])).toEqual([]);
  });
});
