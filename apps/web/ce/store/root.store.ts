/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// store
import { CoreRootStore } from "@/store/root.store";
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
  }
}
