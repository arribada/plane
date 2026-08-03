/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { PageHead } from "@/components/core/page-title";
import { useProject } from "@/hooks/store/use-project";
import { ProjectFinanceRoot } from "@/plane-web/components/projects/finance/root";

function ProjectFinancePage() {
  const { projectId } = useParams();
  const { getProjectById } = useProject();

  const project = projectId ? getProjectById(projectId.toString()) : undefined;

  return (
    <>
      <PageHead title={project?.name ? `${project.name} - Finance` : "Finance"} />
      <div className="relative h-full w-full overflow-y-auto">
        <ProjectFinanceRoot />
      </div>
    </>
  );
}

export default observer(ProjectFinancePage);
