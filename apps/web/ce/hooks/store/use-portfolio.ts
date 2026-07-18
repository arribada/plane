/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext } from "react";
import { StoreContext } from "@/lib/store-context";
import type { IPortfolioStore } from "@/plane-web/store/portfolio.store";

export const usePortfolio = (): IPortfolioStore => {
  const context = useContext(StoreContext);
  if (!context) throw new Error("usePortfolio must be used within StoreProvider");
  return context.portfolio;
};
