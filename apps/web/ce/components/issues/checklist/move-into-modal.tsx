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
 *
 * Several targets at once, because the picker is multi-select with a "Select
 * all" button and the model puts one member on as many checklists as you like.
 * It used to take `selected[0]` and drop the rest, so picking three and being
 * congratulated left two of them nowhere.
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

/** How a target reads in the toast: the identifier somebody actually recognises. */
const named = (target: ISearchIssueResponse) => `${target.project__identifier}-${target.sequence_id}`;

export const MoveIntoWorkItemModal = observer(function MoveIntoWorkItemModal(props: Props) {
  const { workspaceSlug, projectId, issueId, isOpen, onClose } = props;

  const onSubmit = async (selected: ISearchIssueResponse[]) => {
    if (selected.length === 0) return;

    // allSettled, not all: one target failing must not throw away the ones that
    // worked, and the reader has to be told which is which — a blanket error
    // after two of three succeeded would send them to undo work that is fine.
    const results = await Promise.allSettled(
      selected.map((target) => addExistingToChecklist(workspaceSlug, target.project_id, target.id, issueId))
    );

    const added: string[] = [];
    const already: string[] = [];
    const failed: string[] = [];
    results.forEach((result, index) => {
      const label = named(selected[index]);
      if (result.status === "rejected") failed.push(label);
      // The endpoint is idempotent, so saying "moved" after a no-op would be a
      // lie the second time somebody picks the same target.
      else if (result.value.created) added.push(label);
      else already.push(label);
    });

    if (added.length === 0 && already.length === 0) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't move it",
        message: `Nothing changed on ${failed.join(", ")}.`,
      });
      return;
    }

    const landed = [...added, ...already];
    setToast({
      // Partly done is not success: naming the ones that did not land is the
      // only way somebody can retry just those.
      type: failed.length > 0 ? TOAST_TYPE.WARNING : TOAST_TYPE.SUCCESS,
      title: added.length > 0 ? `Moved into ${added.length}` : "Already there",
      message:
        failed.length > 0
          ? `It is on the checklist of ${landed.join(", ")}. ${failed.join(", ")} did not take it.`
          : `It is on the checklist of ${landed.join(", ")}.`,
    });
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
