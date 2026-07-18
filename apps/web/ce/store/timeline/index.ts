/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RootStore } from "@/plane-web/store/root.store";
import { IssuesTimeLineStore } from "@/store/timeline/issues-timeline.store";
import type { IIssuesTimeLineStore } from "@/store/timeline/issues-timeline.store";
import { ModulesTimeLineStore } from "@/store/timeline/modules-timeline.store";
import type { IModulesTimeLineStore } from "@/store/timeline/modules-timeline.store";
import { BaseTimeLineStore } from "./base-timeline.store";
import type { IBaseTimelineStore } from "./base-timeline.store";
import { PortfolioTimeLineStore } from "./portfolio-timeline.store";

export interface ITimelineStore {
  issuesTimeLineStore: IIssuesTimeLineStore;
  modulesTimeLineStore: IModulesTimeLineStore;
  projectTimeLineStore: IBaseTimelineStore;
  groupedTimeLineStore: IBaseTimelineStore;
}

export class TimeLineStore implements ITimelineStore {
  issuesTimeLineStore: IIssuesTimeLineStore;
  modulesTimeLineStore: IModulesTimeLineStore;
  projectTimeLineStore: IBaseTimelineStore;
  groupedTimeLineStore: IBaseTimelineStore;

  constructor(rootStore: RootStore) {
    this.issuesTimeLineStore = new IssuesTimeLineStore(rootStore);
    this.modulesTimeLineStore = new ModulesTimeLineStore(rootStore);
    // PROJECT slot drives the Arribada portfolio timeline (was a dummy upstream).
    this.projectTimeLineStore = new PortfolioTimeLineStore(rootStore);
    // Dummy store
    this.groupedTimeLineStore = new BaseTimeLineStore(rootStore);
  }
}
