/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { autorun } from "mobx";
import type { RootStore } from "@/plane-web/store/root.store";
import { BaseTimeLineStore } from "./base-timeline.store";

// Fills the PROJECT timeline slot (a dummy BaseTimeLineStore upstream) with data
// from the portfolio store. Same shape as IssuesTimeLineStore: an autorun that
// rebuilds the blocks map whenever blockIds or the portfolio data change.
export class PortfolioTimeLineStore extends BaseTimeLineStore {
  constructor(_rootStore: RootStore) {
    super(_rootStore);
    autorun(() => {
      this.updateBlocks((id: string) => this.rootStore.portfolio.getRowById(id));
    });
  }
}
