/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Arribada: upstream renders this as an extension slot inside the work-item form and
 * ships it as a stub returning null. Filling it in is how the AI draft button reaches
 * the form without a single line changing in core — the form is wrapped in a
 * FormProvider, so useFormContext() here gives the same setValue and watch the form
 * itself uses. That keeps the merge surface at zero for a feature that would otherwise
 * have meant editing the most-touched file in the issue modal.
 */
import { useFormContext } from "react-hook-form";
import type { TIssue } from "@plane/types";
import { AiDraftButton } from "@/plane-web/components/issues/ai-draft-button";

export type TWorkItemModalAdditionalPropertiesProps = {
  isDraft?: boolean;
  projectId: string | null;
  workItemId: string | undefined;
  workspaceSlug: string;
};

export function WorkItemModalAdditionalProperties(props: TWorkItemModalAdditionalPropertiesProps) {
  const { projectId } = props;
  const { setValue, watch } = useFormContext<TIssue>();

  const description = watch("description_html");
  const descriptionEmpty = !description || description === "<p></p>";

  return (
    <div className="px-5">
      <AiDraftButton
        projectId={projectId}
        title={watch("name") ?? ""}
        descriptionEmpty={descriptionEmpty}
        onDraft={(draft) => {
          // A description somebody already wrote is never overwritten — the point is
          // to finish an item, not to take it over.
          if (draft.description_html && descriptionEmpty) {
            setValue("description_html", draft.description_html, { shouldDirty: true });
          }
          setValue("start_date", draft.start_date, { shouldDirty: true });
          setValue("target_date", draft.target_date, { shouldDirty: true });
          if (draft.assignee_id && (watch("assignee_ids") ?? []).length === 0) {
            setValue("assignee_ids", [draft.assignee_id], { shouldDirty: true });
          }
        }}
        onUndo={() => {
          // Only the dates come back off. The description and the owner are things a
          // person has since read and may have edited; silently clearing them would
          // lose work that is no longer the assistant's.
          setValue("start_date", null, { shouldDirty: true });
          setValue("target_date", null, { shouldDirty: true });
        }}
      />
    </div>
  );
}
