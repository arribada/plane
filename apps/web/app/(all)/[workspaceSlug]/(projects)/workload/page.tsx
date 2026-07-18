/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { PageHead } from "@/components/core/page-title";
import { WorkloadRoot } from "@/plane-web/components/workload/root";

function WorkspaceWorkloadPage() {
  return (
    <>
      <PageHead title="Workload" />
      <div className="relative h-full w-full overflow-y-auto">
        <WorkloadRoot />
      </div>
    </>
  );
}

export default observer(WorkspaceWorkloadPage);
