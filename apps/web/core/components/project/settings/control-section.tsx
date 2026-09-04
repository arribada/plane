/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "react-router";
// plane imports
import { PROJECT_TRACKER_ELEMENTS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// components
import { SettingsBoxedControlItem } from "@/components/settings/boxed-control-item";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import { ArchiveRestoreProjectModal } from "../archive-restore-modal";
import { DeleteProjectModal } from "../delete-project-modal";
// ARRIBADA: bring an Asana CSV export into this project + edit the project's lifecycle status.
import { AsanaImportModal } from "@/plane-web/components/projects/asana-import/asana-import-modal";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { PROJECT_LIFECYCLE_STATUSES, type TProjectLifecycleStatus } from "@/plane-web/types/arribada";

const arribadaService = new ArribadaService();

type Props = {
  projectId: string;
};

export const GeneralProjectSettingsControlSection = observer(function GeneralProjectSettingsControlSection(
  props: Props
) {
  const { projectId } = props;
  // states
  const [selectProject, setSelectedProject] = useState<string | null>(null);
  const [archiveProject, setArchiveProject] = useState<boolean>(false);
  const [asanaOpen, setAsanaOpen] = useState<boolean>(false);
  // ARRIBADA: the project's lifecycle status, read from and written to its schedule.
  const [status, setStatus] = useState<TProjectLifecycleStatus>("active");
  const [savingStatus, setSavingStatus] = useState(false);
  // params
  const { workspaceSlug } = useParams();
  // store hooks
  const { currentProjectDetails } = useProject();
  // translation
  const { t } = useTranslation();

  useEffect(() => {
    if (!workspaceSlug) return;
    arribadaService
      .getSchedule(workspaceSlug, projectId)
      .then((s) => setStatus((s?.lifecycle_status as TProjectLifecycleStatus) ?? "active"))
      .catch(() => {});
  }, [workspaceSlug, projectId]);

  const changeStatus = (value: TProjectLifecycleStatus) => {
    if (!workspaceSlug || savingStatus) return;
    const previous = status;
    setStatus(value);
    setSavingStatus(true);
    arribadaService
      .updateSchedule(workspaceSlug, projectId, { lifecycle_status: value })
      .catch(() => {
        setStatus(previous);
        setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't update status", message: "You may not have permission." });
      })
      .finally(() => setSavingStatus(false));
  };

  if (!currentProjectDetails) return null;

  return (
    <div className="mt-10">
      {workspaceSlug && (
        <ArchiveRestoreProjectModal
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          isOpen={archiveProject}
          onClose={() => setArchiveProject(false)}
          archive
        />
      )}
      <DeleteProjectModal
        project={currentProjectDetails}
        isOpen={Boolean(selectProject)}
        onClose={() => setSelectedProject(null)}
      />
      {workspaceSlug && (
        <AsanaImportModal
          isOpen={asanaOpen}
          onClose={() => setAsanaOpen(false)}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
        />
      )}
      {/* ARRIBADA: change the project's lifecycle status (Active / On hold / Completed / Cancelled)
          — the projects view filters and badges read this. */}
      <div className="mb-4 rounded-lg border border-subtle bg-layer-2">
        <SettingsBoxedControlItem
          className="border-0"
          title="Project status"
          description="Where this project is in its life. The all-projects view can filter by it, and a badge shows it on the card."
          control={
            <select
              value={status}
              disabled={savingStatus}
              onChange={(e) => changeStatus(e.target.value as TProjectLifecycleStatus)}
              className="rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-primary disabled:opacity-60"
            >
              {PROJECT_LIFECYCLE_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          }
        />
      </div>
      {/* ARRIBADA: a discoverable, visible entry point for the Asana CSV import. */}
      <div className="mb-4 rounded-lg border border-subtle bg-layer-2">
        <SettingsBoxedControlItem
          className="border-0"
          title="Import from Asana"
          description="Upload an Asana project CSV export to create work items here — names, notes, dates, assignees (by email), the parent/sub-task tree and blocked-by links are carried across."
          control={
            <Button variant="secondary" onClick={() => setAsanaOpen(true)}>
              Import CSV
            </Button>
          }
        />
      </div>
      <div className="rounded-lg border border-subtle bg-layer-2">
        {/* Project Selector */}
        <SettingsBoxedControlItem
          className="rounded-b-none border-0 border-b"
          title={t("archive")}
          description="Archiving a project will unlist your project from your side navigation although you will still be able to access it from your projects page. You can restore the project or delete it whenever you want."
          control={
            <Button variant="secondary" onClick={() => setArchiveProject(true)}>
              {t("archive")}
            </Button>
          }
        />
        {/* Format Selector */}
        <SettingsBoxedControlItem
          className="rounded-t-none border-0"
          title={t("delete")}
          description="When deleting a project, all of the data and resources within that project will be permanently removed and cannot be recovered."
          control={
            <Button
              variant="error-outline"
              onClick={() => setSelectedProject(currentProjectDetails.id ?? null)}
              data-ph-element={PROJECT_TRACKER_ELEMENTS.DELETE_PROJECT_BUTTON}
            >
              {t("delete")}
            </Button>
          }
        />
      </div>
    </div>
  );
});
