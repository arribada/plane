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

// One of the requesting user's open assigned work items (Home 'My tasks' widget).
export type TMyWorkItem = {
  id: string;
  name: string;
  target_date: string | null;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  project_name: string;
};

// Where a project's documentation lives: an AFFiNE wiki doc + a Google Drive URL.
export type TProjectDocs = {
  doc_id: string | null;
  workspace_id: string | null;
  title: string | null;
  google_drive_url: string | null;
};

export type TProjectStatus = "on_track" | "at_risk" | "off_track";

// An Asana-style status post on a project.
export type TProjectStatusUpdate = {
  id: string;
  status: TProjectStatus;
  message: string;
  created_at: string;
  author: string | null;
};

export type TProjectSchedule = {
  id: string;
  project: string;
  start_date: string | null;
  target_date: string | null;
};

export type TPortfolioColorBy = "project" | "priority";
export type TPortfolioSortBy = "start_date" | "target_date" | "name" | "undated" | "manual";

// A raw dependency edge between two issues. relation_type is kept as a plain
// string on purpose — extending the global TIssueRelationTypes union would force
// every Record<TIssueRelationTypes,…> in the codebase to grow, so we don't.
export type TIssueRelationEdge = {
  issue_id: string;
  related_issue_id: string;
  relation_type: string;
};
