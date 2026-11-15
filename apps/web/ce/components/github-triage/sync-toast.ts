/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What "Sync now" actually did, said once for every button that offers it.
 *
 * The endpoint used to pass through only `created` and `updated`, which count
 * work items written into a project — so a run that captured 39 issues and filed
 * 11 reported "0 created, 0 updated" and read exactly like a run that did
 * nothing. Capturing an issue, leaving one for the triage queue and skipping one
 * somebody dismissed are three other things that happened, and each answers a
 * different worry about whether the button worked.
 *
 * `skipped_no_workspace` is not a number. It is a list of repositories nothing
 * could place, which is a mapping somebody has to go and fix, and it is the one
 * outcome that must not be summarised away.
 */
import { TOAST_TYPE } from "@plane/propel/toast";

type TSyncResult = {
  created: number;
  updated: number;
  fetched: number;
  captured?: number;
  filed?: number;
  queued?: number;
  dismissed_skipped?: number;
  closed_rows?: number;
  closed_items?: number;
  skipped_no_workspace?: string[];
  skipped_partial_fetch?: string[];
  /**
   * Work items the sync would once have moved to a repo's new owner project and
   * now leaves where they are. Each names the GitHub issue, the item, and the
   * project that claimed it, so a person can move it deliberately.
   */
  relocation_refused?: { issue: string; item: string; claimed_by: string }[];
};

export const githubSyncToast = (result: TSyncResult): { type: TOAST_TYPE; title: string; message: string } => {
  const unplaceable = result.skipped_no_workspace ?? [];
  const partial = result.skipped_partial_fetch ?? [];
  const stayed = result.relocation_refused ?? [];
  const closedRows = result.closed_rows ?? 0;
  const closedItems = result.closed_items ?? 0;

  const headline =
    result.created > 0 || result.updated > 0
      ? `${result.created} new, ${result.updated} updated`
      : (result.captured ?? 0) > 0
        ? `${result.captured} issue${result.captured === 1 ? "" : "s"} captured`
        : // A run that only closed things did real work and used to read as
          // "Nothing new", which is the opposite of what just happened.
          closedRows > 0
          ? `${closedRows} closed on GitHub`
          : "Nothing new";

  const parts = [`${result.fetched} open issue${result.fetched === 1 ? "" : "s"} read from GitHub`];
  if ((result.queued ?? 0) > 0) parts.push(`${result.queued} waiting for you in the triage queue`);
  // Named separately from the row count, because one of these two moved somebody's
  // work item and the other only tidied the queue.
  if (closedRows > 0) parts.push(`${closedRows} left the queue as closed`);
  if (closedItems > 0) parts.push(`${closedItems} work item${closedItems === 1 ? "" : "s"} marked done`);
  if ((result.dismissed_skipped ?? 0) > 0) parts.push(`${result.dismissed_skipped} left dismissed`);
  if (partial.length > 0) parts.push(`could not read all of ${partial.join(", ")}`);
  if (unplaceable.length > 0) parts.push(`no workspace for ${unplaceable.join(", ")}`);
  // An item whose repo now belongs to another project stays put rather than
  // being renumbered into the new one; somebody has to decide where it lives.
  if (stayed.length > 0)
    parts.push(
      `${stayed.length} item${stayed.length === 1 ? "" : "s"} left in place although the repo moved (${stayed
        .map((s) => `${s.item} → ${s.claimed_by}`)
        .join(", ")})`
    );

  return {
    // A repo nothing could place is a real problem wearing a success toast, so
    // it is the one case where a completed run does not get to look green. A repo
    // whose list could not be read whole joins it: closures there went unnoticed,
    // and a green toast would say the opposite.
    type: unplaceable.length > 0 || partial.length > 0 || stayed.length > 0 ? TOAST_TYPE.WARNING : TOAST_TYPE.SUCCESS,
    title: headline,
    message: `${parts.join(" · ")}.`,
  };
};
