/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Whether this work item is a milestone, from the work item itself.
 *
 * The mark already existed, but the only way to make one was the diamond in the
 * timeline sidebar. That is the right place for a pass down a whole plan; it is
 * the wrong and only place for the far commoner moment — somebody is looking at
 * one work item and realises it is the thing a funder is waiting for. So the
 * same fact gets a property row, next to the other properties of the work.
 *
 * A kind rather than a flag, because the three behave differently for the reader
 * of a plan: a delivery is handed over, a gate blocks what follows it, a review
 * is a decision. The timeline already draws them; this is where they are chosen.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { Diamond, Loader2 } from "lucide-react";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import {
  invalidateProjectMilestones,
  useProjectMilestones,
  type TMilestoneKind,
} from "@/plane-web/components/gantt-chart/use-project-milestones";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { MILESTONE_KINDS, MILESTONE_KIND_HINT, MILESTONE_KIND_LABEL } from "./kinds";

const service = new ArribadaService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isEditable: boolean;
};

export const IssueMilestoneField = observer(function IssueMilestoneField(props: Props) {
  const { workspaceSlug, projectId, issueId, isEditable } = props;
  const milestones = useProjectMilestones(workspaceSlug, projectId);
  const [busy, setBusy] = useState(false);
  // What was just chosen, until the shared cache has caught up. Invalidating it
  // refetches the whole project, and for those few hundred milliseconds the
  // select would otherwise snap back to the answer that was just replaced.
  const [override, setOverride] = useState<TMilestoneKind | null | undefined>(undefined);

  const stored = milestones[issueId]?.kind ?? null;
  const current = override === undefined ? stored : override;

  const commit = async (raw: string) => {
    const next = (raw || null) as TMilestoneKind | null;
    if (next === current) return;
    setOverride(next);
    setBusy(true);
    try {
      await service.setProjectMilestone(workspaceSlug, projectId, issueId, next);
      // The timeline and every marker beside a name read the same cache; without
      // this the diamond does not appear until a reload.
      invalidateProjectMilestones(workspaceSlug, projectId);
    } catch (error) {
      setOverride(undefined);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't change the milestone",
        message: (error as { error?: string })?.error ?? "It was not changed.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidebarPropertyListItem icon={Diamond} label="Milestone">
      <div className="flex w-full items-center gap-1.5">
        <select
          disabled={!isEditable || busy}
          value={current ?? ""}
          onChange={(e) => void commit(e.target.value)}
          aria-label="Whether this work item is a milestone, and of what kind"
          title={current ? MILESTONE_KIND_HINT[current] : "Ordinary work item"}
          className={cn(
            "min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-body-xs-regular outline-none",
            current ? "text-primary" : "text-tertiary",
            isEditable && "hover:border-subtle focus:border-accent-strong"
          )}
        >
          <option value="">Not a milestone</option>
          {MILESTONE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {MILESTONE_KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        {busy && <Loader2 className="size-3 shrink-0 animate-spin text-tertiary" />}
      </div>
    </SidebarPropertyListItem>
  );
});
