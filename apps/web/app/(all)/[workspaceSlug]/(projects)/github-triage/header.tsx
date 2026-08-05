/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Github } from "lucide-react";
import { Breadcrumbs, Header } from "@plane/ui";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";

export const WorkspaceGithubTriageHeader = observer(function WorkspaceGithubTriageHeader() {
  return (
    <Header>
      <Header.LeftItem>
        <div className="flex items-center gap-2.5">
          <Breadcrumbs>
            <Breadcrumbs.Item
              component={<BreadcrumbLink label="GitHub triage" icon={<Github className="size-4 text-secondary" />} />}
            />
          </Breadcrumbs>
        </div>
      </Header.LeftItem>
    </Header>
  );
});
