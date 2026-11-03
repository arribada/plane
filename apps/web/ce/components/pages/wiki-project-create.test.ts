/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { OFFLINE_MESSAGE } from "@/plane-web/services/api-error";
import { wikiCreateFailureMessage } from "./wiki-project-create";

describe("wikiCreateFailureMessage", () => {
  it("says the request never left when the tab is offline", () => {
    expect(wikiCreateFailureMessage({ offline: true })).toBe(OFFLINE_MESSAGE);
  });

  it("names the identifier rule rather than a generic refusal", () => {
    expect(wikiCreateFailureMessage({ offline: false, status: 400, error: "identifier_not_letters" })).toMatch(
      /2 to 10 capital letters/
    );
  });

  it("passes the wiki's own sentence through for a code it has no sentence for", () => {
    expect(
      wikiCreateFailureMessage({
        offline: false,
        status: 403,
        error: "forbidden",
        message: "You do not have permission to create pages here.",
      })
    ).toBe("You do not have permission to create pages here.");
  });

  it("never claims something was created when nothing answered", () => {
    expect(wikiCreateFailureMessage(undefined)).toBe("The wiki did not answer.");
    expect(wikiCreateFailureMessage({ offline: false, status: 502, error: "wiki_unreachable" })).toMatch(
      /Nothing was created/
    );
  });
});
