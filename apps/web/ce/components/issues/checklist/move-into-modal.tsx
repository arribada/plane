/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Move into a work item", from the moved item's own menu.
 *
 * The same relation the checklist panel writes, reached from the other end:
 * somebody looking at a task who realises it belongs inside a bigger one should
 * not have to go and find that bigger one first.
 *
 * Nothing about the work item changes. It keeps its project, its parent, its
 * assignee and its place in every view — "move" here means it now appears on
 * another item's checklist, which is the one place membership shows.
 */
import { observer } from "mobx-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse } from "@plane/types";
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { addExistingToChecklist } from "./use-checklist";

type Props = {
  workspaceSlug: string;
  /** The item being moved. Its project scopes the search until the reader widens
   *  it, because most containment is within one project. */
  projectId: string;
  issueId: string;
  isOpen: boolean;
  onClose: () => void;
};

export const MoveIntoWorkItemModal = observer(function MoveIntoWorkItemModal(props: Props) {
  const { workspaceSlug, projectId, issueId, isOpen, onClose } = props;

  const onSubmit = async (selected: ISearchIssueResponse[]) => {
    const target = selected[0];
    if (!target) return;
    try {
      const result = await addExistingToChecklist(workspaceSlug, target.project_id, target.id, issueId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        // The endpoint is idempotent, so saying "moved" after a no-op would be a
        // lie the second time somebody picks the same target.
        title: result.created ? "Moved" : "Already there",
        message: `It is on the checklist of ${target.project__identifier}-${target.sequence_id}.`,
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't move it",
        message: (error as { error?: string })?.error || "Nothing changed.",
      });
    }
  };

  return (
    <ExistingIssuesListModal
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      isOpen={isOpen}
      handleClose={onClose}
      // `parent` is only asked for so the server keeps the item off its own
      // list; no parent link is written here, and none is read back.
      searchParams={{ parent: true, issue_id: issueId }}
      handleOnSubmit={onSubmit}
      shouldHideIssue={(issue) => issue.id === issueId}
      workspaceLevelToggle
    />
  );
});
