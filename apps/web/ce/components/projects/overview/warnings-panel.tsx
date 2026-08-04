/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The warnings and every quick fix behind them, as one droppable block.
 *
 * The modals were wired straight into the Overview, which meant the Finance page
 * — where a missing discipline actually costs you a number — could show the same
 * problem and offer nothing. This owns the open/closed state so any page can
 * render the warnings and get the fixes with them.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useAppRouter } from "@/hooks/use-app-router";
import type { TProjectOverview } from "@/plane-web/types/arribada";
import { AssigneeGapModal } from "./assignee-gap-modal";
import { DisciplineGapModal } from "./discipline-gap-modal";
import { UndatedGapModal } from "./undated-gap-modal";
import { OverviewWarnings } from "./warnings-block";

type Props = {
  warnings: TProjectOverview["warnings"];
  /** Overview scrolls to its links block; pages without one send people there. */
  onConfigureLinks?: () => void;
  /** Called after a fix lands, so the caller can refetch what it shows. */
  onFixed: () => void;
};

export const ProjectWarningsPanel = observer(function ProjectWarningsPanel(props: Props) {
  const { warnings, onConfigureLinks, onFixed } = props;
  const { workspaceSlug, projectId } = useParams();
  const router = useAppRouter();
  const [disciplineOpen, setDisciplineOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);

  return (
    <>
      <OverviewWarnings
        warnings={warnings}
        onConfigureLinks={onConfigureLinks ?? (() => router.push(`/${workspaceSlug}/projects/${projectId}/overview/`))}
        onFixDisciplines={() => setDisciplineOpen(true)}
        onFixAssignees={() => setAssigneeOpen(true)}
        onFixDates={() => setDatesOpen(true)}
      />
      <DisciplineGapModal isOpen={disciplineOpen} onClose={() => setDisciplineOpen(false)} onDone={onFixed} />
      <AssigneeGapModal isOpen={assigneeOpen} onClose={() => setAssigneeOpen(false)} onDone={onFixed} />
      <UndatedGapModal
        isOpen={datesOpen}
        onClose={() => setDatesOpen(false)}
        onDone={onFixed}
        onOpenTimeline={() => router.push(`/${workspaceSlug}/projects/${projectId}/timeline/`)}
      />
    </>
  );
});
