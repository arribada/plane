/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which baseline the picker is showing, and whether it belongs to this project.
 *
 * The bug: `selectedBaselineId` is one field on a store that is a singleton per
 * timeline TYPE, not per project. Choosing "PDR January 2026" on one project and
 * walking to another carried the id across. The server answers an unknown
 * `?baseline=` by falling back to the newest, so the ghost bars were right and
 * the label was wrong — the `<select>` held a value matching none of its options,
 * so it rendered blank and lost its tooltip and its delete button with it.
 */
import { describe, expect, it } from "vitest";
import { resolveBaselineSelection } from "./baseline-selection";

const snapshots = [{ id: "march" }, { id: "january" }];

describe("resolveBaselineSelection", () => {
  it("shows the newest when nothing has been chosen", () => {
    // The list is ordered -captured_at server-side, so the first IS the newest —
    // which is also what the server draws with no parameter, so the picker and
    // the ghost bars agree by construction.
    expect(resolveBaselineSelection("", snapshots)).toEqual({ selected: "march", stale: false });
    expect(resolveBaselineSelection(null, snapshots)).toEqual({ selected: "march", stale: false });
  });

  it("keeps a choice this project actually has", () => {
    expect(resolveBaselineSelection("january", snapshots)).toEqual({ selected: "january", stale: false });
  });

  it("treats another project's snapshot id as no choice at all, and says it is stale", () => {
    expect(resolveBaselineSelection("someone-elses", snapshots)).toEqual({ selected: "march", stale: true });
  });

  it("treats a deleted snapshot the same way", () => {
    expect(resolveBaselineSelection("march", [{ id: "january" }])).toEqual({ selected: "january", stale: true });
  });

  it("selects nothing on a project that has never been baselined", () => {
    expect(resolveBaselineSelection("", [])).toEqual({ selected: "", stale: false });
    expect(resolveBaselineSelection("march", [])).toEqual({ selected: "", stale: true });
  });
});
