/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The gantt asks for the baseline once, not twice.
 *
 * `BaselinePicker` wants the list of snapshots and the ghost-bar overlay wants
 * the entries of the selected one. Both come back in the same payload from the
 * same endpoint, and both components mount in the same commit — so the chart made
 * the identical request twice on every mount. The comments in both files already
 * said "same request"; nothing made that true at runtime.
 *
 * The two things worth pinning are opposites, and both matter: concurrent callers
 * share, and a LATER caller does not. A cache with a lifetime here is how a
 * freshly captured baseline comes back missing from the picker that captured it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBaseline } = vi.hoisted(() => ({ getBaseline: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getBaseline = getBaseline;
  },
}));

const { getBaselineShared } = await import("./baseline-request");

const PAYLOAD = { baselines: [], selected: null, entries: [] };

beforeEach(() => {
  getBaseline.mockReset();
  getBaseline.mockResolvedValue(PAYLOAD);
});

describe("getBaselineShared", () => {
  it("makes one request for two callers in the same tick", async () => {
    const [a, b] = await Promise.all([getBaselineShared("arribada", "gps"), getBaselineShared("arribada", "gps")]);
    expect(getBaseline).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("asks again once the first request has settled", async () => {
    // A refetch after capturing a snapshot has to reach the server. This is the
    // half that stops the share from becoming a stale cache.
    await getBaselineShared("arribada", "gps");
    await getBaselineShared("arribada", "gps");
    expect(getBaseline).toHaveBeenCalledTimes(2);
  });

  it("does not hand one snapshot's answer to a caller asking for another", async () => {
    await Promise.all([getBaselineShared("arribada", "gps"), getBaselineShared("arribada", "gps", "baseline-2")]);
    expect(getBaseline).toHaveBeenCalledTimes(2);
  });

  it("stops sharing a failed request", async () => {
    getBaseline.mockRejectedValueOnce(new Error("502"));
    await expect(getBaselineShared("arribada", "gps")).rejects.toThrow("502");
    await getBaselineShared("arribada", "gps");
    expect(getBaseline).toHaveBeenCalledTimes(2);
  });
});
