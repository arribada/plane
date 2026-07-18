/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// One project row in the portfolio timeline. `start_date`/`target_date` are the
// human-entered plan; `derived_*` are computed by the API from the work items
// (MIN start / MAX target). The undated count is surfaced, never hidden.
export type TPortfolioProject = {
  id: string;
  name: string;
  identifier: string;
  logo_props: unknown;
  archived: boolean;
  start_date: string | null;
  target_date: string | null;
  derived_start_date: string | null;
  derived_target_date: string | null;
  item_count: number;
  scheduled_item_count: number;
  undated_item_count: number;
};

// A work item of a project, loaded lazily when its project row is expanded.
export type TPortfolioItem = {
  id: string;
  name: string;
  sequence_id: number;
  start_date: string | null;
  target_date: string | null;
  state_id: string | null;
  parent_id: string | null;
  priority: "urgent" | "high" | "medium" | "low" | "none";
};

export type TProjectSchedule = {
  id: string;
  project: string;
  start_date: string | null;
  target_date: string | null;
};

export type TPortfolioColorBy = "project" | "priority";
export type TPortfolioSortBy = "start_date" | "target_date" | "name" | "undated";
