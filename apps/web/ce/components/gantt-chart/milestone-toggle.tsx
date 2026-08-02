/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Marking a work item as a funder deliverable, from the row it is on.
 *
 * It lives in the timeline sidebar rather than behind the work-item peek because
 * marking up a plan is a pass over the whole plan: somebody reads down the list
 * once and flags the four things a funder tracks. Making that four round trips
 * through a detail panel is how it does not get done.
 */
import { useState } from "react";
import { Diamond } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { invalidateProjectMilestones, type TMilestoneKind } from "./use-project-milestones";

const service = new ArribadaService();

/** The cycle a click walks. Ending back at "not a milestone" is what makes the
 *  control reversible without a second affordance. */
const NEXT: Record<string, TMilestoneKind | null> = {
  none: "delivery",
  delivery: "gate",
  gate: "review",
  review: null,
};

const LABEL: Record<string, string> = {
  none: "Not a deliverable — click to mark it one",
  delivery: "Delivery — click for Gate",
  gate: "Gate — click for Review",
  review: "Review — click to unmark",
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  current: TMilestoneKind | null;
};

export function MilestoneToggle({ workspaceSlug, projectId, issueId, current }: Props) {
  const [busy, setBusy] = useState(false);
  const state = current ?? "none";

  const cycle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await service.setProjectMilestone(workspaceSlug, projectId, issueId, NEXT[state]);
      // The chart reads milestones from a module-scope cache; without this the
      // diamond does not appear until a hard reload.
      invalidateProjectMilestones(workspaceSlug, projectId);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't change that",
        message: "The deliverable mark was not saved.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        // The row navigates; this does not.
        event.stopPropagation();
        void cycle();
      }}
      disabled={busy}
      aria-label={LABEL[state]}
      title={LABEL[state]}
      className={cn(
        // p-2 -m-2 keeps the icon where it is and takes the tap target to ~44px.
        "-m-2 flex-shrink-0 p-2 transition-opacity",
        current
          ? "text-accent-primary opacity-100"
          : // Invisible until the row is hovered or the button itself is focused:
            // a diamond outline on every row would read as every row being a
            // milestone, which is the confusion this whole feature removes.
            "text-tertiary opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
      )}
    >
      <Diamond className={cn("size-3.5", current && "fill-current")} />
    </button>
  );
}
