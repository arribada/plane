/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The decisions behind the critical-path picture.
 *
 * What these prove: which link is loud and which recedes, which row is drawn as
 * on-chain, what the banner's dates are, and that the date does not shift by a
 * day west of Greenwich. What they do NOT prove: that the result is legible.
 * "Twenty of forty bars ringed is not a highlight" is a judgement about a screen
 * and it is why this exists at all — it cannot be re-checked here.
 */
import { describe, expect, it } from "vitest";
import { chainSpan, formatChainDate, linkEmphasis, rowEmphasis } from "./critical-path";

describe("linkEmphasis", () => {
  const base = { related: false, pointing: false, onChain: false, focused: false };

  it("leaves everything at its resting weight when nothing is being asked", () => {
    expect(linkEmphasis(base)).toBe("resting");
    expect(linkEmphasis({ ...base, onChain: true })).toBe("resting");
  });

  it("lights the links touching the block under the pointer, and quiets the rest", () => {
    expect(linkEmphasis({ ...base, pointing: true, related: true })).toBe("loud");
    expect(linkEmphasis({ ...base, pointing: true })).toBe("quiet");
  });

  it("makes the chain the subject when the chain is focused", () => {
    expect(linkEmphasis({ ...base, focused: true, onChain: true })).toBe("loud");
    expect(linkEmphasis({ ...base, focused: true })).toBe("quiet");
  });

  it("lets the pointer win over the mode", () => {
    // Pointing at one bar asks "what does THIS wait on". That question has to be
    // answerable while the chain is focused, or the mode takes the chart's most
    // useful interaction away in exchange for a highlight.
    expect(linkEmphasis({ related: true, pointing: true, onChain: false, focused: true })).toBe("loud");
    // …and an off-chain link that is NOT the one being pointed at stays quiet
    // rather than being promoted by the pointer being somewhere else entirely.
    expect(linkEmphasis({ related: false, pointing: true, onChain: true, focused: true })).toBe("quiet");
  });
});

describe("rowEmphasis", () => {
  it("says nothing about an off-chain row until the chain is focused", () => {
    expect(rowEmphasis(false, false)).toBe("plain");
    expect(rowEmphasis(false, true)).toBe("float");
  });

  it("marks an on-chain row either way", () => {
    expect(rowEmphasis(true, false)).toBe("chain");
    expect(rowEmphasis(true, true)).toBe("chain");
  });
});

describe("chainSpan", () => {
  const dates: Record<string, { start_date?: string | null; target_date?: string | null }> = {
    a: { start_date: "2026-03-04", target_date: "2026-03-20" },
    b: { start_date: "2026-02-11", target_date: "2026-03-01" },
    c: { start_date: "2026-05-06", target_date: "2026-07-18" },
    undated: { start_date: null, target_date: null },
    "one-day": { start_date: "2026-08-30", target_date: null },
  };
  const datesOf = (id: string) => dates[id];

  it("spans from the earliest start to the latest end", () => {
    expect(chainSpan(["a", "b", "c"], datesOf)).toEqual({ start: "2026-02-11", end: "2026-07-18", dated: 3 });
  });

  it("skips items with no dates rather than reporting a chain that starts nowhere", () => {
    expect(chainSpan(["a", "undated"], datesOf)).toEqual({ start: "2026-03-04", end: "2026-03-20", dated: 1 });
  });

  it("treats a one-ended item as a point in time", () => {
    expect(chainSpan(["one-day"], datesOf)).toEqual({ start: "2026-08-30", end: "2026-08-30", dated: 1 });
  });

  it("is null when nothing on the chain is dated, so the banner says nothing about dates", () => {
    expect(chainSpan(["undated"], datesOf)).toBeNull();
    expect(chainSpan([], datesOf)).toBeNull();
    expect(chainSpan(["missing"], datesOf)).toBeNull();
  });

  it("takes a Set, which is what the slack answer actually is", () => {
    expect(chainSpan(new Set(["b", "c"]), datesOf)?.end).toBe("2026-07-18");
  });
});

describe("formatChainDate", () => {
  it("prints the day that is written, not the day a timezone makes of it", () => {
    // `new Date("2026-07-18")` is midnight UTC, so anything west of Greenwich
    // renders it as the 17th. This fork has shipped that bug twice; CI runs this
    // suite under two non-UTC zones for exactly this reason, and the answer here
    // must be identical under all of them because no Date is constructed.
    expect(formatChainDate("2026-07-18")).toBe("18 Jul 2026");
    expect(formatChainDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatChainDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("hands back anything that is not a plain ISO day untouched", () => {
    expect(formatChainDate("")).toBe("");
    expect(formatChainDate("2026-13-01")).toBe("2026-13-01");
    expect(formatChainDate("next Tuesday")).toBe("next Tuesday");
  });
});
