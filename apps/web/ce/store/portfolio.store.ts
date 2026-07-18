/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type {
  TPortfolioColorBy,
  TPortfolioItem,
  TPortfolioProject,
  TPortfolioSortBy,
} from "@/plane-web/types/arribada";

// The row shape the gantt timeline store reads (structurally = its internal BlockData).
export type TGanttRow = {
  id: string;
  name: string;
  sort_order: number | null;
  start_date?: string | null;
  target_date?: string | null;
  project_id?: string | null;
};

export interface IPortfolioStore {
  projectMap: Record<string, TPortfolioProject>;
  itemMap: Record<string, TPortfolioItem>;
  displayedProjectIds: string[];
  expandedProjectIds: Set<string>;
  colorBy: TPortfolioColorBy;
  sortBy: TPortfolioSortBy;
  isLoading: boolean;
  // computed
  allProjects: TPortfolioProject[];
  sortedProjectIds: string[];
  ganttBlockIds: string[];
  totalUndatedCount: number;
  // computed fns
  isProjectRow: (id: string) => boolean;
  getRowById: (id: string) => TGanttRow | undefined;
  getProject: (id: string) => TPortfolioProject | undefined;
  getItem: (id: string) => TPortfolioItem | undefined;
  getRowProjectId: (id: string) => string | undefined;
  // actions
  fetchPortfolio: (workspaceSlug: string) => Promise<void>;
  toggleProjectExpansion: (workspaceSlug: string, projectId: string) => Promise<void>;
  setDisplayedProjectIds: (ids: string[]) => void;
  setColorBy: (value: TPortfolioColorBy) => void;
  setSortBy: (value: TPortfolioSortBy) => void;
}

export class PortfolioStore implements IPortfolioStore {
  projectMap: Record<string, TPortfolioProject> = {};
  itemMap: Record<string, TPortfolioItem> = {};
  itemProjectId: Record<string, string> = {};
  loadedItemProjects: Set<string> = new Set();
  displayedProjectIds: string[] = [];
  expandedProjectIds: Set<string> = new Set();
  colorBy: TPortfolioColorBy = "project";
  sortBy: TPortfolioSortBy = "start_date";
  isLoading = false;

  service: ArribadaService;

  constructor() {
    this.service = new ArribadaService();
    makeObservable(this, {
      projectMap: observable,
      itemMap: observable,
      itemProjectId: observable,
      loadedItemProjects: observable,
      displayedProjectIds: observable,
      expandedProjectIds: observable,
      colorBy: observable.ref,
      sortBy: observable.ref,
      isLoading: observable.ref,
      allProjects: computed,
      sortedProjectIds: computed,
      ganttBlockIds: computed,
      totalUndatedCount: computed,
      fetchPortfolio: action,
      toggleProjectExpansion: action,
      setDisplayedProjectIds: action,
      setColorBy: action,
      setSortBy: action,
    });
  }

  get allProjects(): TPortfolioProject[] {
    return Object.values(this.projectMap);
  }

  private rowStart(p: TPortfolioProject): string | null {
    return p.start_date ?? p.derived_start_date;
  }

  private rowTarget(p: TPortfolioProject): string | null {
    return p.target_date ?? p.derived_target_date;
  }

  get sortedProjectIds(): string[] {
    const ids = [...this.displayedProjectIds];
    const p = (id: string) => this.projectMap[id];
    const cmpDate = (a: string | null, b: string | null) => {
      if (a && b) return a.localeCompare(b);
      if (a) return -1; // dated rows before undated
      if (b) return 1;
      return 0;
    };
    ids.sort((ia, ib) => {
      const a = p(ia);
      const b = p(ib);
      if (!a || !b) return 0;
      switch (this.sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "target_date":
          return cmpDate(this.rowTarget(a), this.rowTarget(b)) || a.name.localeCompare(b.name);
        case "undated":
          return b.undated_item_count - a.undated_item_count || a.name.localeCompare(b.name);
        case "start_date":
        default:
          return cmpDate(this.rowStart(a), this.rowStart(b)) || a.name.localeCompare(b.name);
      }
    });
    return ids;
  }

