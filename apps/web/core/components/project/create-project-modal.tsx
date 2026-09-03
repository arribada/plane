/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { getAssetIdFromUrl, checkURLValidity } from "@plane/utils";
// plane ui
// helpers
// hooks
import useKeypress from "@/hooks/use-keypress";
// plane web components
import { CreateProjectForm } from "@/plane-web/components/projects/create/root";
// ARRIBADA: optional Asana CSV import, offered once the project exists.
import { AsanaImportModal } from "@/plane-web/components/projects/asana-import/asana-import-modal";
import { FileDown } from "lucide-react";
// plane web types
import type { TProject } from "@/plane-web/types/projects";
// services
import { FileService } from "@/services/file.service";
const fileService = new FileService();
import { ProjectFeatureUpdate } from "./project-feature-update";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  setToFavorite?: boolean;
  workspaceSlug: string;
  data?: Partial<TProject>;
  templateId?: string;
};

enum EProjectCreationSteps {
  CREATE_PROJECT = "CREATE_PROJECT",
  FEATURE_SELECTION = "FEATURE_SELECTION",
}

export function CreateProjectModal(props: Props) {
  const { isOpen, onClose, setToFavorite = false, workspaceSlug, data, templateId } = props;
  // states
  const [currentStep, setCurrentStep] = useState<EProjectCreationSteps>(EProjectCreationSteps.CREATE_PROJECT);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [asanaOpen, setAsanaOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(EProjectCreationSteps.CREATE_PROJECT);
      setCreatedProjectId(null);
    }
  }, [isOpen]);

  const handleNextStep = (projectId: string) => {
    if (!projectId) return;
    setCreatedProjectId(projectId);
    setCurrentStep(EProjectCreationSteps.FEATURE_SELECTION);
  };

  const handleCoverImageStatusUpdate = async (projectId: string, coverImage: string) => {
    if (!checkURLValidity(coverImage)) {
      await fileService.updateBulkProjectAssetsUploadStatus(workspaceSlug, projectId, projectId, {
        asset_ids: [getAssetIdFromUrl(coverImage)],
      });
    }
  };

  useKeypress("Escape", () => {
    if (isOpen) onClose();
  });

  return (
    <ModalCore isOpen={isOpen} position={EModalPosition.TOP} width={EModalWidth.XXXXL}>
      {currentStep === EProjectCreationSteps.CREATE_PROJECT && (
        <CreateProjectForm
          setToFavorite={setToFavorite}
          workspaceSlug={workspaceSlug}
          onClose={onClose}
          updateCoverImageStatus={handleCoverImageStatusUpdate}
          handleNextStep={handleNextStep}
          data={data}
          templateId={templateId}
        />
      )}
      {currentStep === EProjectCreationSteps.FEATURE_SELECTION && (
        <>
          {/* ARRIBADA: bring an Asana project across as work items, right after the project exists. */}
          <div className="flex justify-end px-6 pt-4">
            <button
              type="button"
              onClick={() => setAsanaOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-subtle px-3 py-1.5 text-13 font-medium text-secondary hover:bg-layer-2 hover:text-primary"
            >
              <FileDown className="size-4" />
              Import tasks from Asana (CSV)
            </button>
          </div>
          <ProjectFeatureUpdate projectId={createdProjectId} workspaceSlug={workspaceSlug} onClose={onClose} />
          {createdProjectId && (
            <AsanaImportModal
              isOpen={asanaOpen}
              onClose={() => setAsanaOpen(false)}
              workspaceSlug={workspaceSlug}
              projectId={createdProjectId}
            />
          )}
        </>
      )}
    </ModalCore>
  );
}
