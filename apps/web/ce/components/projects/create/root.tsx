/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { FormProvider, useForm } from "react-hook-form";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EFileAssetType } from "@plane/types";
import { cn } from "@plane/utils";
// components
import ProjectCommonAttributes from "@/components/project/create/common-attributes";
import ProjectCreateHeader from "@/components/project/create/header";
import ProjectCreateButtons from "@/components/project/create/project-create-buttons";
// hooks
import { getCoverImageType, uploadCoverImage } from "@/helpers/cover-image.helper";
import { useProject } from "@/hooks/store/use-project";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web types
import type { TProject } from "@/plane-web/types/projects";
// ARRIBADA: optional dates + lifecycle status set at creation, written to the schedule after
// the project exists (they are schedule fields, not project fields).
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { PROJECT_LIFECYCLE_STATUSES, type TProjectLifecycleStatus } from "@/plane-web/types/arribada";
import { ProjectAttributes } from "./attributes";
import { getProjectFormValues } from "./utils";

const arribadaService = new ArribadaService();

export type TCreateProjectFormProps = {
  setToFavorite?: boolean;
  workspaceSlug: string;
  onClose: () => void;
  handleNextStep: (projectId: string) => void;
  data?: Partial<TProject>;
  templateId?: string;
  updateCoverImageStatus: (projectId: string, coverImage: string) => Promise<void>;
};

export const CreateProjectForm = observer(function CreateProjectForm(props: TCreateProjectFormProps) {
  const { setToFavorite, workspaceSlug, data, onClose, handleNextStep, updateCoverImageStatus } = props;
  // store
  const { t } = useTranslation();
  const { addProjectToFavorites, createProject, updateProject } = useProject();
  // states
  const [shouldAutoSyncIdentifier, setShouldAutoSyncIdentifier] = useState(true);
  // ARRIBADA: optional schedule fields, all off by default so a plain create is unchanged.
  const [lifecycleStatus, setLifecycleStatus] = useState<TProjectLifecycleStatus>("active");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  // form info
  const methods = useForm<TProject>({
    defaultValues: { ...getProjectFormValues(), ...data },
    reValidateMode: "onChange",
  });
  const { handleSubmit, reset, setValue } = methods;
  const { isMobile } = usePlatformOS();
  const handleAddToFavorites = (projectId: string) => {
    if (!workspaceSlug) return;

    addProjectToFavorites(workspaceSlug.toString(), projectId).catch(() => {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: t("failed_to_remove_project_from_favorites"),
      });
    });
  };

  const onSubmit = async (formData: Partial<TProject>) => {
    // Upper case identifier
    formData.identifier = formData.identifier?.toUpperCase();
    const coverImage = formData.cover_image_url;
    let uploadedAssetUrl: string | null = null;

    if (coverImage) {
      const imageType = getCoverImageType(coverImage);

      if (imageType === "local_static") {
        try {
          uploadedAssetUrl = await uploadCoverImage(coverImage, {
            workspaceSlug: workspaceSlug.toString(),
            entityIdentifier: "",
            entityType: EFileAssetType.PROJECT_COVER,
            isUserAsset: false,
          });
        } catch (error) {
          console.error("Error uploading cover image:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: error instanceof Error ? error.message : "Failed to upload cover image",
          });
          return Promise.reject(error);
        }
      } else {
        formData.cover_image = coverImage;
        formData.cover_image_asset = null;
      }
    }

    return createProject(workspaceSlug.toString(), formData)
      .then(async (res) => {
        if (uploadedAssetUrl) {
          await updateCoverImageStatus(res.id, uploadedAssetUrl);
          await updateProject(workspaceSlug.toString(), res.id, { cover_image_url: uploadedAssetUrl });
        } else if (coverImage && coverImage.startsWith("http")) {
          await updateCoverImageStatus(res.id, coverImage);
          await updateProject(workspaceSlug.toString(), res.id, { cover_image_url: coverImage });
        }
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("success"),
          message: t("project_created_successfully"),
        });

        // ARRIBADA: persist the optional dates + status onto the new project's schedule. Best
        // effort — the project is already made, so a schedule that would not save must not fail it.
        if (startDate || targetDate || lifecycleStatus !== "active") {
          await arribadaService
            .updateSchedule(workspaceSlug.toString(), res.id, {
              lifecycle_status: lifecycleStatus,
              ...(startDate ? { start_date: startDate } : {}),
              ...(targetDate ? { target_date: targetDate } : {}),
            })
            .catch(() => {});
        }

        if (setToFavorite) {
          handleAddToFavorites(res.id);
        }
        handleNextStep(res.id);
      })
      .catch((err) => {
        try {
          // Handle the new error format where codes are nested in arrays under field names
          const errorData = err?.data ?? {};

          const nameError = errorData.name?.includes("PROJECT_NAME_ALREADY_EXIST");
          const identifierError = errorData?.identifier?.includes("PROJECT_IDENTIFIER_ALREADY_EXIST");

          if (nameError || identifierError) {
            if (nameError) {
              setToast({
                type: TOAST_TYPE.ERROR,
                title: t("toast.error"),
                message: t("project_name_already_taken"),
              });
            }

            if (identifierError) {
              setToast({
                type: TOAST_TYPE.ERROR,
                title: t("toast.error"),
                message: t("project_identifier_already_taken"),
              });
            }
          } else {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: t("toast.error"),
              message: t("something_went_wrong"),
            });
          }
        } catch (error) {
          // Fallback error handling if the error processing fails
          console.error("Error processing API error:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("something_went_wrong"),
          });
        }
      });
  };

  const handleClose = () => {
    onClose();
    setShouldAutoSyncIdentifier(true);
    setTimeout(() => {
      reset();
    }, 300);
  };

  return (
    <FormProvider {...methods}>
      <ProjectCreateHeader handleClose={handleClose} isMobile={isMobile} />

      <form onSubmit={handleSubmit(onSubmit)} className="px-3">
        <div className="mt-9 space-y-6 pb-5">
          <ProjectCommonAttributes
            setValue={setValue}
            isMobile={isMobile}
            shouldAutoSyncIdentifier={shouldAutoSyncIdentifier}
            setShouldAutoSyncIdentifier={setShouldAutoSyncIdentifier}
          />
          <ProjectAttributes isMobile={isMobile} />

          {/* ARRIBADA: optional lifecycle status + planned dates. All optional — leave them and a
              plain create is unchanged; they are written to the project's schedule after it exists. */}
          <div className="space-y-3 border-t border-subtle pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-13 font-medium text-secondary">Status</span>
              {PROJECT_LIFECYCLE_STATUSES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setLifecycleStatus(s.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-12",
                    lifecycleStatus === s.key
                      ? "border-accent-primary text-primary"
                      : "border-subtle text-tertiary hover:text-primary"
                  )}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-13 text-secondary">
                <span className="w-16 font-medium">Start</span>
                <input
                  type="date"
                  value={startDate}
                  max={targetDate || undefined}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
                />
              </label>
              <label className="flex items-center gap-2 text-13 text-secondary">
                <span className="font-medium">Target</span>
                <input
                  type="date"
                  value={targetDate}
                  min={startDate || undefined}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
                />
              </label>
            </div>
          </div>
        </div>
        <ProjectCreateButtons handleClose={handleClose} />
      </form>
    </FormProvider>
  );
});
