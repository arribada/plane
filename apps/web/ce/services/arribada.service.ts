/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type {
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
  TProjectDocs,
  TProjectSchedule,
  TProjectStatus,
  TProjectStatusUpdate,
  TTeamMember,
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
  async getBaseline(
    workspaceSlug: string,
    projectId: string
  ): Promise<{ issue_id: string; start_date: string | null; target_date: string | null }[]> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/baseline/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Freeze the current dates of every issue in the project as the new baseline.
  async captureBaseline(workspaceSlug: string, projectId: string): Promise<{ captured: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/baseline/`, {})
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
  async getCriticalPath(workspaceSlug: string, projectId: string): Promise<{ issue_ids: string[] }> {
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

  async createFolder(workspaceSlug: string, name: string): Promise<{ id: string; name: string }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/project-folders/`, { name })
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
    data: Partial<Pick<TProjectSchedule, "start_date" | "target_date">>
  ): Promise<TProjectSchedule> {
    return this.patch(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/schedule/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
