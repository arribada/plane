/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The diamond beside a work item's name.
 *
 * A milestone is a quality of the item, not a status somebody has to act on, so
 * it is drawn the way the timeline already draws it — one small filled diamond,
 * the same accent, no badge, no label, no colour of its own. Rare by
 * construction: on a normal list every row renders nothing here, which is what
 * makes the few that do render worth looking at.
 *
 * Nothing marked, nothing drawn — not a hollow outline. An empty affordance on
 * every row would say "every row could be a milestone", and turn a signal into
 * decoration.
 *
 * Written to drop beside any name — it takes a slug, a project and an id and
 * nothing else. The list row is the only caller so far: the kanban card, the
 * spreadsheet row and the calendar block each carry pre-existing lint warnings
 * that block a commit touching them at all, so wiring those is a separate piece
 * of work with a separate risk.
 */
import { Diamond } from "lucide-react";
import { cn } from "@plane/utils";
import { useProjectMilestones } from "@/plane-web/components/gantt-chart/use-project-milestones";
import { MILESTONE_KIND_HINT, MILESTONE_KIND_LABEL } from "./kinds";

type Props = {
  workspaceSlug: string | undefined;
  projectId: string | null | undefined;
  issueId: string;
  className?: string;
};

export function WorkItemMilestoneMarker(props: Props) {
  const { workspaceSlug, projectId, issueId, className } = props;
  // The same per-project fetch the timeline uses, and the same module-scope
  // cache: a list of two hundred rows costs one request, and a mark made on the
  // timeline is already true here.
  const milestones = useProjectMilestones(workspaceSlug, projectId ?? undefined);
  const kind = milestones[issueId]?.kind;

  if (!kind) return null;

  return (
    <span
      className={cn("inline-flex flex-shrink-0 items-center text-accent-primary", className)}
      title={`${MILESTONE_KIND_LABEL[kind]} — ${MILESTONE_KIND_HINT[kind].toLowerCase()}`}
    >
      <Diamond className="size-3 fill-current" />
    </span>
  );
}
