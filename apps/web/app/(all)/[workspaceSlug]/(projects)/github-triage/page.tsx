/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { PageHead } from "@/components/core/page-title";
import { GithubTriageRoot } from "@/plane-web/components/github-triage/root";

function WorkspaceGithubTriagePage() {
  return (
    <>
      <PageHead title="GitHub triage" />
      {/* No h-full/overflow here: ContentWrapper above already scrolls, and a
          third scroll container clamped to the viewport is how the Finance page
          ended up with a button nobody could reach. */}
      <GithubTriageRoot />
    </>
  );
}

export default observer(WorkspaceGithubTriagePage);
