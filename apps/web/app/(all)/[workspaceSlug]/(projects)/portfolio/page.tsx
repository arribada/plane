/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { PageHead } from "@/components/core/page-title";
import { PortfolioTimelineRoot } from "@/plane-web/components/portfolio/root";

function WorkspacePortfolioPage() {
  return (
    <>
      <PageHead title="Portfolio" />
      <div className="relative h-full w-full overflow-hidden">
        <PortfolioTimelineRoot />
      </div>
    </>
  );
}

export default observer(WorkspacePortfolioPage);
