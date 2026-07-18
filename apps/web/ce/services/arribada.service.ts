/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type {
  TIssueRelationEdge,
  TMyWorkItem,
  TPortfolioItem,
  TPortfolioProject,
  TProjectDocs,
  TProjectSchedule,
  TProjectStatus,
  TProjectStatusUpdate,
} from "@/plane-web/types/arribada";

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

  // A project's documentation pointers: AFFiNE wiki doc + Google Drive URL.
  async getAffineDoc(workspaceSlug: string, projectId: string): Promise<TProjectDocs> {
    return this.get(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/affine-doc/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Partial update: only the keys you pass are changed (AFFiNE and Drive edit independently).
  async setAffineDoc(
    workspaceSlug: string,
    projectId: string,
    data: { doc_id?: string; title?: string; google_drive_url?: string }
  ): Promise<TProjectDocs> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/projects/${projectId}/affine-doc/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Adopt inbox items (e.g. GHIN) into a project — lossless copy + relates_to link.
  async adoptIssues(
    workspaceSlug: string,
    sourceIssueIds: string[],
    targetProjectId: string
  ): Promise<{ adopted: number }> {
    return this.post(`/api/arribada/workspaces/${workspaceSlug}/adopt-issues/`, {
      source_issue_ids: sourceIssueIds,
      target_project_id: targetProjectId,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Per-person workload across the workspace.
  async getWorkload(
    workspaceSlug: string
  ): Promise<
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

  async assignProjectToFolder(
    workspaceSlug: string,
    projectId: string,
    folderId: string | null
  ): Promise<unknown> {
    return this.put(`/api/arribada/workspaces/${workspaceSlug}/project-folders/assign/`, {
      project_id: projectId,
      folder_id: folderId,
    })
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
