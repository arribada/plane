/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The "Sync now" toast names what the run refused to do, not only what it did.
 */
import { describe, expect, it } from "vitest";
import { TOAST_TYPE } from "@plane/propel/toast";
import { githubSyncToast } from "./sync-toast";

describe("githubSyncToast", () => {
  it("reads green when everything it fetched found a home", () => {
    const out = githubSyncToast({ created: 2, updated: 1, fetched: 9 });
    expect(out.type).toBe(TOAST_TYPE.SUCCESS);
    expect(out.title).toBe("2 new, 1 updated");
    expect(out.message).toBe("9 open issues read from GitHub.");
  });

  it("names an item left in place when its repo now belongs to another project, and is not green", () => {
    const out = githubSyncToast({
      created: 0,
      updated: 0,
      fetched: 3,
      relocation_refused: [{ issue: "arribada/marlin#17", item: "ALPHA-17", claimed_by: "BRAVO" }],
    });
    expect(out.type).toBe(TOAST_TYPE.WARNING);
    expect(out.message).toContain("1 item left in place although the repo moved (ALPHA-17 → BRAVO)");
  });

  it("stays green when the list is present but empty", () => {
    const out = githubSyncToast({ created: 0, updated: 0, fetched: 0, relocation_refused: [] });
    expect(out.type).toBe(TOAST_TYPE.SUCCESS);
    expect(out.message).not.toContain("left in place");
  });
});
