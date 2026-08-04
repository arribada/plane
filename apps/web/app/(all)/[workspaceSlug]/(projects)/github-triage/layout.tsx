/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { ContentWrapper } from "@/components/core/content-wrapper";

export default function WorkspaceGithubTriageLayout() {
  // No AppHeader: the page carries its own title and one sentence saying what it
  // is for, and a breadcrumb bar above that would repeat the sidebar entry the
  // reader just clicked.
  return (
    <ContentWrapper>
      <Outlet />
    </ContentWrapper>
  );
}
