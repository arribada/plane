/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type {
  TAiDraft,
  TAiPlan,
  TAiSettings,
  TBlueprintCatalogue,
  TGithubInboxItem,
  TPlannedSprint,
  TPlannedTask,
  TSetupApplyResult,
  TSetupPlan,
  TIssueRelationEdge,
  TProjectOverview,
  TMyWorkItem,
  TPortfolioItem,
  TPortfolioProject,
  TNonWorkingDay,
  TProjectBudget,
  TProjectDocs,
  TProcurementRequest,
  TProjectExpense,
  TCurrencySettings,
  TRolePreset,
  TRoleRate,
  TIssueEffort,
  TProjectSchedule,
  TProjectStatus,
  TProjectStatusUpdate,
  TPublicTimeline,
  TPublicTimelineLink,
  TPublicTimelineState,
  TTeamMember,
  TUserTimeline,
  TWorkspacePublicTimeline,
} from "@/plane-web/types/arribada";

// The roster endpoint answers with the vocabulary too, so the editor can offer
// the same disciplines the server accepts instead of hardcoding a second list.
export type TProjectTeamResponse = { roles_vocabulary: { value: string; label: string }[]; team: TTeamMember[] };

// Talks to the fork-only /api/arribada/ endpoints (plane.arribada Django app).
// Same origin + session cookie: no auth wiring beyond what APIService already does.
export class ArribadaService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getPortfolio(workspaceSlug: string, includeArchived = false): Promise<TPortfolioProject[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/portfolio/`, {
      params: { include_archived: includeArchived },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjectItems(workspaceSlug: string, projectId: string, undatedOnly = false): Promise<TPortfolioItem[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/items/`, {
      params: { undated: undatedOnly },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // All planning relations (finish_before/start_before/blocked_by) of a project's
  // issues, in one call — so the gantt can draw dependency arrows without N fetches.
  /** Where the proof of one work item lives. Pointers, never copies. */
  async getIssueArtifacts(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<
    {
      id: string;
      kind: "wiki" | "drive" | "github" | "other";
      url: string;
      label: string;
      created_by_name: string | null;
    }[]
  > {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/artifacts/`)
      .then((r) => r?.data?.artifacts ?? [])
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** The server guesses the kind from the host and refuses anything not http(s). */
  async addIssueArtifact(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    url: string,
    label: string
  ): Promise<{
    id: string;
    kind: "wiki" | "drive" | "github" | "other";
    url: string;
    label: string;
    created_by_name: string | null;
  }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/artifacts/`, {
      url,
      label,
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async removeIssueArtifact(workspaceSlug: string, projectId: string, issueId: string, id: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/artifacts/`, {
      id,
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Propose a work item's fields from its title. Writes nothing. */
  async aiDraftWorkItem(
    workspaceSlug: string,
    projectId: string,
    title: string
  ): Promise<{
    description: string;
    role: string | null;
    priority: string | null;
    estimate_days: number | null;
    is_milestone: boolean;
    confidence: string;
  }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/ai-draft-item/`, { title })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Every marked deliverable across the workspace, soonest first (Home widget). */
  async getWorkspaceDeliverables(workspaceSlug: string): Promise<
    {
      issue_id: string;
      kind: string;
      label: string;
      target_date: string | null;
      done: boolean;
      project_id: string;
      project_name: string;
      project_identifier: string;
    }[]
  > {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/deliverables/`)
      .then((r) => r?.data?.deliverables ?? [])
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Purchase requests waiting on THIS user's decision, across every project. */
  async getMyApprovals(workspaceSlug: string): Promise<
    {
      id: string;
      label: string;
      total: number;
      currency: string;
      supplier: string;
      requested_by_name: string | null;
      needed_by: string | null;
      created_at: string;
      project_id: string;
      project_name: string;
    }[]
  > {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/my-approvals/`)
      .then((r) => r?.data?.requests ?? [])
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Which of a project's work items are deliverables. Whole project in one call. */
  async getProjectMilestones(
    workspaceSlug: string,
    projectId: string
  ): Promise<
    {
      issue_id: string;
      kind: "gate" | "delivery" | "review";
      label: string;
      start_date: string | null;
      target_date: string | null;
      done: boolean;
    }[]
  > {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/milestones/`)
      .then((r) => r?.data?.milestones ?? [])
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Mark or unmark one item. `kind: null` removes the mark. */
  async setProjectMilestone(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    kind: "gate" | "delivery" | "review" | null,
    label?: string
  ): Promise<unknown> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/milestones/`, {
      issue_id: issueId,
      kind,
      label: label ?? "",
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async getProjectRelations(workspaceSlug: string, projectId: string): Promise<TIssueRelationEdge[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/relations/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Per-issue completion % for the whole project, in one call, to fill gantt bars.
  async getProjectProgress(workspaceSlug: string, projectId: string): Promise<{ issue_id: string; percent: number }[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/progress/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Frozen baseline dates of a project's issues (ghost bars behind the live ones).
  /** The project's named snapshots, plus the entries of the one asked for (the
   *  newest when none is). */
  async getBaseline(
    workspaceSlug: string,
    projectId: string,
    baselineId?: string
  ): Promise<{
    baselines: {
      id: string;
      name: string;
      captured_at: string;
      captured_by_name: string | null;
      note: string;
      entry_count: number;
    }[];
    selected: string | null;
    entries: { issue_id: string | null; name: string; start_date: string | null; target_date: string | null }[];
  }> {
    return this.get(
      `/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/baseline/${
        baselineId ? `?baseline=${encodeURIComponent(baselineId)}` : ""
      }`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Freeze the current dates of every issue in the project as the new baseline.
  /** Remove one snapshot. Named in the body so a mis-click cannot wipe a plan. */
  async deleteBaseline(workspaceSlug: string, projectId: string, id: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/baseline/`, { id })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Freezes the current dates as a NEW snapshot. Never overwrites one. */
  async captureBaseline(
    workspaceSlug: string,
    projectId: string,
    name?: string
  ): Promise<{ id: string; name: string; captured: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/baseline/`, { name })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Forward-cascade the project's dates along dependencies (respect links). Writes.
  async autoSchedule(workspaceSlug: string, projectId: string): Promise<{ rescheduled: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/auto-schedule/`, {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Issue ids on the project's critical (longest-duration) dependency chain.
  async getCriticalPath(
    workspaceSlug: string,
    projectId: string
    // `slack` is the useful half: free/total working days per issue. `issue_ids` is
    // the chain, kept for callers that only want the boolean.
  ): Promise<{ issue_ids: string[]; slack?: Record<string, { free: number; total: number; critical: boolean }> }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/critical-path/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // A project's documentation pointers: wiki doc + Google Drive URL.
  async getWikiDoc(workspaceSlug: string, projectId: string): Promise<TProjectDocs> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/wiki-doc/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Partial update: only the keys you pass are changed (each link edits independently).
  async setWikiDoc(
    workspaceSlug: string,
    projectId: string,
    data: {
      doc_id?: string;
      title?: string;
      google_drive_url?: string;
      chat_url?: string;
      github_repo_urls?: string[];
    }
  ): Promise<TProjectDocs> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/wiki-doc/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Adopt inbox items (e.g. GHIN) into a project — lossless copy + relates_to link.
  // Pass targetParentId to nest the copies under a work item (that item then
  // "contains" the adopted GitHub tasks as sub-issues).
  async adoptIssues(
    workspaceSlug: string,
    sourceIssueIds: string[],
    targetProjectId: string,
    targetParentId?: string
  ): Promise<{ adopted: number; parent_id: string | null }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/adopt-issues/`, {
      source_issue_ids: sourceIssueIds,
      target_project_id: targetProjectId,
      ...(targetParentId ? { target_parent_id: targetParentId } : {}),
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Open items waiting in the GitHub-inbox (GHIN) project, for the "link GitHub
  // tasks to this work item" picker.
  async listGithubInbox(workspaceSlug: string): Promise<TGithubInboxItem[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/github-inbox/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Per-person workload across the workspace.
  async getWorkload(workspaceSlug: string): Promise<
    {
      user_id: string;
      name: string;
      email: string;
      avatar: string | null;
      assigned: number;
      overdue: number;
      due_week: number;
      points: number;
    }[]
  > {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/workload/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Clone a project (template) into a new one: copies states, work items, parent
  // links and dependencies; shifts dates onto kickoff_date when provided.
  async cloneProject(
    workspaceSlug: string,
    sourceProjectId: string,
    data: { name: string; identifier: string; kickoff_date?: string | null }
  ): Promise<{
    project_id: string;
    identifier: string;
    issues_created: number;
    relations_created: number;
    date_shifted: boolean;
  }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${sourceProjectId}/clone/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Program-level critical path + cross-project dependency edges across visible projects.
  async getWorkspaceCriticalPath(workspaceSlug: string): Promise<{
    issue_ids: string[];
    edges: { from: string; to: string; kind: string; cross_project: boolean; critical: boolean }[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/critical-path/`)
      .then((response) => response?.data ?? { issue_ids: [], edges: [] })
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Latest status update per project across the workspace (portfolio pills).
  async getWorkspaceStatuses(workspaceSlug: string): Promise<Record<string, TProjectStatusUpdate>> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/project-statuses/`)
      .then((response) => response?.data ?? {})
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Recent status updates for one project.
  async getProjectStatuses(workspaceSlug: string, projectId: string): Promise<TProjectStatusUpdate[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/status/`)
      .then((response) => response?.data ?? [])
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Post a new status update on a project.
  async postProjectStatus(
    workspaceSlug: string,
    projectId: string,
    data: { status: TProjectStatus; message?: string }
  ): Promise<TProjectStatusUpdate> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/status/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // The requesting user's open assigned work items (Home 'My tasks' widget).
  async getMyWork(workspaceSlug: string): Promise<TMyWorkItem[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/my-work/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Every dated work item assigned to one user, across every project the caller can
  // see — the profile Timeline tab. Not getMyWork(): that one is the caller's own
  // open items with no start_date, so every bar would be a sliver at its due date.
  async getUserTimeline(workspaceSlug: string, userId: string): Promise<TUserTimeline> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/users/${userId}/timeline/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Shared project folders (sidebar grouping).
  async getFolders(
    workspaceSlug: string
  ): Promise<{ id: string; name: string; parent_id: string | null; sort_order: number; project_ids: string[] }[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/project-folders/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createFolder(
    workspaceSlug: string,
    name: string,
    parentId?: string | null
  ): Promise<{ id: string; name: string }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/project-folders/`, {
      name,
      parent_id: parentId ?? null,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Re-parent a folder; null puts it back at the top level. The server refuses a
   *  cycle, so a rejected move is a message, not a broken tree. */
  async moveFolder(workspaceSlug: string, folderId: string, parentId: string | null): Promise<unknown> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/project-folders/${folderId}/`, {
      parent_id: parentId,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async renameFolder(workspaceSlug: string, folderId: string, name: string): Promise<unknown> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/project-folders/${folderId}/`, { name })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteFolder(workspaceSlug: string, folderId: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/project-folders/${folderId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async assignProjectToFolder(workspaceSlug: string, projectId: string, folderId: string | null): Promise<unknown> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/project-folders/assign/`, {
      project_id: projectId,
      folder_id: folderId,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Everything the project Overview page shows, in one call (counts, cycles,
  // modules, pages, links, warnings) — the alternative was five round trips.
  async getProjectOverview(workspaceSlug: string, projectId: string): Promise<TProjectOverview> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/overview/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Who works on this project and on what — the discipline roster, which is not
  // Plane's permission-level membership.
  async getProjectTeam(workspaceSlug: string, projectId: string): Promise<TProjectTeamResponse> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/team/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Full replace of the roster: whatever is not in `team` is dropped.
  async setProjectTeam(
    workspaceSlug: string,
    projectId: string,
    team: {
      id?: string;
      member_id?: string | null;
      name: string;
      email?: string;
      roles: string[];
      is_lead?: boolean;
    }[]
  ): Promise<TProjectTeamResponse> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/team/`, { team })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Which LLM the planning assistant uses. The key is never returned.
  async getAiSettings(workspaceSlug: string): Promise<TAiSettings> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/ai-settings/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Pass api_key: "__unchanged__" to save the model/provider without retyping the key.
  async setAiSettings(
    workspaceSlug: string,
    data: { provider?: string; model?: string; base_url?: string; api_key?: string }
  ): Promise<TAiSettings> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/ai-settings/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Ask the model to place work items and pick an owner for each. Without
  // issue_ids it plans the project's undated items; with them it plans exactly
  // those, dated or not. Proposes only — the caller reviews the rows and then
  // calls applyPlan.
  async aiPlan(
    workspaceSlug: string,
    projectId: string,
    data: {
      start_date?: string | null;
      target_date?: string | null;
      default_duration_days?: number;
      context?: string;
      issue_ids?: string[];
    }
  ): Promise<TAiPlan> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/ai-plan/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Write an approved set of dates — and owners, when the row carries any —
  // onto work items. `assignees_rejected` lists the people the API refused
  // because they are not assignable members of the project.
  async applyPlan(
    workspaceSlug: string,
    projectId: string,
    issues: { issue_id: string; start_date: string; target_date: string; assignee_ids?: string[] }[]
  ): Promise<{ applied: number; rejected: string[]; assigned?: number; assignees_rejected?: string[] }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/apply-plan/`, { issues })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // The generic V-cycle catalogue the setup wizard ticks through. Served rather
  // than hardcoded here so the list the user picks from is the list the server
  // schedules and writes.
  async getTaskBlueprints(workspaceSlug: string): Promise<TBlueprintCatalogue> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/task-blueprints/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Turn the wizard's answers into a dated, owned, sprint-cut plan. Writes
  // nothing: dates come from a deterministic pass over the dependency graph, and
  // the model — when use_ai is set — only adjusts durations and adds tasks.
  async setupPlan(
    workspaceSlug: string,
    projectId: string,
    data: {
      tracks: string[];
      task_keys?: string[];
      start_date?: string | null;
      capacity?: Record<string, number>;
      duration_overrides?: Record<string, number>;
      // {task key: discipline the lead moved it to}, replacing the catalogue's.
      role_overrides?: Record<string, string>;
      field_days?: number | null;
      production_days?: number | null;
      sprints?: { mode: "sprints" | "flow"; length_days?: number | null; count?: number | null };
      // "agile" swaps the V-cycle task set for iteration blocks. Only consulted
      // when the project runs in sprints — a continuous flow is the V.
      method?: "vcycle" | "agile";
      /** Which per-sprint ceremonies to include; omitted means all of them. */
      ceremonies?: string[];
      use_ai?: boolean;
      context?: string;
      // {task key: user id} — naming who does a task instead of leaving it to
      // whoever holds the discipline. Optional, per task.
      assignees?: Record<string, string>;
      // Dates typed by hand: fixed, with the rest of the plan reflowing around them.
      fixed_dates?: Record<string, { start_date: string; target_date: string }>;
      // Redrawn dependencies, replacing what the catalogue wired.
      dependencies?: Record<string, string[]>;
      // Tasks the assistant added on an earlier pass, handed back so re-planning
      // after a change of owner reuses them instead of paying for another call.
      extra_tasks?: TPlannedTask[];
    }
  ): Promise<TSetupPlan> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/setup-plan/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Write an approved plan: work items, their dependencies, the discipline each
  // needs, a module per component and a cycle per sprint. Re-runnable — a task
  // whose name already exists is skipped rather than duplicated.
  async setupApply(
    workspaceSlug: string,
    projectId: string,
    data: {
      tasks: TPlannedTask[];
      sprints?: TPlannedSprint[];
      create_modules?: boolean;
      set_project_window?: boolean;
    }
  ): Promise<TSetupApplyResult> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/setup-apply/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Finish a work item from its title: description, effort, discipline and whoever
  // holds it. Proposes only — the caller drops it into the still-editable form.
  async aiDraft(
    workspaceSlug: string,
    projectId: string,
    data: { title: string; context?: string }
  ): Promise<TAiDraft> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/ai-draft/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Empty a project, one category at a time. `confirm` must be the project
  // identifier — the server refuses otherwise, so a stray click cannot do this.
  async cleanProject(
    workspaceSlug: string,
    projectId: string,
    data: {
      confirm: string;
      work_items?: boolean;
      cycles?: boolean;
      modules?: boolean;
      roles?: boolean;
      team?: boolean;
      schedule?: boolean;
      links?: boolean;
    }
  ): Promise<{ removed: Record<string, number> }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/clean/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getSchedule(workspaceSlug: string, projectId: string): Promise<TProjectSchedule> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/schedule/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateSchedule(
    workspaceSlug: string,
    projectId: string,
    data: Partial<
      Pick<
        TProjectSchedule,
        | "start_date"
        | "target_date"
        | "budget_amount"
        | "budget_currency"
        | "schedule_from_deliveries"
        // Lead-only, enforced server-side: a member who could unlock the timeline
        // is not looking at a locked timeline.
        | "timeline_locked"
        | "allow_edit_others"
        | "allow_add_items"
      >
    >
  ): Promise<TProjectSchedule> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/schedule/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // --- cost -----------------------------------------------------------------

  /** The workspace's own closures AND the statutory holidays of a country,
   *  kept apart: one is a decision that applies to everyone, the other is law
   *  and differs between the two countries this team works from. */
  async getCalendar(
    workspaceSlug: string,
    country?: string
  ): Promise<{
    days: TNonWorkingDay[];
    country?: string;
    countries?: { value: string; label: string }[];
    statutory?: { date: string; name: string }[];
  }> {
    return this.get(
      `/api/arribada/workspaces/${workspaceSlug}/calendar/${country ? `?country=${encodeURIComponent(country)}` : ""}`
    )
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async addNonWorkingDay(workspaceSlug: string, data: { date: string; name?: string }): Promise<TNonWorkingDay> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/calendar/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async removeNonWorkingDay(workspaceSlug: string, date: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/calendar/?date=${encodeURIComponent(date)}`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * The rates, the vocabulary they can attach to, and the indicative figures to
   * offer where a rate is missing. `known_roles` was typed as string[] and never
   * read, so nothing caught that the server answers with {value,label} pairs.
   */
  async getRoleRates(workspaceSlug: string): Promise<{
    rates: TRoleRate[];
    known_roles: { value: string; label: string }[];
    presets: TRolePreset[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/role-rates/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async getCurrencySettings(workspaceSlug: string): Promise<TCurrencySettings> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/currency/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Workspace admin only, the same gate the hourly rates sit behind. */
  async saveCurrencySettings(
    workspaceSlug: string,
    data: { display_currency?: string; eur_gbp_rate?: number; rate_captured_on?: string | null }
  ): Promise<TCurrencySettings> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/currency/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async saveRoleRates(workspaceSlug: string, rates: TRoleRate[]): Promise<{ rates: TRoleRate[] }> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/role-rates/`, { rates })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async getExpenses(workspaceSlug: string, projectId: string): Promise<{ expenses: TProjectExpense[] }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async addExpense(workspaceSlug: string, projectId: string, data: Partial<TProjectExpense>): Promise<TProjectExpense> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async updateExpense(
    workspaceSlug: string,
    projectId: string,
    expenseId: string,
    data: Partial<TProjectExpense>
  ): Promise<TProjectExpense> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/${expenseId}/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async deleteExpense(workspaceSlug: string, projectId: string, expenseId: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/${expenseId}/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * `display` reads the same budget in one currency for this call only. Leaving it
   * off falls back to the workspace's choice, which is how the switch is meant to
   * be set — looking at a budget in sterling should not change it for everybody.
   */
  async getBudget(workspaceSlug: string, projectId: string, display?: string): Promise<TProjectBudget> {
    const query = display ? `?display=${encodeURIComponent(display)}` : "";
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/budget/${query}`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async getProcurement(
    workspaceSlug: string,
    projectId: string
  ): Promise<{ requests: TProcurementRequest[]; can_approve: boolean }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async requestPurchase(
    workspaceSlug: string,
    projectId: string,
    data: Partial<TProcurementRequest>
  ): Promise<TProcurementRequest> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** The purchasing record past the money decision: ordered, expected, arrived. */
  async trackPurchase(
    workspaceSlug: string,
    projectId: string,
    requestId: string,
    data: {
      status?: "approved" | "ordered" | "received";
      order_reference?: string;
      ordered_on?: string | null;
      expected_on?: string | null;
      received_on?: string | null;
      issue_id?: string | null;
    }
  ): Promise<TProcurementRequest> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/${requestId}/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Lead only. Approving is what writes the expense line. */
  async decidePurchase(
    workspaceSlug: string,
    projectId: string,
    requestId: string,
    decision: "approved" | "rejected",
    note?: string
  ): Promise<TProcurementRequest> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/${requestId}/`, {
      decision,
      note,
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async withdrawPurchase(workspaceSlug: string, projectId: string, requestId: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/${requestId}/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * One row per person, their dated work across every visible project, and the
   * periods where two of their own items collide.
   *
   * The overlap regions arrive computed. They are not derived here on purpose: the
   * roster's leave and part-time data has never left the server, and a second
   * definition of "these two collide" in TypeScript would drift from the planner's.
   */
  async getWorkloadTimeline(
    workspaceSlug: string,
    params?: { from?: string; to?: string; includeEmpty?: boolean }
  ): Promise<TWorkloadTimeline> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/workload-timeline/`, {
      params: {
        ...(params?.from ? { from: params.from } : {}),
        ...(params?.to ? { to: params.to } : {}),
        ...(params?.includeEmpty ? { include_empty: true } : {}),
      },
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * Propose the work for ONE sprint from a sentence. Nothing is saved; the
   * wizard shows the rows editable and only its Create writes anything.
   *
   * `defaults` are the tasks already on the sprint. They are sent so the model
   * adds to them instead of proposing "Sprint planning session" beside the
   * "Sprint planning" that is already there.
   */
  async aiSprintTasks(
    workspaceSlug: string,
    projectId: string,
    data: { context: string; defaults: string[]; count?: number }
  ): Promise<{ name: string; role: string; estimate_days: number }[]> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/ai-sprint-tasks/`, data)
      .then((r) => r?.data?.tasks ?? [])
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * How much work a task is, in person-days. `days: null` clears it.
   *
   * The reply carries a suggested span when the item is missing a date — offered,
   * never applied: the server does not move dates, and neither does this.
   */
  async getIssueEffort(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueEffort> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/effort/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async setIssueEffort(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    days: number | null
  ): Promise<TIssueEffort> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/effort/`, {
      days,
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * Pull GitHub issues now rather than waiting for the nightly run.
   *
   * Runs inline server-side, so the reply says what actually happened — a queued
   * job returning an id would tell the caller nothing about whether the token is
   * set, the repos are mapped, or anything arrived.
   */
  async githubSyncNow(
    workspaceSlug: string,
    projectId: string
  ): Promise<{ created: number; updated: number; fetched: number; skipped: string | null }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/github-sync/`, {})
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Which discipline a work item belongs to, and the ones this project offers. */
  async getIssueRole(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<{ role: string | null; options: string[] }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/role/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * `role: null` clears it. The reply carries `assigned` when setting the role
   * put the item on somebody — which happens only when exactly one person on the
   * roster holds that discipline and the item had no assignee.
   */
  async setIssueRole(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    role: string | null
  ): Promise<{ role: string | null; assigned: string | null }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/role/`, {
      role,
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Dated items with no discipline, plus what each one's assignee implies. */
  async getDisciplineGap(
    workspaceSlug: string,
    projectId: string
  ): Promise<{
    items: {
      id: string;
      name: string;
      sequence_id: number;
      start_date: string;
      target_date: string;
      suggested: string | null;
    }[];
    options: string[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/discipline-gap/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** {issue id: discipline}. Applies the same auto-assign rule as the single field. */
  async setDisciplineGap(
    workspaceSlug: string,
    projectId: string,
    assignments: Record<string, string>
  ): Promise<{ written: number; assigned: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/discipline-gap/`, {
      assignments,
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Add a discipline this project needs. Deliberately does not require a holder:
   *  the reason to add one is usually that nobody covers it yet. */
  async createProjectDiscipline(
    workspaceSlug: string,
    projectId: string,
    name: string
  ): Promise<{ name: string; options: string[] }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/disciplines/`, { name })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Open work items with nobody on them, and who could take them. */
  async getAssigneeGap(
    workspaceSlug: string,
    projectId: string
  ): Promise<{
    items: {
      id: string;
      name: string;
      sequence_id: number;
      start_date: string | null;
      target_date: string | null;
      role: string | null;
      suggested: string | null;
    }[];
    members: { id: string; name: string; email: string }[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/assignee-gap/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** {issue id: user id}. */
  async setAssigneeGap(
    workspaceSlug: string,
    projectId: string,
    assignments: Record<string, string>
  ): Promise<{ written: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/assignee-gap/`, {
      assignments,
    })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Work items missing a start or an end, with a span suggested from effort. */
  async getUndatedGap(
    workspaceSlug: string,
    projectId: string
  ): Promise<{
    items: {
      id: string;
      name: string;
      sequence_id: number;
      start_date: string | null;
      target_date: string | null;
      suggested_start: string;
      suggested_target: string;
      effort_days: number | null;
    }[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/undated-gap/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** {issue id: {start_date, target_date}}. `rejected` counts spans that ended
   *  before they began — refused rather than silently swapped. */
  async setUndatedGap(
    workspaceSlug: string,
    projectId: string,
    dates: Record<string, { start_date: string; target_date: string }>
  ): Promise<{ written: number; rejected: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/undated-gap/`, { dates })
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /** Why the GitHub inbox is still full, split by what you can actually do. */
  async getGithubInboxGap(workspaceSlug: string): Promise<{
    unclaimed: { repo: string; count: number; synced: boolean }[];
    contested: { repo: string; count: number; projects: string[] }[];
    total: number;
    inbox_project_id?: string;
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/github-inbox-gap/`)
      .then((r) => r?.data)
      .catch(() => ({ unclaimed: [], contested: [], total: 0 }));
  }

  // --- Public project timeline -----------------------------------------------

  async getPublicTimelineState(workspaceSlug: string, projectId: string): Promise<TPublicTimelineState> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/public-timeline/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  /**
   * Publishing twice returns the SAME anchor. Minting a fresh one would silently
   * kill a URL already sitting in somebody's inbox.
   */
  async publishTimeline(workspaceSlug: string, projectId: string): Promise<TPublicTimelineLink> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/public-timeline/`, {})
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async revokeTimeline(workspaceSlug: string, projectId: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/public-timeline/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async getWorkspacePublicTimelines(workspaceSlug: string): Promise<TWorkspacePublicTimeline[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/public-timelines/`)
      .then((r) => r?.data?.links ?? [])
      .catch(() => []);
  }

  /**
   * Read with no account. The anchor is the only credential, so nothing else is
   * passed. The whole response is rethrown rather than `.data`: the page has to
   * tell 404 (never existed) from 410 (revoked), and only the status says which.
   */
  async getPublicTimeline(anchor: string): Promise<TPublicTimeline> {
    return this.get(`/api/arribada/public/timeline/${anchor}/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response;
      });
  }
}

// --- Workload timeline -------------------------------------------------------
// Declared here beside the only call that produces them, the way
// TProjectTeamResponse above is, rather than in types/arribada.ts.

/** A period where two or more of one person's items are live at the same time. */
export type TWorkloadOverlap = {
  start: string;
  end: string;
  /**
   * Working days lost to the double-booking. Weekends, workspace holidays and the
   * person's own leave are already removed, so `days` is time that actually clashes
   * rather than calendar days two ranges happen to share.
   */
  days: number;
  issue_ids: string[];
};

export type TWorkloadTimelineItem = {
  id: string;
  name: string;
  sequence_id: number;
  /** Both null-able: an item with only one date is drawn as a marker, never a bar. */
  start_date: string | null;
  target_date: string | null;
  priority: string;
  state_group: string | null;
  project_id: string;
  project_identifier: string;
  project_name: string;
  assignee_ids: string[];
};

export type TWorkloadTimelinePerson = {
  user_id: string;
  name: string;
  email: string;
  avatar: string | null;
  /** The synthetic row holding work nobody owns. Never overlap-checked. */
  is_unassigned: boolean;
  is_active_member: boolean;
  assigned: number;
  overdue: number;
  due_week: number;
  points: number;
  /** Smallest week any project's roster records for this person; 5 when unknown. */
  days_per_week: number;
  roles: string[];
  leave: { start: string; end: string }[];
  /** Ids into `items` — an item with two assignees appears under both people. */
  item_ids: string[];
  dated_count: number;
  /** Open work that cannot be drawn: one date only, and no dates at all. */
  partial_count: number;
  undated_count: number;
  conflict_count: number;
  conflict_days: number;
  overlaps: TWorkloadOverlap[];
};

export type TWorkloadTimeline = {
  window: { from: string; to: string };
  today: string;
  holidays: string[];
  people: TWorkloadTimelinePerson[];
  items: TWorkloadTimelineItem[];
  /** People with no open work at all, left out unless include_empty was asked for. */
  hidden_people_count: number;
  /** True when the item cap was hit and the board is showing an incomplete picture. */
  truncated: boolean;
};
