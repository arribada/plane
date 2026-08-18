/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse, TIssue } from "@plane/types";
// components
import { IssueModalContext } from "@/components/issues/issue-modal/context";
import type { TCreateUpdatePropertyValuesProps } from "@/components/issues/issue-modal/context/issue-modal-context";
// hooks
import { useUser } from "@/hooks/store/user/user-user";
// ARRIBADA: collect + apply the fork's create-time work-item properties (discipline, effort).
import { ArribadaCreateContext } from "@/plane-web/components/issues/issue-modal/arribada-create-context";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const arribadaService = new ArribadaService();

export type TIssueModalProviderProps = {
  templateId?: string;
  dataForPreload?: Partial<TIssue>;
  allowedProjectIds?: string[];
  children: React.ReactNode;
};

export const IssueModalProvider = observer(function IssueModalProvider(props: TIssueModalProviderProps) {
  const { children, allowedProjectIds } = props;
  // states
  const [selectedParentIssue, setSelectedParentIssue] = useState<ISearchIssueResponse | null>(null);
  // ARRIBADA: create-time discipline + effort, unset until the user picks them (fresh each
  // open, since a closed modal unmounts this provider).
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [effortDays, setEffortDays] = useState<number | null>(null);
  // store hooks
  const { projectsWithCreatePermissions } = useUser();
  // derived values
  const projectIdsWithCreatePermissions = Object.keys(projectsWithCreatePermissions ?? {});

  // ARRIBADA: the core modal already runs "add other property values" after the work item is
  // created (base.tsx), handing us the new id. Discipline/effort are keyed on that id, so this
  // is where they land. A no-op unless the user set one, so ordinary creation is untouched;
  // errors here never fail the creation — the item exists, only a property did not attach.
  const applyArribadaProperties = async ({ issueId, projectId, workspaceSlug, isDraft }: TCreateUpdatePropertyValuesProps) => {
    if (isDraft || !issueId || !projectId || !workspaceSlug) return;
    const tasks: Promise<unknown>[] = [];
    if (effortDays !== null) tasks.push(arribadaService.setIssueEffort(workspaceSlug, projectId, issueId, effortDays));
    if (discipline) tasks.push(arribadaService.setIssueRole(workspaceSlug, projectId, issueId, discipline));
    if (tasks.length === 0) return;
    const results = await Promise.allSettled(tasks);
    if (results.some((r) => r.status === "rejected")) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "The work item was created",
        message: "…but a discipline or effort could not be saved. Set it from the item itself.",
      });
    }
  };

  return (
    <ArribadaCreateContext.Provider value={{ discipline, setDiscipline, effortDays, setEffortDays }}>
      <IssueModalContext.Provider
        value={{
          allowedProjectIds: allowedProjectIds ?? projectIdsWithCreatePermissions,
          workItemTemplateId: null,
          setWorkItemTemplateId: () => {},
          isApplyingTemplate: false,
          setIsApplyingTemplate: () => {},
          selectedParentIssue,
          setSelectedParentIssue,
          issuePropertyValues: {},
          setIssuePropertyValues: () => {},
          issuePropertyValueErrors: {},
          setIssuePropertyValueErrors: () => {},
          getIssueTypeIdOnProjectChange: () => null,
          getActiveAdditionalPropertiesLength: () => 0,
          handlePropertyValuesValidation: () => true,
          handleCreateUpdatePropertyValues: applyArribadaProperties,
          handleProjectEntitiesFetch: () => Promise.resolve(),
          handleTemplateChange: () => Promise.resolve(),
          handleConvert: () => Promise.resolve(),
          handleCreateSubWorkItem: () => Promise.resolve(),
        }}
      >
        {children}
      </IssueModalContext.Provider>
    </ArribadaCreateContext.Provider>
  );
});
