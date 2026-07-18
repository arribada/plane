/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type {
  TIssueRelationEdge,
  TPortfolioItem,
  TPortfolioProject,
  TProjectSchedule,
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