  private sortedItemIds(projectId: string): string[] {
    const ids = Object.values(this.itemMap)
      .filter((it) => this.itemProjectId[it.id] === projectId)
      .sort((a, b) => {
        if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date);
        if (a.start_date) return -1;
        if (b.start_date) return 1;
        return a.sequence_id - b.sequence_id;
      })
      .map((it) => it.id);
    return ids;
  }

  // The flat id list the gantt renders. Expanding a project injects its item ids
  // right after it, so the sidebar and the grid stay in lockstep automatically.
  get ganttBlockIds(): string[] {
    const ids: string[] = [];
    for (const pid of this.sortedProjectIds) {
      ids.push(pid);
      if (this.expandedProjectIds.has(pid)) ids.push(...this.sortedItemIds(pid));
    }
    return ids;
  }

  get totalUndatedCount(): number {
    return this.displayedProjectIds.reduce((sum, id) => sum + (this.projectMap[id]?.undated_item_count ?? 0), 0);
  }

  isProjectRow = computedFn((id: string): boolean => !!this.projectMap[id]);

  getProject = computedFn((id: string): TPortfolioProject | undefined => this.projectMap[id]);

  getItem = computedFn((id: string): TPortfolioItem | undefined => this.itemMap[id]);

  // The project a row belongs to: itself for a project row, the owner for a task row.
  getRowProjectId = computedFn((id: string): string | undefined => {
    if (this.projectMap[id]) return id;
    return this.itemProjectId[id];
  });

  getRowById = computedFn((id: string): TGanttRow | undefined => {
    const p = this.projectMap[id];
    if (p) {
      return {
        id: p.id,
        name: p.name,
        sort_order: null,
        start_date: this.rowStart(p),
        target_date: this.rowTarget(p),
        project_id: p.id,
      };
    }
    const it = this.itemMap[id];
    if (it) {
      return {
        id: it.id,
        name: it.name,
        sort_order: null,
        start_date: it.start_date,
        target_date: it.target_date,
        project_id: this.itemProjectId[it.id] ?? null,
      };
    }
    return undefined;
  });

  fetchPortfolio = async (workspaceSlug: string): Promise<void> => {
    runInAction(() => {
      this.isLoading = true;
    });
    try {
      const projects = await this.service.getPortfolio(workspaceSlug);
      runInAction(() => {
        this.projectMap = {};
        for (const project of projects) set(this.projectMap, [project.id], project);
        // default selection: every non-archived project, in API order
        this.displayedProjectIds = projects.filter((p) => !p.archived).map((p) => p.id);
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  };

  toggleProjectExpansion = async (workspaceSlug: string, projectId: string): Promise<void> => {
    const willExpand = !this.expandedProjectIds.has(projectId);
    runInAction(() => {
      const next = new Set(this.expandedProjectIds);
      if (willExpand) next.add(projectId);
      else next.delete(projectId);
      this.expandedProjectIds = next;
    });
    // lazy-load items on first expand only
    if (willExpand && !this.loadedItemProjects.has(projectId)) {
      const items = await this.service.getProjectItems(workspaceSlug, projectId);
      runInAction(() => {
        for (const item of items) {
          set(this.itemMap, [item.id], item);
          set(this.itemProjectId, [item.id], projectId);
        }
        this.loadedItemProjects = new Set(this.loadedItemProjects).add(projectId);
      });
    }
  };

  setDisplayedProjectIds = (ids: string[]): void => {
    this.displayedProjectIds = ids;
  };

  setColorBy = (value: TPortfolioColorBy): void => {
    this.colorBy = value;
  };

  setSortBy = (value: TPortfolioSortBy): void => {
    this.sortBy = value;
  };
}
