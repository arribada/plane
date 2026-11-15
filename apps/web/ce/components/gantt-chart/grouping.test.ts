/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a band says about itself: when it runs and how long.
 *
 * The header reads `start` and `end` back with LOCAL getters and positions its
 * brace against the chart's local-midnight `Date`s. They used to be built with
 * `new Date("2026-09-01")` — UTC midnight — so west of Greenwich the band's
 * first and last day read a day early. The suite runs under America/Los_Angeles
 * by default and Pacific/Auckland on CI (vitest.config.ts), so these assert the
 * calendar day on both sides rather than averaging the difference away.
 */
import { describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { buildGroups, type TGanttGroupResolver } from "./grouping";

const issues: Record<string, Partial<TIssue>> = {
  a: { id: "a", priority: "high", start_date: "2026-09-01", target_date: "2026-09-03" },
  b: { id: "b", priority: "high", start_date: "2026-09-02", target_date: "2026-09-10" },
  c: { id: "c", priority: "low", start_date: null, target_date: null },
};

const resolve: TGanttGroupResolver = {
  getIssue: (id) => issues[id] as TIssue | undefined,
  getModule: () => undefined,
  getLabel: () => undefined,
  getMemberName: () => undefined,
  getState: () => undefined,
  getCycle: () => undefined,
};

describe("a band's dates", () => {
  const high = buildGroups(["a", "b", "c"], "priority", resolve).find((group) => group.key === "high");

  it("start on the calendar day the first item starts, whatever the reader's zone", () => {
    expect(high?.start?.getFullYear()).toBe(2026);
    expect(high?.start?.getMonth()).toBe(8);
    expect(high?.start?.getDate()).toBe(1);
  });

  it("end on the calendar day the last item ends, whatever the reader's zone", () => {
    expect(high?.end?.getMonth()).toBe(8);
    expect(high?.end?.getDate()).toBe(10);
  });

  it("are local midnights, so the brace lands in the chart's own columns", () => {
    expect(high?.start?.getTime()).toBe(new Date(2026, 8, 1).getTime());
    expect(high?.end?.getTime()).toBe(new Date(2026, 8, 10).getTime());
  });

  it("count the calendar days inclusive of both ends", () => {
    expect(high?.days).toBe(10);
  });

  it("are null for a band with nothing dated", () => {
    const low = buildGroups(["c"], "priority", resolve).find((group) => group.key === "low");
    expect(low?.start).toBeNull();
    expect(low?.end).toBeNull();
    expect(low?.days).toBe(0);
  });
});
