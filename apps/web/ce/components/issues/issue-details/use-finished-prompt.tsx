/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Fires the "how long did it actually take?" prompt when a work item is closed.
 *
 * A hook rather than a component because the state dropdown lives in two places
 * — the full work item page and the panel that slides in from a list — and the
 * fields have already been added to only one of those once this session.
 *
 * It asks on the TRANSITION into a finished state, not on every save of a
 * finished item: reopening the panel of something closed last month should not
 * interrogate anybody.
 */
import { useCallback, useState } from "react";
import { useProjectState } from "@/hooks/store/use-project-state";
import { ActualEffortPrompt } from "./actual-effort-prompt";

type Args = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueName: string;
};

export const useFinishedPrompt = (args: Args) => {
  const { workspaceSlug, projectId, issueId, issueName } = args;
  const { getStateById } = useProjectState();
  const [open, setOpen] = useState(false);

  /** Call with the state ids either side of the change. */
  const onStateChange = useCallback(
    (previousStateId: string | null | undefined, nextStateId: string | null | undefined) => {
      if (!nextStateId || previousStateId === nextStateId) return;
      const before = getStateById(previousStateId ?? "")?.group;
      const after = getStateById(nextStateId)?.group;
      // "cancelled" is deliberately not included: work that was abandoned has no
      // real duration worth recording, and asking would be asking for a number
      // that means nothing.
      if (after === "completed" && before !== "completed") setOpen(true);
    },
    [getStateById]
  );

  const prompt =
    open && workspaceSlug && projectId && issueId ? (
      <ActualEffortPrompt
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        issueName={issueName}
        onClose={() => setOpen(false)}
      />
    ) : null;

  return { onStateChange, prompt };
};
