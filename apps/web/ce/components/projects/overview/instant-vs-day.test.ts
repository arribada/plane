/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The one-day error, pinned from both sides of the planet.
 *
 * `renderFormattedDate` reads the first ten characters of its argument as a day
 * and pins them to local midnight. For a Django `DateField` that is exactly
 * right — an invoice dated the 12th is dated the 12th everywhere, and putting an
 * offset through it is how it would stop being. For a `DateTimeField` those ten
 * characters are the UTC day, so the same call renders a status posted at 7:30pm
 * in California as the following morning.
 *
 * Nothing about that failure is visible in UTC, and UTC is what a CI runner and
 * most laptops in this organisation are set to. `vitest.config.ts` therefore
 * defaults the suite to `America/Los_Angeles`; this file additionally pins BOTH
 * ends of the range itself, because the two zones fail in OPPOSITE directions
 * and a fix that only ever gets exercised west of Greenwich is half tested.
 *
 * The three claims, and they have to hold together:
 *
 *   * an instant read as an instant is the READER'S day, wherever they are;
 *   * an instant read as a day is UTC's day, which is the bug;
 *   * a plain day is the SAME day in every zone, so the fix must not have been
 *     "put renderFormattedInstant everywhere".
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { renderFormattedDate, renderFormattedInstant } from "@plane/utils";
import type { TProcurementRequest } from "@/plane-web/types/arribada";
import { buildBudgetCsv } from "./budget-export";

/**
 * TZ before the imports, not merely at the top of the file.
 *
 * `import` declarations are hoisted and evaluated ahead of every statement in an
 * ES module, so a bare `process.env.TZ = …` written above them still runs after
 * them. `vi.hoisted` is the one thing vitest lifts higher than the imports it
 * rewrites, which is what makes this land before anything under test has had a
 * chance to read the zone at module scope — and it is why this sits below the
 * import block in source order rather than above it.
 *
 * Set explicitly rather than inherited so this file is self-contained: workers
 * are reused across test files, `process.env` is per PROCESS, and a suite whose
 * western case depends on nobody else having touched the variable first is a
 * suite that fails by file ordering. The inherited value is captured and put
 * back in `afterAll` for exactly the same reason, in the other direction.
 */
const INHERITED_TZ = vi.hoisted(() => {
  const inherited = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  return inherited;
});

