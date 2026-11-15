/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What to say when a dependency could not be linked.
 *
 * The handle used to answer every rejection with "It may create a loop, or the
 * connection dropped." — which, on a lead-only plan, told somebody the server had
 * just refused on permissions that their network was flaky. The refusal carries
 * its own sentence (`plan_guard.py` answers 403 with `error` and `detail`), and
 * the one thing a person needs to know is whether to try again or to ask the
 * lead.
 *
 * Two shapes arrive here, because the two layers above do not agree:
 *
 *  * `createCurrentRelation` rethrows what `IssueRelationService` threw, which is
 *    upstream's `error?.response?.data` — the BODY alone. A 403 is `{error,
 *    detail}` with no status; a dropped connection is `undefined`; an nginx 502
 *    is a string of HTML. There is no status to read, so a permission refusal is
 *    recognised by DRF's `detail` field, which it reserves for authentication,
 *    permission, not-found and throttle answers.
 *  * Anything that went through `ce/services/api-error.ts` is a `TApiFailure`
 *    with `status` and `offline`, and those are read first because they are the
 *    better evidence.
 */
import { OFFLINE_MESSAGE, isApiFailure } from "@/plane-web/services/api-error";

export type TLinkFailure = { title: string; message: string; permission: boolean };

const GENERIC = "The dependency wasn't saved. It may create a loop, or the connection dropped.";
const NOT_YOURS = "This plan is not yours to edit, so the dependency was not saved.";

const sentenceIn = (body: Record<string, unknown> | null): string | undefined => {
  if (!body) return undefined;
  for (const key of ["detail", "error", "message"]) {
    const candidate = body[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
};

export const describeLinkFailure = (raw: unknown): TLinkFailure => {
  // The normalised shape first: a status is better evidence than a field name.
  if (isApiFailure(raw)) {
    if (raw.status === 401 || raw.status === 403) {
      return { title: "Not yours to link", message: sentenceIn(raw) ?? NOT_YOURS, permission: true };
    }
    if (raw.offline) return { title: "Couldn't link these two", message: OFFLINE_MESSAGE, permission: false };
    return { title: "Couldn't link these two", message: sentenceIn(raw) ?? GENERIC, permission: false };
  }

  // An axios rejection that nobody unwrapped.
  const response = (raw as { response?: { status?: number; data?: unknown } } | null | undefined)?.response;
  if (response) {
    const data = response.data;
    const body =
      data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (response.status === 401 || response.status === 403) {
      return { title: "Not yours to link", message: sentenceIn(body) ?? NOT_YOURS, permission: true };
    }
    return { title: "Couldn't link these two", message: sentenceIn(body) ?? GENERIC, permission: false };
  }

  // The body alone, as upstream's services throw it. `detail` is DRF's word for
  // an authentication or permission refusal; a validation error — a loop, a
  // cross-project link — answers with `error` and no `detail`.
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (typeof body?.detail === "string" && body.detail.trim() !== "") {
    return { title: "Not yours to link", message: body.detail, permission: true };
  }
  return { title: "Couldn't link these two", message: sentenceIn(body) ?? GENERIC, permission: false };
};
