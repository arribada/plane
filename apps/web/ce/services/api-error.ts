/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a caller is given when one of our requests fails.
 *
 * Every method on ArribadaService used to end `.catch((e) => { throw e?.response?.data })`,
 * which is fine for a 400 carrying `{"error": "..."}` and useless for anything
 * else. A dropped connection has no `response` at all, so the thrown value was
 * `undefined`; an nginx 502 answers with an HTML page, so it was a string of
 * markup. Both arrived at callers written as
 * `(error as { error?: string })?.error ?? "generic fallback"`, and both produced
 * the generic fallback — which is why a lead on bad wifi was told they were not
 * the lead, and a funder holding a valid link was told it did not exist.
 *
 * So the boundary normalises instead. The server's payload is still spread out
 * flat, so every existing `.error` read keeps working unchanged; what is added is
 * the two things nobody could see before — the STATUS, and whether the request
 * reached a server at all.
 */

/**
 * A failed request, in the shape callers already read.
 *
 * The server's own JSON body is spread in first, so `error`, `detail` and any
 * endpoint-specific field survive; `status` and `offline` are then set from the
 * transport and win over a body that happened to use those names.
 */
export type TApiFailure = {
  /** What the server answered with. Undefined when nothing answered. */
  status?: number;
  /** The request never reached a server: dropped connection, DNS, offline tab. */
  offline: boolean;
  /** The server's own message, when it sent one. */
  error?: string;
  /** DRF's spelling of the same thing. */
  detail?: string;
  [key: string]: unknown;
};

/** Said to a person, so it names the cause and what became of their change. */
export const OFFLINE_MESSAGE = "You appear to be offline — the request never reached the server.";

/**
 * True for something this module already produced.
 *
 * Needed because a normalised failure has no `.response`, and re-normalising one
 * would read that absence as "the request never left the browser" — turning every
 * 403 into an offline notice one layer up.
 */
export const isApiFailure = (raw: unknown): raw is TApiFailure =>
  typeof raw === "object" && raw !== null && typeof (raw as { offline?: unknown }).offline === "boolean";

/** An axios rejection — or anything at all — as one predictable object. */
export const toApiFailure = (raw: unknown): TApiFailure => {
  if (isApiFailure(raw)) return raw;
  const rejection = raw as { response?: { status?: number; data?: unknown } } | null | undefined;
  const response = rejection?.response;
  const data = response?.data;
  // Only a JSON object is worth spreading. A 502 from a proxy answers with an
  // HTML string, and a list endpoint can answer with an array; neither carries
  // fields a caller can read, and spreading them would produce `{0: "<"}`.
  const body = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as TApiFailure) : {};
  return { ...body, status: response?.status, offline: !response };
};

/** The HTTP status, or undefined when the request never got one. */
export const apiErrorStatus = (raw: unknown): number | undefined => toApiFailure(raw).status;

/**
 * The sentence to put in front of a person.
 *
 * `fallback` is what the caller wants said when the server had nothing to add —
 * it should state what became of the change ("It stayed where it was."), because
 * that is the part a generic HTTP message can never supply.
 */
export const apiErrorMessage = (raw: unknown, fallback: string): string => {
  const failure = toApiFailure(raw);
  if (failure.offline) return OFFLINE_MESSAGE;
  for (const candidate of [failure.error, failure.detail, failure.message]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return fallback;
};

/**
 * The single `.catch` every service method ends with.
 *
 * Written as a function reference rather than inline so the 100-odd call sites
 * cannot drift apart again, and so the one method that needs the status
 * (`getPublicTimeline`) gets it from the same place as everyone else.
 */
export const rethrow = (raw: unknown): never => {
  throw toApiFailure(raw);
};
