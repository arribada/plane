/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "je vois pas ce que fait le critical path."
 *
 * The computation was fine. The screen said nothing — the chain existed only as
 * the colour of a dependency arrow, so a project with no links (which is most of
 * them here: MARLIN had 0 relations across 77 dated items) drew nothing at all.
 * Four different situations produced the same blank chart, and there is a
 * different thing to DO about each of them.
 *
 * These tests pin the sentence, because the sentence is the fix.
 */
import { describe, expect, it } from "vitest";
import { criticalPathMessage } from "./critical-path-banner";
import type { TCriticalPathDiagnostics } from "@/plane-web/types/arribada";

const diagnostics = (overrides: Partial<TCriticalPathDiagnostics>): TCriticalPathDiagnostics => ({
  status: "ok",
  dated_count: 77,
  undated_count: 0,
  relation_count: 0,
  usable_relation_count: 0,
  linked_count: 0,
  cycle_count: 0,
  critical_count: 0,
  ...overrides,
});

describe("criticalPathMessage", () => {
  it("names the chain and what marks it when there is one", () => {
    const message = criticalPathMessage(
      diagnostics({ status: "ok", critical_count: 7, usable_relation_count: 9, linked_count: 12 }),
      7
    );
    expect(message.text).toContain("7 work items with no room to slip");
    expect(message.hint).toContain("Outlined in red");
    expect(message.hint).toContain("9 dependencies");
    expect(message.tone).toBe("info");
  });

  it("counts what the chart is actually marking, not what the server computed", () => {
    // The two can differ — the client derives the chain from zero total float
    // rather than from the longest-path walk. Reporting the server's number
    // beside a different number of red rings is how a reader stops trusting it.
    const message = criticalPathMessage(diagnostics({ status: "ok", critical_count: 20 }), 7);
    expect(message.text).toContain("7 work items");
    expect(message.text).not.toContain("20");
  });

  it("says a dependency-free project has no critical path, and how to get one", () => {
    const message = criticalPathMessage(diagnostics({ status: "no_dependencies", dated_count: 77 }), 0);
    expect(message.text).toContain("No dependencies recorded between these 77 dated work items");
    expect(message.text).toContain("no critical path to show");
    expect(message.hint).toContain("blocked by");
    // Not a warning: a project with no links is a normal project, not a fault.
    expect(message.tone).toBe("info");
  });

  it("separates links that cannot be used from links that do not exist", () => {
    const message = criticalPathMessage(
      diagnostics({ status: "dependencies_undated", relation_count: 3, usable_relation_count: 0, undated_count: 5 }),
      0
    );
    expect(message.text).toContain("3 dependencies recorded");
    expect(message.text).toContain("no dates");
    expect(message.hint).toContain("5 work items");
    // Actionable and wrong-looking on the chart, so it earns the warning colour.
    expect(message.tone).toBe("warn");
  });

  it("names a loop rather than drawing nothing", () => {
    const message = criticalPathMessage(diagnostics({ status: "cycles_only", cycle_count: 2 }), 0);
    expect(message.text).toContain("2 work items depend on each other in a loop");
    expect(message.hint).toContain("Remove one of the links");
    expect(message.tone).toBe("warn");
  });

  it("says when nothing is dated at all", () => {
    const message = criticalPathMessage(diagnostics({ status: "no_dated_items", dated_count: 0 }), 0);
    expect(message.text).toContain("start and an end date");
    expect(message.hint).toContain("Give the work items dates");
    expect(message.tone).toBe("info");
  });

  it("says nothing at all about a status this build does not know", () => {
    // A newer server. Asserting something wrong is worse than staying quiet.
    const unknown = { ...diagnostics({}), status: "something_new" } as unknown as TCriticalPathDiagnostics;
    expect(criticalPathMessage(unknown, 0).text).toBe("");
  });

  it("uses the singular where a count is one", () => {
    expect(criticalPathMessage(diagnostics({ status: "ok", critical_count: 1 }), 1).text).toContain("1 work item with");
    expect(criticalPathMessage(diagnostics({ status: "no_dependencies", dated_count: 1 }), 0).text).toContain(
      "1 dated work item"
    );
  });
});
