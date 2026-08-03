/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
// plane imports

export type TWorkItemAdditionalSidebarProperties = {
  workItemId: string;
  workItemTypeId: string | null;
  projectId: string;
  workspaceSlug: string;
  isEditable: boolean;
  isPeekView?: boolean;
};

/**
 * Empty on purpose. Effort and Discipline used to be appended here, which is the
 * only thing this hook can do — add to the END of the properties list. They
 * belong beside the fields they relate to (effort under State, discipline under
 * Assignees), so the sidebar places them itself.
 */
export function WorkItemAdditionalSidebarProperties(_props: TWorkItemAdditionalSidebarProperties) {
  return <></>;
}