afterAll(() => {
  if (INHERITED_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = INHERITED_TZ;
});

/**
 * Read something in a named zone and put the zone back.
 *
 * Assigning `process.env.TZ` re-arms V8's timezone cache on every platform this
 * repo is developed on, Windows included — the same mechanism `vitest.config.ts`
 * relies on. `finally`, so a failing expectation inside the callback cannot
 * leave the process in Samoa for whatever runs next.
 */
const inZone = <T>(zone: string, read: () => T): T => {
  const previous = process.env.TZ ?? "UTC";
  process.env.TZ = zone;
  try {
    return read();
  } finally {
    process.env.TZ = previous;
  }
};

/** A `DateTimeField` value: 2:30am UTC on the 13th, which is the evening of the
 *  12th for a reader in California and mid-afternoon on the 13th in Samoa. */
const EARLY_UTC = "2026-08-13T02:30:00Z";

/** The mirror case. 8pm UTC on the 12th is still the 12th in California and is
 *  already 9am on the 13th in Samoa — so the naive reading is a day EARLY here,
 *  where above it was a day late. */
const LATE_UTC = "2026-08-12T20:00:00Z";

/** A `DateField` value. No time, no offset, no opinion about anybody's zone. */
const PLAIN_DAY = "2026-08-13";

/** UTC+13 in August 2026: Samoa dropped daylight saving in 2021, so this is a
 *  fixed offset rather than one that depends on when the suite is run.
 *  `Pacific/Auckland` would be UTC+12 in August and would not reach far enough
 *  east to flip the date on `LATE_UTC`. */
const SAMOA = "Pacific/Apia";
const CALIFORNIA = "America/Los_Angeles";

/** Zones that must all agree about a plain day, from UTC-7 to UTC+13 with a
 *  half-hour offset in the middle for good measure. */
const EVERYWHERE = [CALIFORNIA, "UTC", "Europe/Berlin", "Asia/Kolkata", "Pacific/Auckland", SAMOA];

describe("an instant, read west of Greenwich (America/Los_Angeles, UTC-7)", () => {
  it("renderFormattedInstant gives the reader their own calendar day", () => {
    // 02:30 UTC on the 13th is 19:30 on the 12th in California. The 12th is the
    // day that person was actually living in, and the only day they can check
    // the claim against.
    expect(inZone(CALIFORNIA, () => renderFormattedInstant(EARLY_UTC))).toBe("Aug 12, 2026");
  });

  it("renderFormattedDate gives UTC's day instead — this IS the bug", () => {
    // Pinned rather than fixed. `renderFormattedDate` is correct for the plain
    // days it was written for, so its behaviour here is not something to change;
    // what has to be true is that the wrong choice of helper is visibly wrong,
    // and that this file says so out loud next to the right one.
    expect(inZone(CALIFORNIA, () => renderFormattedDate(EARLY_UTC))).toBe("Aug 13, 2026");
  });
});

describe("an instant, read east of Greenwich (Pacific/Apia, UTC+13)", () => {
  it("renderFormattedInstant gives the reader their own calendar day", () => {
    // 20:00 UTC on the 12th is 09:00 on the 13th in Samoa.
    expect(inZone(SAMOA, () => renderFormattedInstant(LATE_UTC))).toBe("Aug 13, 2026");
  });

  it("renderFormattedDate is a day EARLY here, where in California it was a day late", () => {
    // The reason "just add a day" is not a fix and the reason this test exists:
    // the error changes sign at Greenwich, so any correction that is not an
    // actual zone conversion is wrong for half the readers either way.
    expect(inZone(SAMOA, () => renderFormattedDate(LATE_UTC))).toBe("Aug 12, 2026");
  });

  it("agrees with the western reader about the instant, and disagrees about the day", () => {
    // The same moment, two calendars. Both answers are right; that is the whole
    // point of formatting an instant locally rather than picking one zone.
    expect(inZone(CALIFORNIA, () => renderFormattedInstant(EARLY_UTC))).toBe("Aug 12, 2026");
    expect(inZone(SAMOA, () => renderFormattedInstant(EARLY_UTC))).toBe("Aug 13, 2026");
  });
});

describe("a plain day is the same day everywhere", () => {
  it("renderFormattedDate never moves a DateField, in any zone", () => {
    // The guard on the other half of the change. `incurred_on`, `needed_by`,
    // `ordered_on`, `expected_on`, `received_on`, `start_date`, `target_date`
    // and `rate_captured_on` are all DateFields and all stayed on this function;
    // if a later sweep "fixes" them too, this is what fails.
    for (const zone of EVERYWHERE) {
      expect(inZone(zone, () => renderFormattedDate(PLAIN_DAY))).toBe("Aug 13, 2026");
    }
  });

  it("renderFormattedInstant also leaves a bare day alone", () => {
    // `parseISO` reads a date-only string as LOCAL midnight, not UTC midnight —
    // so the asymmetry between the two mistakes is worth knowing: an instant
    // sent through renderFormattedDate is wrong for most of the planet, while a
    // plain day sent through renderFormattedInstant still reads correctly. Only
    // one of the two directions can silently ship.
    for (const zone of EVERYWHERE) {
      expect(inZone(zone, () => renderFormattedInstant(PLAIN_DAY))).toBe("Aug 13, 2026");
    }
  });
});

describe("renderFormattedInstant keeps renderFormattedDate's contract", () => {
  it("answers undefined for nothing at all", () => {
    expect(renderFormattedInstant(null)).toBeUndefined();
    expect(renderFormattedInstant(undefined)).toBeUndefined();
    expect(renderFormattedInstant("")).toBeUndefined();
  });

  it("answers undefined for a string that is not a date, rather than 'Invalid Date'", () => {
    expect(renderFormattedInstant("not-a-date")).toBeUndefined();
  });

  it("takes a Date without throwing", () => {
    // `parseISO` is string-only and dies on `dateString.split` when handed a
    // Date, so the type split inside the helper is load-bearing rather than
    // tidiness. A Date is already an instant and passes straight through.
    expect(inZone(CALIFORNIA, () => renderFormattedInstant(new Date(Date.UTC(2026, 7, 13, 2, 30))))).toBe(
      "Aug 12, 2026"
    );
  });

  it("honours a format token and falls back rather than throwing on a bad one", () => {
    expect(inZone(CALIFORNIA, () => renderFormattedInstant(EARLY_UTC, "yyyy-MM-dd"))).toBe("2026-08-12");
    // date-fns throws on a reserved token; the caller gets the default format
    // rather than an exception thrown out of a render.
    expect(inZone(CALIFORNIA, () => renderFormattedInstant(EARLY_UTC, "YYYY-MM-DD"))).toBe("Aug 12, 2026");
  });
});

describe("the budget CSV, as a reader in California downloads it", () => {
  /** Enough of a decided purchase request to reach the "Decided at" column. */
  const request = {
    id: "req-1",
    category: "hardware",
    label: "10 Linkit boards",
    amount: 120,
    quantity: 10,
    total: 1200,
    currency: "GBP",
    status: "approved",
    supplier: "Acme",
    needed_by: "2026-09-01",
    decided_by_name: "Nadia",
    decided_at: EARLY_UTC,
    decision_note: "",
    justification: "",
  } as unknown as TProcurementRequest;

  const build = () => buildBudgetCsv([], [request], { projectName: "Turtles", displayCurrency: "" });

  it("writes the decision in the reader's zone, never the raw UTC timestamp", () => {
    const csv = inZone(CALIFORNIA, build);

    expect(csv).toContain("2026-08-12 19:30");
    // The shape that used to go out: an ISO instant sitting in a column of plain
    // days, reading as the 13th to somebody reconciling it against a statement.
    expect(csv).not.toContain(EARLY_UTC);
    expect(csv).not.toContain("2026-08-13");
  });

  it("names the zone in the header rows, so two exports cannot silently disagree", () => {
    const csv = inZone(CALIFORNIA, build);

    expect(csv).toContain('# "Decided at" is a moment in time, shown in');
  });

  it("says nothing about zones when no request has been decided", () => {
    // A caveat about an empty column is noise, and this file's whole idiom is
    // that a header row is a promise about what is actually below it.
    const undecided = { ...request, decided_at: null, decided_by_name: null } as unknown as TProcurementRequest;
    const csv = buildBudgetCsv([], [undecided], { projectName: "Turtles", displayCurrency: "" });

    expect(csv).not.toContain("is a moment in time");
  });
});
