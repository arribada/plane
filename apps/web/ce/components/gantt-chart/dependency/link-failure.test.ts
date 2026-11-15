/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A refusal that said "the connection dropped".
 *
 * Every rejection of a dependency link reached the reader as the same sentence
 * about loops and networks — on a lead-only plan, that told the person the
 * server had just refused on permissions to check their wifi. Both branches
 * are proved here: a permission refusal names itself and carries the server's
 * own sentence; everything else keeps the loop/offline wording.
 */
import { describe, expect, it } from "vitest";
import { OFFLINE_MESSAGE } from "@/plane-web/services/api-error";
import { describeLinkFailure } from "./link-failure";

const LEAD_ONLY = "This project is set so that only its lead (or a workspace admin) changes the plan.";

describe("describeLinkFailure", () => {
  describe("a permission refusal", () => {
    it("is recognised by its status when one travelled", () => {
      const said = describeLinkFailure({ status: 403, offline: false, error: "Only the lead.", detail: LEAD_ONLY });
      expect(said.permission).toBe(true);
      expect(said.title).toBe("Not yours to link");
      expect(said.message).toBe(LEAD_ONLY);
    });

    it("is recognised on a 401 as well", () => {
      expect(describeLinkFailure({ status: 401, offline: false }).permission).toBe(true);
    });

    it("is recognised by DRF's `detail` when only the body travelled", () => {
      // What `createCurrentRelation` actually rethrows: upstream's service
      // strips the status and hands up `error.response.data` alone.
      const said = describeLinkFailure({ error: "Only the project lead can change the plan.", detail: LEAD_ONLY });
      expect(said.permission).toBe(true);
      expect(said.message).toBe(LEAD_ONLY);
    });

    it("is recognised on an unwrapped axios rejection", () => {
      const said = describeLinkFailure({ response: { status: 403, data: { detail: LEAD_ONLY } } });
      expect(said.permission).toBe(true);
      expect(said.message).toBe(LEAD_ONLY);
    });

    it("still says it is not theirs when the server sent no sentence", () => {
      const said = describeLinkFailure({ status: 403, offline: false });
      expect(said.permission).toBe(true);
      expect(said.message).toMatch(/not yours to edit/);
    });
  });

  describe("everything else", () => {
    it("keeps the loop/offline wording when nothing at all came back", () => {
      // A dropped connection through upstream's service is a thrown `undefined`.
      const said = describeLinkFailure(undefined);
      expect(said.permission).toBe(false);
      expect(said.title).toBe("Couldn't link these two");
      expect(said.message).toMatch(/loop/);
      expect(said.message).toMatch(/connection dropped/);
    });

    it("names the outage when the normalised failure says offline", () => {
      const said = describeLinkFailure({ status: undefined, offline: true });
      expect(said.permission).toBe(false);
      expect(said.message).toBe(OFFLINE_MESSAGE);
    });

    it("carries the server's own sentence for a validation refusal, without blaming permissions", () => {
      const said = describeLinkFailure({ error: "This relation would create a loop." });
      expect(said.permission).toBe(false);
      expect(said.message).toBe("This relation would create a loop.");
    });

    it("does not read a 500 as a permission refusal", () => {
      expect(describeLinkFailure({ status: 500, offline: false }).permission).toBe(false);
    });

    it("survives an HTML page from a proxy", () => {
      const said = describeLinkFailure("<html>502 Bad Gateway</html>");
      expect(said.permission).toBe(false);
      expect(said.message).toMatch(/loop/);
    });
  });
});
