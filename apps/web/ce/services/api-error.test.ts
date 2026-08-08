/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The boundary every caller in this fork reads a failure through.
 *
 * What it has to get right is the two cases the old `throw error?.response?.data`
 * could not express, and which between them account for most of the "the button
 * did nothing" reports: a request that never reached a server (thrown value was
 * `undefined`) and a proxy answering with an HTML error page (thrown value was a
 * string of markup). Both arrived at a caller written as
 * `(e as { error?: string })?.error ?? "..."`, both produced the fallback, and
 * the fallback is where "Only the project lead can change this." came from on a
 * dropped connection.
 */
import { describe, expect, it } from "vitest";
import { apiErrorMessage, apiErrorStatus, isApiFailure, OFFLINE_MESSAGE, rethrow, toApiFailure } from "./api-error";

/** What axios hands a `.catch` when the server answered. */
const answered = (status: number, data: unknown) => ({ response: { status, data } });

/** What axios hands a `.catch` when nothing answered: no `response` at all. */
const noAnswer = () => ({ request: {}, message: "Network Error" });

describe("toApiFailure", () => {
  it("keeps the server's own body and adds the status", () => {
    const failure = toApiFailure(answered(400, { error: "project_id required", field: "project_id" }));
    expect(failure.error).toBe("project_id required");
    // Endpoint-specific fields survive: callers read their own.
    expect(failure.field).toBe("project_id");
    expect(failure.status).toBe(400);
    expect(failure.offline).toBe(false);
  });

  it("reads a request that never reached a server as offline", () => {
    const failure = toApiFailure(noAnswer());
    expect(failure.offline).toBe(true);
    expect(failure.status).toBeUndefined();
  });

  it("does not spread a proxy's HTML page over the failure", () => {
    // An nginx 502 answers with markup. Spreading a string would produce
    // `{0: "<", 1: "h", …}` and `.error` would still be undefined.
    const failure = toApiFailure(answered(502, "<html><body>502 Bad Gateway</body></html>"));
    expect(failure.status).toBe(502);
    expect(failure.offline).toBe(false);
    expect(failure.error).toBeUndefined();
    expect(failure[0]).toBeUndefined();
  });

  it("does not spread an array body either", () => {
    const failure = toApiFailure(answered(400, ["start_date must precede target_date"]));
    expect(failure.status).toBe(400);
    expect(failure[0]).toBeUndefined();
  });

  it("normalising twice does not turn a refusal into an outage", () => {
    // The one that matters: a normalised failure has no `.response`, so a second
    // pass would read that absence as "never left the browser" and every 403
    // one layer up would be announced as an offline notice.
    const once = toApiFailure(answered(403, { error: "not the lead" }));
    const twice = toApiFailure(once);
    expect(twice).toBe(once);
    expect(twice.status).toBe(403);
    expect(twice.offline).toBe(false);
  });

  it("survives being handed something that is not an error at all", () => {
    for (const raw of [undefined, null, "boom", 42]) {
      const failure = toApiFailure(raw);
      expect(failure.offline).toBe(true);
      expect(failure.status).toBeUndefined();
    }
  });
});

describe("isApiFailure", () => {
  it("recognises its own output and nothing else", () => {
    expect(isApiFailure(toApiFailure(answered(404, {})))).toBe(true);
    expect(isApiFailure({ error: "raw server body" })).toBe(false);
    expect(isApiFailure(undefined)).toBe(false);
  });
});

describe("apiErrorStatus", () => {
  it("carries the status a caller has to branch on", () => {
    // 410 (revoked) and 404 (never existed) are different instructions to the
    // reader, and only the status tells them apart.
    expect(apiErrorStatus(answered(410, {}))).toBe(410);
    expect(apiErrorStatus(answered(404, {}))).toBe(404);
    expect(apiErrorStatus(noAnswer())).toBeUndefined();
  });
});

describe("apiErrorMessage", () => {
  it("prefers what the server said", () => {
    expect(apiErrorMessage(answered(400, { error: "That folder is not empty" }), "fallback")).toBe(
      "That folder is not empty"
    );
  });

  it("accepts DRF's spelling too", () => {
    expect(apiErrorMessage(answered(403, { detail: "You do not have permission" }), "fallback")).toBe(
      "You do not have permission"
    );
  });

  it("says so when nothing answered, rather than falling through to the caller's guess", () => {
    // The whole point. The caller's fallback describes what became of the change
    // ("It stayed where it was."), which is true but says nothing about why —
    // and on a dropped connection the why is the only actionable part.
    expect(apiErrorMessage(noAnswer(), "It stayed where it was.")).toBe(OFFLINE_MESSAGE);
  });

  it("uses the caller's fallback when the server had nothing to say", () => {
    expect(apiErrorMessage(answered(502, "<html>502</html>"), "It stayed where it was.")).toBe(
      "It stayed where it was."
    );
  });

  it("ignores an empty server message", () => {
    expect(apiErrorMessage(answered(400, { error: "   " }), "Nothing was created.")).toBe("Nothing was created.");
  });
});

describe("rethrow", () => {
  it("throws the normalised failure, never the raw rejection", () => {
    expect(() => rethrow(answered(409, { error: "already published" }))).toThrow();
    try {
      rethrow(answered(409, { error: "already published" }));
    } catch (error) {
      expect(isApiFailure(error)).toBe(true);
      expect((error as { status?: number }).status).toBe(409);
    }
  });

  it("throws something readable even when the rejection carried nothing", () => {
    // This is the case that used to throw `undefined`, so `catch (e)` got a value
    // no caller could interrogate.
    try {
      rethrow(noAnswer());
    } catch (error) {
      expect(error).toBeDefined();
      expect((error as { offline?: boolean }).offline).toBe(true);
    }
  });
});
