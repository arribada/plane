/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A red banner at the top of a work item when it is blocked by others, so an
 * engineer sees "you can't start this yet" without hunting in a collapsed widget.
 */
import { observer } from "mobx-react";
import { Ban } from "lucide-react";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

export const BlockedByBanner = observer(function BlockedByBanner({ issueId }: { issueId: string }) {
  const {
    relation: { getRelationByIssueIdRelationType },
  } = useIssueDetail();
  const blockers = getRelationByIssueIdRelationType(issueId, "blocked_by") ?? [];
  if (blockers.length === 0) return null;

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md border border-danger-strong/30 bg-danger-subtle px-3 py-2 text-13 text-danger-primary">
      <Ban className="size-4 flex-shrink-0" />
      <span>
        Blocked by <b>{blockers.length}</b> work item{blockers.length > 1 ? "s" : ""} — finish those first. See the
        Relations section below.
      </span>
    </div>
  );
});
