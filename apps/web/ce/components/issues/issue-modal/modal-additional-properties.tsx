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
import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import type { TIssue } from "@plane/types";
import { AiDraftButton } from "@/plane-web/components/issues/ai-draft-button";
// ARRIBADA: set discipline + effort + milestone at creation, applied to the new item on save.
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { MILESTONE_KINDS, MILESTONE_KIND_LABEL } from "@/plane-web/components/issues/milestone/kinds";
import { useArribadaCreate } from "./arribada-create-context";

const arribadaService = new ArribadaService();
const ARRIBADA_INPUT =
  "rounded border border-subtle bg-layer-1 px-2 py-1.5 text-13 text-primary outline-none focus:border-accent-primary";

export type TWorkItemModalAdditionalPropertiesProps = {
  isDraft?: boolean;
  projectId: string | null;
  workItemId: string | undefined;
  workspaceSlug: string;
};

export function WorkItemModalAdditionalProperties(props: TWorkItemModalAdditionalPropertiesProps) {
  const { projectId, workspaceSlug, workItemId } = props;
  const { setValue, watch } = useFormContext<TIssue>();
  // ARRIBADA: only when creating (no existing id) — an existing item has these on its own
  // sidebar. The context is null outside the fork's IssueModalProvider, so this is inert then.
  const arribada = useArribadaCreate();
  const isCreate = !workItemId;
  const [disciplines, setDisciplines] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!isCreate || !workspaceSlug || !projectId) return;
    let live = true;
    arribadaService
      .getProjectTeam(workspaceSlug, projectId)
      // A vocabulary that will not load (e.g. no permission to read the roster) just hides the
      // discipline picker; effort and ordinary creation are unaffected.
      .then((r) => {
        if (live) setDisciplines(r?.roles_vocabulary ?? []);
      })
      .catch(() => {
        if (live) setDisciplines([]);
      });
    return () => {
      live = false;
    };
  }, [isCreate, workspaceSlug, projectId]);

  const description = watch("description_html");
  const descriptionEmpty = !description || description === "<p></p>";

  return (
    <div className="flex flex-col gap-3 px-5">
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

      {/* ARRIBADA: discipline + effort at creation. Applied to the new work item on save by
          IssueModalProvider; left untouched here they change nothing. */}
      {isCreate && arribada && (
        <div className="flex flex-wrap items-end gap-3">
          {disciplines.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-11 text-tertiary">Discipline</span>
              <select
                value={arribada.discipline ?? ""}
                onChange={(e) => arribada.setDiscipline(e.target.value || null)}
                className={ARRIBADA_INPUT}
              >
                <option value="">None</option>
                {disciplines.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-11 text-tertiary">Effort (person-days)</span>
            <input
              type="number"
              min={0}
              step="0.5"
              value={arribada.effortDays ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                arribada.setEffortDays(v === "" ? null : Math.max(0, Number(v)));
              }}
              placeholder="—"
              className={`${ARRIBADA_INPUT} w-32`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-11 text-tertiary">Milestone</span>
            <select
              value={arribada.milestoneKind ?? ""}
              onChange={(e) => arribada.setMilestoneKind((e.target.value || null) as typeof arribada.milestoneKind)}
              className={ARRIBADA_INPUT}
            >
              <option value="">Not a milestone</option>
              {MILESTONE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MILESTONE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {/* The funder-facing name, only when this IS a milestone. */}
          {arribada.milestoneKind && (
            <label className="flex flex-col gap-1">
              <span className="text-11 text-tertiary">Milestone label (for funders)</span>
              <input
                type="text"
                value={arribada.milestoneLabel}
                onChange={(e) => arribada.setMilestoneLabel(e.target.value)}
                placeholder="Optional — what a funder reads"
                maxLength={255}
                className={`${ARRIBADA_INPUT} w-56`}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
