/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Github } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { PlusIcon, WorkItemsIcon } from "@plane/propel/icons";
import { EIssueServiceType } from "@plane/types";
import type { TIssue, TIssueServiceType } from "@plane/types";
import { CustomMenu } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useSubIssueOperations } from "@/components/issues/issue-detail-widgets/sub-issues/helper";
// plane web
import { GithubTasksPicker } from "@/plane-web/components/issues/github-tasks-picker";

type Props = {
  issueId: string;
  customButton?: React.ReactNode;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const SubIssuesActionButton = observer(function SubIssuesActionButton(props: Props) {
  const { issueId, customButton, disabled = false, issueServiceType } = props;
  // translation
  const { t } = useTranslation();
  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const {
    issue: { getIssueById },
    toggleCreateIssueModal,
    toggleSubIssuesModal,
    setIssueCrudOperationState,
    issueCrudOperationState,
  } = useIssueDetail(issueServiceType);
  const { fetchSubIssues } = useSubIssueOperations(issueServiceType);

  // "Link GitHub tasks" picker (fork-only) — regular work items only
  const [githubPickerOpen, setGithubPickerOpen] = useState(false);
  const canLinkGithub = issueServiceType === EIssueServiceType.ISSUES;

  // derived values
  const issue = getIssueById(issueId);

  if (!issue) return <></>;

  // handlers
  const handleIssueCrudState = (
    key: "create" | "existing",
    _parentIssueId: string | null,
    issue: TIssue | null = null
  ) => {
    setIssueCrudOperationState({
      ...issueCrudOperationState,
      [key]: {
        toggle: !issueCrudOperationState[key].toggle,
        parentIssueId: _parentIssueId,
        issue: issue,
      },
    });
  };

  const handleCreateNew = () => {
    handleIssueCrudState("create", issueId, null);
    toggleCreateIssueModal(true);
  };

  const handleAddExisting = () => {
    handleIssueCrudState("existing", issueId, null);
    toggleSubIssuesModal(issue.id);
  };

  // options
  const optionItems = [
    {
      label: t("common.create_new"),
      icon: <PlusIcon className="h-3 w-3" />,
      onClick: handleCreateNew,
    },
    {
      label: t("common.add_existing"),
      icon: <WorkItemsIcon className="h-3 w-3" />,
      onClick: handleAddExisting,
    },
    ...(canLinkGithub
      ? [
          {
            label: "Link GitHub tasks",
            icon: <Github className="h-3 w-3" />,
            onClick: () => setGithubPickerOpen(true),
          },
        ]
      : []),
  ];

  // button element
  const customButtonElement = customButton ? <>{customButton}</> : <PlusIcon className="h-4 w-4" />;

  return (
    <>
      <CustomMenu customButton={customButtonElement} placement="bottom-start" disabled={disabled} closeOnSelect>
        {optionItems.map((item, index) => (
          <CustomMenu.MenuItem
            key={index}
            onClick={() => {
              item.onClick();
            }}
          >
            <div className="flex items-center gap-2">
              {item.icon}
              <span>{item.label}</span>
            </div>
          </CustomMenu.MenuItem>
        ))}
      </CustomMenu>
      {canLinkGithub && issue.project_id && workspaceSlug && (
        <GithubTasksPicker
          isOpen={githubPickerOpen}
          onClose={() => setGithubPickerOpen(false)}
          workspaceSlug={workspaceSlug.toString()}
          projectId={issue.project_id}
          parentIssueId={issue.id}
          onLinked={() => fetchSubIssues(workspaceSlug.toString(), issue.project_id as string, issue.id)}
        />
      )}
    </>
  );
});
