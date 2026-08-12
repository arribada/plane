/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Row order along the dependency graph: what a task waits on sits above it.
 *
 * Pinned here because the ordering used to read its own private ternary — the
 * same "`blocked_by` means related→issue, everything else means issue→related"
 * that `edges.ts` exists to replace. Under it a `finish_after` or `start_after`
 * link ordered the pair upside down, which is the one thing this function is for.
 * It also counted `relates_to` as a constraint, so a plain "see also" note pulled
 * an unrelated row up the chart.
 */
import type { TIssueRelationEdge } from "@/plane-web/types/arribada";
import { describe, expect, it } from "vitest";
import { orderByDependency } from "./dependency-order";

const rel = (issue_id: string, related_issue_id: string, relation_type: string): TIssueRelationEdge => ({
  issue_id,
  related_issue_id,
  relation_type,
});

describe("orderByDependency", () => {
  it("puts a blocker above what it blocks", () => {
    // `blocked_by`: a is blocked by b, so b comes first. The one case the old
    // ternary got right.
    expect(orderByDependency(["a", "b"], [rel("a", "b", "blocked_by")])).toEqual(["b", "a"]);
  });

  it("puts the predecessor of a finish_after above its successor", () => {
    // `a finish_after b` means a starts once b finishes: b is the predecessor.
    // The old ternary read this as a→b and put the successor on top.
    expect(orderByDependency(["a", "b"], [rel("a", "b", "finish_after")])).toEqual(["b", "a"]);
  });

  it("puts the predecessor of a start_after above its successor", () => {
    expect(orderByDependency(["a", "b"], [rel("a", "b", "start_after")])).toEqual(["b", "a"]);
  });

  it("keeps finish_before and start_before pointing from the issue", () => {
    expect(orderByDependency(["b", "a"], [rel("a", "b", "finish_before")])).toEqual(["a", "b"]);
    expect(orderByDependency(["b", "a"], [rel("a", "b", "start_before")])).toEqual(["a", "b"]);
  });

  it("does not reorder for a relation that says nothing about timing", () => {
    // `relates_to` and `duplicate` are notes between two items, not statements
    // about when either happens. Treating one as a constraint moved a row for a
    // reason its author never gave.
    expect(orderByDependency(["b", "a"], [rel("a", "b", "relates_to")])).toEqual(["b", "a"]);
    expect(orderByDependency(["b", "a"], [rel("a", "b", "duplicate")])).toEqual(["b", "a"]);
  });

  it("orders a mixed chain end to end", () => {
    // c ← b ← a written three different ways round, which is exactly how a real
    // project accumulates them.
    const ids = ["a", "b", "c"];
    const edges = [rel("b", "a", "finish_after"), rel("c", "b", "blocked_by")];

    expect(orderByDependency(ids, edges)).toEqual(["a", "b", "c"]);
  });

  it("keeps every row when the graph has a cycle", () => {
    const ordered = orderByDependency(["a", "b"], [rel("a", "b", "blocked_by"), rel("b", "a", "blocked_by")]);

    // oxlint-disable-next-line unicorn/no-array-sort -- the array is ours alone; toSorted is ES2023 and this workspace targets earlier
    expect([...ordered].sort()).toEqual(["a", "b"]);
  });

  it("ignores an edge to a row that is not on the chart", () => {
    expect(orderByDependency(["a"], [rel("a", "off-screen", "finish_after")])).toEqual(["a"]);
  });
});
