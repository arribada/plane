/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { WorkspaceGithubTriageHeader } from "./header";

export default function WorkspaceGithubTriageLayout() {
  // The breadcrumb bar does repeat the sidebar entry the reader just clicked, and
  // this page was left without one for that reason. But the bar is also the only
  // place the sidebar toggle is rendered, and below 768px the sidebar auto-
  // collapses to width 0 on navigation — so on a phone this page closed the
  // sidebar and then offered no way to open it again. Portfolio, Workload and
  // Finance all render it; this one is no different.
  return (
    <>
      <AppHeader header={<WorkspaceGithubTriageHeader />} />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
