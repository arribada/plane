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
  completed_item_count: number;
  baseline_target_date: string | null;
};

// A person assigned to a work item, shown as an avatar on the timeline.
export type TItemAssignee = { id: string; name: string; avatar: string | null };

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
  assignees: TItemAssignee[];
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
  mattermost_channel_url: string | null;
  github_repo_urls: string[];
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

// Everything the project Overview page renders, from one aggregate endpoint.
export type TProjectOverview = {
  project: {
    id: string;
    name: string;
    identifier: string;
    description: string | null;
    logo_props: unknown;
    cycle_view: boolean;
    module_view: boolean;
    issue_views_view: boolean;
    page_view: boolean;
  };
  schedule: { start_date: string | null; target_date: string | null };
  derived: { start_date: string | null; target_date: string | null };
  items: {
    total: number;
    completed: number;
    started: number;
    unstarted: number;
    backlog: number;
    cancelled: number;
    undated: number;
    overdue: number;
    due_week: number;
    unassigned: number;
  };
  cycles: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    total: number;
    completed: number;
    is_active: boolean;
    is_upcoming: boolean;
  }[];
  modules: {
    id: string;
    name: string;
    status: string;
    start_date: string | null;
    target_date: string | null;
    total: number;
    completed: number;
  }[];
  pages: { count: number; recent: { id: string; name: string; updated_at: string }[] };
  links: {
    wiki_url: string | null;
    drive_url: string | null;
    chat_url: string | null;
    github_repo_urls: string[];
  };
  status: TProjectStatusUpdate | null;
  member_count: number;
  warnings: { code: string; message: string; severity: "info" | "warning" | "error" }[];
};

// Which LLM the planning assistant talks to. The key itself is write-only —
// the API only ever reports whether one is set and where it came from.
export type TAiSettings = {
  configured: boolean;
  provider: string;
  model: string;
  base_url: string;
  has_workspace_key: boolean;
  source: "workspace" | "environment" | "instance" | null;
  active_model: string | null;
  providers?: { value: string; label: string; default_model: string }[];
  default_provider?: string;
  provider_defaults?: Record<string, string>;
};

// One suggested placement for a work item that currently has no dates.
export type TPlanAssignment = {
  issue_id: string;
  name: string;
  sequence_id: number;
  start_date: string;
  target_date: string;
  reason: string;
};

export type TAiPlan = {
  assignments: TPlanAssignment[];
  skipped: string[];
  notes: string;
  undated_count: number;
  provider: string;
  model: string;
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

// An open item in a GitHub-inbox (GHIN) project, offered in the "link GitHub
// tasks to this work item" picker.
export type TGithubInboxItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_identifier: string;
  state: string | null;
  github_url: string | null;
};
