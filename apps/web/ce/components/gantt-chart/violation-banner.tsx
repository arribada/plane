/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Three of these now start before the thing they depend on."
 *
 * Dragging a bar never consulted the dependencies. It still does not — nothing
 * moves unless somebody asks, which is the same rule the delivery floors follow —
 * but the plan no longer goes quietly inconsistent. A broken link is named as
 * soon as it exists, and the fix is one button away.
 *
 * The alternative was an automatic cascade, and it was rejected for a reason: one
 * drag silently moving twenty tasks is how somebody stops trusting the chart.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { AlertTriangle, Wand2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { invalidateProjectProgress } from "./use-project-progress";
import { invalidateProjectRelations } from "./use-project-relations";
import { invalidateProjectSlack } from "./use-project-slack";

const service = new ArribadaService();

export type TViolation = { from: string; to: string };

type Props = {
  workspaceSlug: string;
  projectId: string;
  violations: TViolation[];
  onFixed?: () => void;
};

export const DependencyViolationBanner = observer(function DependencyViolationBanner({
  workspaceSlug,
  projectId,
  violations,
  onFixed,
}: Props) {
  const [fixing, setFixing] = useState(false);

  if (violations.length === 0) return null;

  const reflow = async () => {
    if (fixing) return;
    setFixing(true);
    try {
      const result = await service.autoSchedule(workspaceSlug, projectId);
      // Everything derived from dates is cached per project; without this the
      // tails and the red arrows keep painting the pre-reflow answer.
      invalidateProjectSlack(workspaceSlug, projectId);
      invalidateProjectRelations(workspaceSlug, projectId);
      invalidateProjectProgress(workspaceSlug, projectId);
      onFixed?.();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `Moved ${result?.rescheduled ?? 0} work ${result?.rescheduled === 1 ? "item" : "items"}`,
        message: "Each one was pushed to the earliest date its dependencies allow. Nothing was pulled earlier.",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't reflow this project",
        message: "No dates were changed.",
      });
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warning-strong/40 bg-warning-subtle/40 px-4 py-1.5 text-12">
      <AlertTriangle className="size-3.5 flex-shrink-0 text-warning-primary" />
      <span className="text-primary">
        {violations.length} {violations.length === 1 ? "work item starts" : "work items start"} before what they depend
        on finishes
      </span>
      <button
        type="button"
        onClick={() => void reflow()}
        disabled={fixing}
        className="flex items-center gap-1 rounded border border-subtle bg-surface-1 px-2 py-1 text-11 text-secondary hover:text-primary disabled:opacity-50"
        title="Push each one to the earliest date its dependencies allow. Never pulls anything earlier."
      >
        <Wand2 className="size-3" />
        {fixing ? "Reflowing…" : "Fix the dates"}
      </button>
    </div>
  );
});
