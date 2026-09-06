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
import { useUser } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web types
import type { TProject } from "@/plane-web/types/projects";
// ARRIBADA: optional dates + status + budget + team set at creation, applied after the project
// exists (schedule fields go to /schedule/, members to the project members endpoint).
import { EUserPermissions } from "@plane/constants";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { PROJECT_LIFECYCLE_STATUSES, type TProjectLifecycleStatus } from "@/plane-web/types/arribada";
import { ProjectMemberService } from "@/services/project/project-member.service";
import { ProjectAttributes } from "./attributes";
import { getProjectFormValues } from "./utils";

const arribadaService = new ArribadaService();
const projectMemberService = new ProjectMemberService();

const BUDGET_CURRENCIES = ["EUR", "USD", "GBP"];
const TEAM_ROLES: { value: EUserPermissions; label: string }[] = [
  { value: EUserPermissions.ADMIN, label: "Admin" },
  { value: EUserPermissions.MEMBER, label: "Member" },
  { value: EUserPermissions.GUEST, label: "Guest" },
];

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
  const { data: currentUser } = useUser();
  // states
  const [shouldAutoSyncIdentifier, setShouldAutoSyncIdentifier] = useState(true);
  // ARRIBADA: optional schedule fields, all off by default so a plain create is unchanged.
  const [lifecycleStatus, setLifecycleStatus] = useState<TProjectLifecycleStatus>("active");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState("EUR");
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [teamRole, setTeamRole] = useState<EUserPermissions>(EUserPermissions.MEMBER);
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
    // ARRIBADA: the creator becomes the lead unless they pick one — otherwise a workspace member
    // who creates a project cannot set its budget (the money endpoint is lead-gated), and the
    // amount they typed is dropped in silence.
    if (!formData.project_lead && currentUser?.id) formData.project_lead = currentUser.id;
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

        // ARRIBADA: apply the optional extras onto the new project. The project is already made,
        // so an extra that will not save must not fail the creation — but it must not be lost in
        // silence either, so a failure is surfaced as a warning that names what did not save.
        const failedExtras: string[] = [];
        if (startDate || targetDate || lifecycleStatus !== "active" || budgetAmount) {
          await arribadaService
            .updateSchedule(workspaceSlug.toString(), res.id, {
              lifecycle_status: lifecycleStatus,
              ...(startDate ? { start_date: startDate } : {}),
              ...(targetDate ? { target_date: targetDate } : {}),
              ...(budgetAmount ? { budget_amount: Number(budgetAmount), budget_currency: budgetCurrency } : {}),
            })
            .catch(() => failedExtras.push(budgetAmount ? "budget/dates" : "dates/status"));
        }
        if (teamMemberIds.length > 0) {
          await projectMemberService
            .bulkAddMembersToProject(workspaceSlug.toString(), res.id, {
              members: teamMemberIds.map((member_id) => ({ member_id, role: teamRole })),
            })
            .catch(() => failedExtras.push("team members"));
        }
        if (failedExtras.length > 0) {
          setToast({
            type: TOAST_TYPE.WARNING,
            title: "Project created — some details need permission",
            message: `Couldn't save: ${failedExtras.join(", ")}. Set them from the project's settings.`,
          });
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
            <p className="text-12 text-tertiary">{t("optional")} — you can set these now or later.</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="w-full text-13 font-medium text-secondary sm:w-16">Status</span>
              {PROJECT_LIFECYCLE_STATUSES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setLifecycleStatus(s.key)}
                  aria-label={`Set status to ${s.label}`}
                  aria-pressed={lifecycleStatus === s.key}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-12 outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
                    lifecycleStatus === s.key
                      ? "border-accent-primary text-primary"
                      : "border-subtle text-secondary hover:bg-layer-2 hover:text-primary"
                  )}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex items-center gap-2 text-13 text-secondary">
                <span className="w-full font-medium sm:w-16">{t("start_date")}</span>
                <input
                  type="date"
                  aria-label="Start date"
                  value={startDate}
                  max={targetDate || undefined}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
                />
              </label>
              <label className="flex items-center gap-2 text-13 text-secondary">
                <span className="font-medium">Target</span>
                <input
                  type="date"
                  aria-label="Target date"
                  value={targetDate}
                  min={startDate || undefined}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
                />
              </label>
            </div>

            {/* budget */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="w-full text-13 font-medium text-secondary sm:w-16">Budget</span>
              <input
                type="number"
                min={0}
                aria-label="Budget amount"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                placeholder="Amount"
                className="w-32 rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
              />
              <select
                value={budgetCurrency}
                aria-label="Budget currency"
                title="Budget currency — the project lead can change it later in the budget view"
                onChange={(e) => setBudgetCurrency(e.target.value)}
                className="rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
              >
                {BUDGET_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* team members + their role */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="w-full text-13 font-medium text-secondary sm:w-16">Team</span>
              <div className="h-7">
                <MemberDropdown
                  value={teamMemberIds}
                  onChange={(ids) => setTeamMemberIds((ids ?? []) as string[])}
                  placeholder={t("add_members")}
                  multiple
                  buttonVariant="border-with-text"
                />
              </div>
              <select
                value={teamRole}
                onChange={(e) => setTeamRole(Number(e.target.value) as EUserPermissions)}
                disabled={teamMemberIds.length === 0}
                aria-label={teamMemberIds.length === 0 ? "Member role — select members first" : "Member role"}
                title={teamMemberIds.length === 0 ? "Select members first" : undefined}
                className={cn(
                  "rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-strong disabled:cursor-not-allowed disabled:bg-layer-2",
                  teamMemberIds.length === 0 && "opacity-50"
                )}
              >
                {TEAM_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <ProjectCreateButtons handleClose={handleClose} />
      </form>
    </FormProvider>
  );
});
