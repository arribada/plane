/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import { rethrow } from "./api-error";
import type {
  TAiDraft,
  TAiPlan,
  TAiSettings,
  TBlueprintCatalogue,
  TCriticalPathDiagnostics,
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
  TDriveLink,
  TProjectDocs,
  TProcurementRequest,
  TProjectExpense,
  TCurrencySettings,
  TRolePreset,
  TRoleRate,
  TIssueEffort,
  TIssueFixedCost,
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
export type TProjectTeamResponse = {
  roles_vocabulary: { value: string; label: string }[];
  team: TTeamMember[];
  /** Work items the roster edit just handed to somebody. Absent on an older server. */
  reassigned?: number;
  /** People this request actually took off the project. An id naming nobody is
   *  ignored rather than refused, so a caller that meant to remove three and
   *  removed none needs to be able to see that. Absent on an older server. */
  removed?: number;
};

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
      .catch(rethrow);
  }

  async getProjectItems(workspaceSlug: string, projectId: string, undatedOnly = false): Promise<TPortfolioItem[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/items/`, {
      params: { undated: undatedOnly },
    })
      .then((response) => response?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  async removeIssueArtifact(workspaceSlug: string, projectId: string, issueId: string, id: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/artifacts/`, {
      id,
    })
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  /** Which of a project's work items are deliverables. Whole project in one call. */
  async getProjectMilestones(
    workspaceSlug: string,
    projectId: string
  ): Promise<
    {
      issue_id: string;
      kind: "gate" | "delivery" | "review";
      /** Already resolved: the custom label, or the item's own name. */
      label: string;
      /** The custom label alone, "" when nobody wrote one. Absent on an older
       *  server, which had no way to set one either. */
      custom_label?: string;
      start_date: string | null;
      target_date: string | null;
      done: boolean;
    }[]
  > {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/milestones/`)
      .then((r) => r?.data?.milestones ?? [])
      .catch(rethrow);
  }

  /**
   * Mark or unmark one item, or rename what a funder reads.
   *
   * `kind: null` removes the mark; `kind: undefined` omits the key entirely and
   * changes only the label. The two are not interchangeable — the server reads
   * an absent `kind` as "leave the mark alone" and a null one as "take it off",
   * and it used to read both as the second.
   */
  async setProjectMilestone(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    kind: "gate" | "delivery" | "review" | null | undefined,
    label?: string
  ): Promise<unknown> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/milestones/`, {
      issue_id: issueId,
      ...(kind === undefined ? {} : { kind }),
      // Omitted, not blanked, when the caller has no label to offer. Sending
      // `""` told the server to erase one — so changing a kind from any surface
      // that does not carry the label wiped the sentence a funder reads.
      ...(label === undefined ? {} : { label }),
    })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async getProjectRelations(workspaceSlug: string, projectId: string): Promise<TIssueRelationEdge[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/relations/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Per-issue completion % for the whole project, in one call, to fill gantt bars.
  async getProjectProgress(workspaceSlug: string, projectId: string): Promise<{ issue_id: string; percent: number }[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/progress/`)
      .then((response) => response?.data)
      .catch(rethrow);
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
      .catch(rethrow);
  }

  // Freeze the current dates of every issue in the project as the new baseline.
  /** Remove one snapshot. Named in the body so a mis-click cannot wipe a plan. */
  async deleteBaseline(workspaceSlug: string, projectId: string, id: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/baseline/`, { id })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Freezes the current dates as a NEW snapshot. Never overwrites one. */
  async captureBaseline(
    workspaceSlug: string,
    projectId: string,
    name?: string
  ): Promise<{ id: string; name: string; captured: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/baseline/`, { name })
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Forward-cascade the project's dates along dependencies (respect links). Writes.
  async autoSchedule(workspaceSlug: string, projectId: string): Promise<{ rescheduled: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/auto-schedule/`, {})
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Issue ids on the project's critical (longest-duration) dependency chain.
  async getCriticalPath(
    workspaceSlug: string,
    projectId: string
    // `slack` is the useful half: free/total working days per issue. `issue_ids` is
    // the chain, kept for callers that only want the boolean.
  ): Promise<{
    issue_ids: string[];
    slack?: Record<string, { free: number; total: number; critical: boolean }>;
    /** ISO date an item cannot start before, because it is waiting on a delivery.
     *  Absent on a backend that predates it, and `{}` on every project that has
     *  not turned `schedule_from_deliveries` on — which is most of them. */
    delivery_floors?: Record<string, string>;
    /** Why the chain is empty when it is. Optional: an older backend does not
     *  send it, and the banner draws nothing rather than inventing a cause. */
    diagnostics?: TCriticalPathDiagnostics;
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/critical-path/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // A project's documentation pointers: wiki doc + Google Drive URL.
  async getWikiDoc(workspaceSlug: string, projectId: string): Promise<TProjectDocs> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/wiki-doc/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Partial update: only the keys you pass are changed (each link edits independently).
  async setWikiDoc(
    workspaceSlug: string,
    projectId: string,
    data: {
      doc_id?: string;
      title?: string;
      /** @deprecated Sets the FIRST Drive link and leaves the rest alone. Send
       *  `google_drive_links` instead; this exists for older callers. */
      google_drive_url?: string;
      google_drive_links?: TDriveLink[];
      chat_url?: string;
      github_repo_urls?: string[];
    }
  ): Promise<TProjectDocs> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/wiki-doc/`, data)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Adopt work items into another project — lossless copy + relates_to link back.
  // Pass targetParentId to nest the copies under a work item. Used by bulk
  // operations; GitHub filing does not go through here, because a captured GitHub
  // issue is not a work item and there is nothing to copy.
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
      .catch(rethrow);
  }

  // Captured GitHub issues nobody has filed or dismissed, for the "link GitHub
  // tasks to this work item" picker.
  async listGithubInbox(workspaceSlug: string): Promise<TGithubInboxItem[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/github-inbox/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  /** File picked inbox issues as sub-issues of one work item. There is nothing to
   *  adopt — these are GitHub records, not work items — so this creates the work
   *  item and records that the GitHub issue became it. */
  async fileGithubInbox(
    workspaceSlug: string,
    ids: string[],
    projectId: string,
    parentIssueId: string
  ): Promise<{ filed: number; skipped: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/github-inbox/`, {
      ids,
      project_id: projectId,
      parent_issue_id: parentIssueId,
    })
      .then((response) => response?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  // Program-level critical path + cross-project dependency edges across visible projects.
  async getWorkspaceCriticalPath(workspaceSlug: string): Promise<{
    issue_ids: string[];
    edges: { from: string; to: string; kind: string; cross_project: boolean; critical: boolean }[];
    diagnostics?: TCriticalPathDiagnostics;
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/critical-path/`)
      .then((response) => response?.data ?? { issue_ids: [], edges: [] })
      .catch(rethrow);
  }

  // Latest status update per project across the workspace (portfolio pills).
  async getWorkspaceStatuses(workspaceSlug: string): Promise<Record<string, TProjectStatusUpdate>> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/project-statuses/`)
      .then((response) => response?.data ?? {})
      .catch(rethrow);
  }

  // Recent status updates for one project.
  async getProjectStatuses(workspaceSlug: string, projectId: string): Promise<TProjectStatusUpdate[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/status/`)
      .then((response) => response?.data ?? [])
      .catch(rethrow);
  }

  // Post a new status update on a project.
  async postProjectStatus(
    workspaceSlug: string,
    projectId: string,
    data: { status: TProjectStatus; message?: string }
  ): Promise<TProjectStatusUpdate> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/status/`, data)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // The requesting user's open assigned work items (Home 'My tasks' widget).
  async getMyWork(workspaceSlug: string): Promise<TMyWorkItem[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/my-work/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Every dated work item assigned to one user, across every project the caller can
  // see — the profile Timeline tab. Not getMyWork(): that one is the caller's own
  // open items with no start_date, so every bar would be a sliver at its due date.
  async getUserTimeline(workspaceSlug: string, userId: string): Promise<TUserTimeline> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/users/${userId}/timeline/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Shared project folders (sidebar grouping).
  async getFolders(
    workspaceSlug: string
  ): Promise<{ id: string; name: string; parent_id: string | null; sort_order: number; project_ids: string[] }[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/project-folders/`)
      .then((response) => response?.data)
      .catch(rethrow);
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
      .catch(rethrow);
  }

  /** Re-parent a folder; null puts it back at the top level. The server refuses a
   *  cycle, so a rejected move is a message, not a broken tree. */
  async moveFolder(workspaceSlug: string, folderId: string, parentId: string | null): Promise<unknown> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/project-folders/${folderId}/`, {
      parent_id: parentId,
    })
      .then((response) => response?.data)
      .catch(rethrow);
  }

  async renameFolder(workspaceSlug: string, folderId: string, name: string): Promise<unknown> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/project-folders/${folderId}/`, { name })
      .then((response) => response?.data)
      .catch(rethrow);
  }

  async deleteFolder(workspaceSlug: string, folderId: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/project-folders/${folderId}/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  async assignProjectToFolder(workspaceSlug: string, projectId: string, folderId: string | null): Promise<unknown> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/project-folders/assign/`, {
      project_id: projectId,
      folder_id: folderId,
    })
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Everything the project Overview page shows, in one call (counts, cycles,
  // modules, pages, links, warnings) — the alternative was five round trips.
  async getProjectOverview(workspaceSlug: string, projectId: string): Promise<TProjectOverview> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/overview/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Who works on this project and on what — the discipline roster, which is not
  // Plane's permission-level membership.
  async getProjectTeam(workspaceSlug: string, projectId: string): Promise<TProjectTeamResponse> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/team/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Upsert the rows in `team`, and remove exactly the ids in `remove`.
  //
  // NOT a full replace, though it used to be. Leaving somebody out no longer
  // deletes them: the payload is built when the editor opens, so a second person
  // editing the team — or one tab left open since this morning — meant Save
  // silently removed everybody added in between. Removal is now something the
  // request says rather than something it implies, and the server asks the lead
  // for it, because a roster row holds the only copy of that person's leave,
  // working pattern and holiday calendar.
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
    }[],
    remove: string[] = []
  ): Promise<TProjectTeamResponse> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/team/`, { team, remove })
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Which LLM the planning assistant uses. The key is never returned.
  async getAiSettings(workspaceSlug: string): Promise<TAiSettings> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/ai-settings/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  // Pass api_key: "__unchanged__" to save the model/provider without retyping the key.
  async setAiSettings(
    workspaceSlug: string,
    data: { provider?: string; model?: string; base_url?: string; api_key?: string }
  ): Promise<TAiSettings> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/ai-settings/`, data)
      .then((response) => response?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  // The generic V-cycle catalogue the setup wizard ticks through. Served rather
  // than hardcoded here so the list the user picks from is the list the server
  // schedules and writes.
  async getTaskBlueprints(workspaceSlug: string): Promise<TBlueprintCatalogue> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/task-blueprints/`)
      .then((response) => response?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  async getSchedule(workspaceSlug: string, projectId: string): Promise<TProjectSchedule> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/schedule/`)
      .then((response) => response?.data)
      .catch(rethrow);
  }

  async updateSchedule(
    workspaceSlug: string,
    projectId: string,
    data: Partial<
      Pick<
        TProjectSchedule,
        | "start_date"
        | "target_date"
        | "lifecycle_status"
        | "budget_amount"
        | "budget_currency"
        | "schedule_from_deliveries"
        // Lead-only, enforced server-side: a member who could unlock the timeline
        // is not looking at a locked timeline.
        | "timeline_locked"
        | "allow_edit_others"
        | "allow_add_items"
        | "lead_only_edits"
      >
    >
  ): Promise<TProjectSchedule> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/schedule/`, data)
      .then((response) => response?.data)
      .catch(rethrow);
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
      .catch(rethrow);
  }

  async addNonWorkingDay(workspaceSlug: string, data: { date: string; name?: string }): Promise<TNonWorkingDay> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/calendar/`, data)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async removeNonWorkingDay(workspaceSlug: string, date: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/calendar/?date=${encodeURIComponent(date)}`)
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
  }

  async getCurrencySettings(workspaceSlug: string): Promise<TCurrencySettings> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/currency/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Workspace admin only, the same gate the hourly rates sit behind. */
  async saveCurrencySettings(
    workspaceSlug: string,
    data: { display_currency?: string; eur_gbp_rate?: number; rate_captured_on?: string | null }
  ): Promise<TCurrencySettings> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/currency/`, data)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async saveRoleRates(workspaceSlug: string, rates: TRoleRate[]): Promise<{ rates: TRoleRate[] }> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/role-rates/`, { rates })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async getExpenses(workspaceSlug: string, projectId: string): Promise<{ expenses: TProjectExpense[] }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async addExpense(workspaceSlug: string, projectId: string, data: Partial<TProjectExpense>): Promise<TProjectExpense> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/`, data)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async updateExpense(
    workspaceSlug: string,
    projectId: string,
    expenseId: string,
    data: Partial<TProjectExpense>
  ): Promise<TProjectExpense> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/${expenseId}/`, data)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async deleteExpense(workspaceSlug: string, projectId: string, expenseId: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/expenses/${expenseId}/`)
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
  }

  async getProcurement(
    workspaceSlug: string,
    projectId: string
  ): Promise<{ requests: TProcurementRequest[]; can_approve: boolean }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async requestPurchase(
    workspaceSlug: string,
    projectId: string,
    data: Partial<TProcurementRequest>
  ): Promise<TProcurementRequest> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/`, data)
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  async withdrawPurchase(workspaceSlug: string, projectId: string, requestId: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/procurement/${requestId}/`)
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  /**
   * What a supplier charges for this work item, and how long they said they
   * would take.
   *
   * The figure is a line in the ordinary expense ledger, so it reaches the
   * Finance page as committed spend rather than as a second, parallel notion of
   * money. `replaces_labour` is what stops the item also being costed as our
   * time — without it a six-week supplier run bills the project twice.
   */
  async getIssueFixedCost(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueFixedCost> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/fixed-cost/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /**
   * The work items on this one's checklist.
   *
   * `done` arrives derived from each member's state group. It is not read back
   * from a column here for the same reason the server does not keep one: the
   * state IS whether the work is finished, and a second copy of that fact would
   * be a second answer to the same question.
   */
  async getIssueChecklist(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueChecklistItem[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/checklist/`)
      .then((r) => r?.data?.items ?? [])
      .catch(rethrow);
  }

  /**
   * done/total for every work item in this project that owns a checklist.
   *
   * The list view's badges in one call. Asking per row was an N+1 that no test
   * catches, because a test never scrolls.
   *
   * Owners with no members are absent from the map rather than sent as a zero:
   * a row with no checklist shows nothing, and a zero per work item would make
   * the payload grow with the project instead of with the feature.
   */
  async getChecklistSummary(workspaceSlug: string, projectId: string): Promise<Record<string, TIssueChecklistSummary>> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/checklist-summary/`)
      .then((r) => r?.data?.summaries ?? {})
      .catch(rethrow);
  }

  /**
   * `name` creates a work item in this project and puts it on the list — what
   * typing a line into a checklist means. `member_issue_id` puts an existing one
   * there, which is what "move this into that" does from the other end.
   */
  async addToIssueChecklist(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    payload: { name: string } | { member_issue_id: string }
  ): Promise<{ id: string; issue_id: string; created: boolean }> {
    return this.post(
      `/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/checklist/`,
      payload
    )
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Takes the LINE off the list. The work item it named goes on existing. */
  async removeFromIssueChecklist(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    id: string
  ): Promise<{ deleted: boolean }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/checklist/`, {
      id,
    })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** What it actually took. Sent on its own, so the estimate is left alone. */
  async setIssueActualEffort(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    actualDays: number | null
  ): Promise<{ actual_days: number | null }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/effort/`, {
      actual_days: actualDays,
    })
      .then((r) => r?.data)
      .catch(rethrow);
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
  ): Promise<{
    created: number;
    updated: number;
    fetched: number;
    repos?: number;
    /** Issues recorded from GitHub, whether or not they became work items. */
    captured?: number;
    /** Issues that became a work item and were linked back to it. */
    filed?: number;
    /** Left for a person: the repo is claimed by nobody, or by several projects. */
    queued?: number;
    dismissed_skipped?: number;
    /** Issues closed on GitHub since the last run, so their rows left the queue. */
    closed_rows?: number;
    /** Work items moved to their project's done state because the issue closed. */
    closed_items?: number;
    /** Of those, ones a person had filed by hand rather than the router. */
    closed_items_manual?: number;
    /** Guards that declined to close something: already_final, partial_link, … */
    close_skipped?: Record<string, number>;
    close_unconfirmed?: number;
    close_deferred?: number;
    /** Repos nothing could place in a workspace — a mapping somebody must fix. */
    skipped_no_workspace?: string[];
    /** Repos whose open list came back short, so nothing there was reconciled. */
    skipped_partial_fetch?: string[];
    /** Only "no token" or "no repos mapped": the run did not happen. */
    skipped: string | null;
  }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/github-sync/`, {})
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Which discipline a work item belongs to, and the ones this project offers. */
  async getIssueRole(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<{ role: string | null; options: string[] }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/role/`)
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  /** Named arrangements of a project's work items. Plane keeps one manual order
   *  and dragging rewrites it in place; these are snapshots of it. */
  async getIssueOrders(
    workspaceSlug: string,
    projectId: string
  ): Promise<{ orders: { id: string; name: string; count: number; updated_at: string | null }[] }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/orders/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Saves the sequence the client is showing, because what is on screen is what
   *  somebody means by "this order". Same name overwrites. */
  async saveIssueOrder(
    workspaceSlug: string,
    projectId: string,
    name: string,
    issueIds: string[]
  ): Promise<{ id: string; name: string; count: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/orders/`, {
      name,
      issue_ids: issueIds,
    })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Restores a saved arrangement by rewriting sort_order to match it. */
  async applyIssueOrder(
    workspaceSlug: string,
    projectId: string,
    orderId: string
  ): Promise<{ applied: number; saved: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/orders/${orderId}/`, {})
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async deleteIssueOrder(workspaceSlug: string, projectId: string, orderId: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/orders/${orderId}/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Freezes an exact sequence as the manual order — used when somebody drags a
   *  row while the view is sorted by something else, so the move lands on the
   *  list they were looking at instead of reshuffling it. */
  async freezeIssueOrder(workspaceSlug: string, projectId: string, issueIds: string[]): Promise<{ applied: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/orders/apply/`, {
      issue_ids: issueIds,
    })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** What the router could not decide: repos several projects claim, and repos
   *  nobody has linked. Everything routable is filed automatically and absent. */
  async getGithubTriageQueue(workspaceSlug: string): Promise<{
    items: {
      id: string;
      repo: string;
      number: number;
      title: string;
      html_url: string;
      labels: string[];
      github_assignees: string[];
      milestone: string;
      state: string;
      created_at: string | null;
      claimed_by: { id: string; name: string }[];
      suggested_project: string | null;
      suggested_discipline: string | null;
    }[];
    projects: { id: string; name: string }[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/github-triage-queue/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** File a batch. `checklist_owner_id` puts the new work items on an existing
   *  one's checklist — grouping without making any of them a sub-issue, which
   *  would propagate into every list, board and timeline. */
  async fileGithubTriage(
    workspaceSlug: string,
    items: { id: string; project_id: string; discipline?: string; assignee_id?: string; checklist_owner_id?: string }[]
  ): Promise<{ filed: number; skipped: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/github-triage-queue/`, { items })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Settle a contested repository for good: the named project keeps it, every
   *  other project it was linked to loses the link, and the router can decide
   *  every future issue from it on its own.
   *
   *  This edits OTHER projects' configuration, so nothing should call it without
   *  asking first. `untouched` names claims outside the caller's visibility, which
   *  are the reason "no more issues from this repo" could still turn out false. */
  async claimGithubRepo(
    workspaceSlug: string,
    repo: string,
    projectId: string
  ): Promise<{
    repo: string;
    kept: { id: string; name: string };
    removed_from: { id: string; name: string }[];
    untouched: { id: string; name: string }[];
    added: boolean;
  }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/github-repo-claim/`, {
      repo,
      project_id: projectId,
    })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** The rows somebody decided were nothing. Kept, never deleted — the archive
   *  is what makes dismissing safe enough to do quickly. */
  async getGithubTriageArchive(workspaceSlug: string): Promise<{
    items: {
      id: string;
      repo: string;
      number: number;
      title: string;
      html_url: string;
      dismissed_at: string | null;
    }[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/github-triage-archive/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Take rows off the queue without filing them anywhere. The sync reads the
   *  same flag, so they do not come back tomorrow. */
  async dismissGithubTriage(workspaceSlug: string, ids: string[]): Promise<{ dismissed: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/github-triage-archive/`, { ids })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Put dismissed rows back in the queue, undecided again. */
  async restoreGithubTriage(workspaceSlug: string, ids: string[]): Promise<{ restored: number }> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/github-triage-archive/`, { ids })
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** The GitHub inbox items no project claims, and where they could be filed.
   *  Behind the daily digest notification, which carries no work item and so
   *  could never show what it was counting. */
  async getGithubUnclassified(workspaceSlug: string): Promise<{
    items: { id: string; name: string; repo: string; number: number; html_url: string }[];
    projects: { id: string; name: string }[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/github-unclassified/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /** Everyone this workspace knows about, for the roster's name field. Built from
   *  the rosters themselves, not from Plane accounts — there are twenty people and
   *  a handful of accounts. */
  async getWorkspaceDirectory(
    workspaceSlug: string
  ): Promise<{ people: { name: string; email: string; roles: string[]; member_id: string | null }[]; total: number }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/directory/`)
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
    members: { id: string; name: string; email: string; assignable: boolean; roles: string[] }[];
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/assignee-gap/`)
      .then((r) => r?.data)
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
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
      .catch(rethrow);
  }

  /** Why the GitHub inbox is still full, split by what you can actually do.
   *
   *  `tracked` is how many GitHub issues this workspace has ever captured, and it
   *  is the difference between "nothing is stuck" and "nothing is known" — which
   *  is a distinction only a request that SUCCEEDED can draw. This used to answer
   *  a failure with an empty result carrying `tracked: null`, borrowing the
   *  never-synced wording for an outage; the widget has an error state now, so
   *  the failure travels. */
  async getGithubInboxGap(workspaceSlug: string): Promise<{
    unclaimed: { repo: string; count: number; synced: boolean }[];
    contested: { repo: string; count: number; projects: string[] }[];
    total: number;
    tracked: number | null;
    sync_project_id?: string | null;
  }> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/github-inbox-gap/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  // --- Public project timeline -----------------------------------------------

  async getPublicTimelineState(workspaceSlug: string, projectId: string): Promise<TPublicTimelineState> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/public-timeline/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /**
   * Publishing twice returns the SAME anchor. Minting a fresh one would silently
   * kill a URL already sitting in somebody's inbox.
   */
  async publishTimeline(workspaceSlug: string, projectId: string): Promise<TPublicTimelineLink> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/public-timeline/`, {})
      .then((r) => r?.data)
      .catch(rethrow);
  }

  async revokeTimeline(workspaceSlug: string, projectId: string): Promise<unknown> {
    return this.delete(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/public-timeline/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }

  /**
   * Every schedule in this workspace that is readable without a login.
   *
   * This answered a failure with an empty list, and the modal above it renders an
   * empty list as "Nothing is published. No project schedule in this workspace
   * can be read without an account." — a categorical claim about what is exposed
   * outside the login, made from a swallowed error. A list nobody could fetch is
   * not a list of nothing.
   */
  async getWorkspacePublicTimelines(workspaceSlug: string): Promise<TWorkspacePublicTimeline[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/public-timelines/`)
      .then((r) => r?.data?.links ?? [])
      .catch(rethrow);
  }

  /**
   * Read with no account. The anchor is the only credential, so nothing else is
   * passed. The page has to tell 404 (never existed) from 410 (revoked) from a
   * 500 or a dropped connection, and only the status says which — `rethrow`
   * carries it, along with whether anything answered at all.
   */
  async getPublicTimeline(anchor: string): Promise<TPublicTimeline> {
    return this.get(`/api/arribada/public/timeline/${anchor}/`)
      .then((r) => r?.data)
      .catch(rethrow);
  }
}

// --- Checklist ---------------------------------------------------------------

/**
 * One line of a work item's checklist.
 *
 * `id` is the LINE, `issue_id` the work item it points at — two different things
 * that both have to travel, because removing a line must never be mistaken for
 * deleting the work.
 *
 * The project is named rather than assumed: a checklist may legitimately point
 * at work living in another project.
 */
export type TIssueChecklistItem = {
  id: string;
  issue_id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  state_id: string | null;
  done: boolean;
  target_date: string | null;
};

/** How much of one work item's checklist is finished, with none of the lines. */
export type TIssueChecklistSummary = { done: number; total: number };

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
