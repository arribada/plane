/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// store
import { CoreRootStore } from "@/store/root.store";
import { mirrorIssueChangesIntoPortfolio } from "./portfolio-issue-mirror";
import { PortfolioStore } from "./portfolio.store";
import type { IPortfolioStore } from "./portfolio.store";
import type { ITimelineStore } from "./timeline";
import { TimeLineStore } from "./timeline";

export class RootStore extends CoreRootStore {
  timelineStore: ITimelineStore;
  portfolio: IPortfolioStore;

  constructor() {
    super();

    // portfolio is constructed before timelineStore: the PROJECT timeline slot
    // reads rootStore.portfolio.getRowById in its autorun.
    this.portfolio = new PortfolioStore();
    this.timelineStore = new TimeLineStore(this);
    // Wired here rather than inside PortfolioStore because it is the join between
    // two stores and this is the first place both exist. The disposer is dropped
    // on purpose: it lives as long as the tab.
    mirrorIssueChangesIntoPortfolio(this);
  }
}
