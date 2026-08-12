/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A guard on the harness, not on the app.
 *
 * `vitest.config.ts` pins `process.env.TZ` so the suite runs somewhere other than
 * UTC, and CI runs it twice, once west and once east (see the two-zone loop in
 * `.github/workflows/arribada-build.yml`). That pin is doing real work: at UTC
 * `toISOString().slice(0,10)` agrees with the local calendar, no day is 23 or 25
 * hours long, and roughly every date bug this codebase has had disappears. A suite
 * that quietly fell back to UTC would keep passing and stop asserting.
 *
 * The failure mode being guarded is silent by construction — nothing about a green
 * run tells you which zone it ran in. So it is checked here, as a test, rather than
 * trusted. `process.env.TZ` is assigned in the config's module scope, before any
 * worker is forked; if a future vitest changes how workers inherit their
 * environment, this is what says so.
 */
import { describe, expect, it } from "vitest";

/** A midwinter instant, deliberately in the small hours of UTC: it is a different
 *  CALENDAR DAY either side of Greenwich, which is the whole point. */
const INSTANT = new Date("2026-01-15T02:30:00Z");

const dayIn = (zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    INSTANT
  );

describe("the test run's timezone", () => {
  it("is pinned, so the suite is not silently asserting at UTC", () => {
    expect(process.env.TZ).toBeTruthy();
  });

  it("actually took effect inside the worker, not just in the config process", () => {
    const zone = process.env.TZ;
    if (!zone) throw new Error("TZ is not pinned; the test above says why that matters");

    // What the ambient clock thinks, versus what the declared zone says. These
    // agree only if the pin reached this process. If a worker were still on the
    // runner's UTC while `process.env.TZ` claimed Los Angeles, the ambient answer
    // would be 15 January and the declared one 14 January.
    const ambient = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(INSTANT);

    expect(ambient).toBe(dayIn(zone));

    // And the same question asked of `Date` itself rather than of `Intl`, because
    // it is `Date` that every helper under test actually calls.
    expect(INSTANT.getDate()).toBe(Number(dayIn(zone).slice(-2)));
  });

  it("is a zone where a clock change exists at all", () => {
    // A pin to UTC or to a zone with no summer time would satisfy the checks above
    // and still hide the whole family of bugs this suite exists to catch. Both CI
    // zones observe a transition; so does the local default.
    const january = new Date("2026-01-15T12:00:00Z").getTimezoneOffset();
    const july = new Date("2026-07-15T12:00:00Z").getTimezoneOffset();

    expect(january).not.toBe(july);
  });
});
