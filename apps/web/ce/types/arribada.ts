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

// Where a project's documentation lives: a wiki doc + a Google Drive URL.
export type TProjectDocs = {
  doc_id: string | null;
  workspace_id: string | null;
  title: string | null;
  google_drive_url: string | null;
  chat_url: string | null;
  github_repo_urls: string[];
};

// Someone on a project's roster, with the disciplines they cover. Plane's own
// ProjectMember.role is a permission level (admin/member/guest), never a job
// function, so the roster is a separate list that can also hold people who have
// no Plane account at all. `in_plane` = an account is linked; `assignable` = that
// account is an active member of this project and may receive work items.
export type TTeamMember = {
  id: string;
  member_id: string | null;
  name: string;
  email: string;
  roles: string[];
  is_lead: boolean;
  source: "manual" | "wiki";
  in_plane: boolean;
  assignable: boolean;
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
  team: TTeamMember[];
  member_count: number;
  // How many roster entries still have no discipline set. Optional so an older
  // API, which never sends the key, still parses.
  roles_pending?: number;
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

// One suggested placement for a work item: a window, and the person the
// assistant picked for it. `assignee_id` is null whenever nobody on the roster
// could take it (no Plane account, or not an assignable member of the project) —
// the row is still worth applying for its dates.
export type TPlanAssignment = {
  issue_id: string;
  name: string;
  sequence_id: number;
  start_date: string;
  target_date: string;
  reason: string;
  assignee_id: string | null;
  assignee_name: string | null;
  // The discipline the assistant matched the item to, null when it picked
  // someone without leaning on the roster's roles.
  role: string | null;
};

export type TAiPlan = {
  assignments: TPlanAssignment[];
  skipped: string[];
  notes: string;
  undated_count: number;
  // How many items were actually in scope: the selection when one was sent,
  // the undated items otherwise. Optional so an older API still parses.
  requested_count?: number;
  provider: string;
  model: string;
};

// ---------------------------------------------------------------------------
// Project setup: the generic V-cycle catalogue, and a plan built from it
// ---------------------------------------------------------------------------

// One generic task the wizard offers to create. `after` names the keys it waits
// on, which is what makes the proposed schedule a graph rather than a list.
export type TBlueprintTask = {
  key: string;
  name: string;
  phase: string;
  phase_label: string;
  role: string;
  days: number;
  optional: boolean;
  after: string[];
};

export type TBlueprintTrack = {
  key: string;
  label: string;
  hint: string;
  tasks: TBlueprintTask[];
};

// The blocks an agile project is built from. The per-sprint ceremonies are described
// once and repeated for every sprint, so ticking one applies to all of them.
export type TAgileCatalogue = {
  setup: { key: string; name: string; role: string; days: number }[];
  spikes: { key: string; name: string; role: string; days: number; track: string }[];
  ceremonies: { key: string; name: string; role: string; days: number; optional: boolean }[];
  closing: { key: string; name: string; role: string; days: number }[];
};

export type TBlueprintCatalogue = {
  tracks: TBlueprintTrack[];
  phases: { key: string; label: string }[];
  agile: TAgileCatalogue;
};

// A task once the scheduler has placed it: dates, the person its discipline
// resolves to today, and the sprint its start falls in.
export type TPlannedTask = {
  key: string;
  name: string;
  track: string;
  phase: string;
  role: string;
  days: number;
  after: string[];
  start_date: string;
  target_date: string;
  assignee_id: string | null;
  assignee_name: string | null;
  sprint: number | null;
  // True when the lead named this task's owner rather than letting the schedule
  // pick whoever holds the discipline.
  pinned?: boolean;
  // Set on tasks the assistant added on top of the catalogue.
  added?: boolean;
};

// Someone the plan may hand a task to: a roster entry with a Plane account that
// the project would actually accept as an assignee.
export type TPlanPerson = {
  id: string;
  name: string;
  roles: string[];
};

export type TPlannedSprint = {
  index: number;
  name: string;
  start_date: string;
  end_date: string;
  task_count: number;
};

export type TSetupPlan = {
  start_date: string;
  end_date: string;
  tasks: TPlannedTask[];
  sprints: TPlannedSprint[];
  capacity: Record<string, number>;
  role_counts: Record<string, number>;
  // Who can be named on a task. The scheduler treats each of them as one pair of
  // hands, so somebody covering two disciplines queues their own work.
  people: TPlanPerson[];
  // Disciplines this plan needs that nobody on the roster holds. Not an error —
  // the requirement is recorded on the item and resolves when someone picks it up.
  missing_roles: string[];
  warnings: string[];
  notes: string;
  provider: string | null;
  model: string | null;
};

export type TSetupApplyResult = {
  created: number;
  skipped: string[];
  relations: number;
  roles_set: number;
  assigned: number;
  modules_created: number;
  cycles_created: number;
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
