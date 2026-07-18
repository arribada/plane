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
  isFolderRow: (id: string) => boolean;
  getFolderRow: (id: string) => { name: string; projectCount: number; collapsed: boolean } | undefined;
  // actions
  fetchPortfolio: (workspaceSlug: string) => Promise<void>;
  toggleProjectExpansion: (workspaceSlug: string, projectId: string) => Promise<void>;
  setDisplayedProjectIds: (ids: string[]) => void;
  setColorBy: (value: TPortfolioColorBy) => void;
  setSortBy: (value: TPortfolioSortBy) => void;
  moveProject: (dragId: string, dropId: string) => void;
  setGroupByFolder: (value: boolean) => void;
  toggleFolderCollapse: (headerId: string) => void;
}

const ORDER_KEY = "arribada.portfolio.manualOrder";
const FOLDER_PREFIX = "__folder__:";
const NO_FOLDER = FOLDER_PREFIX + "none";
type TFolder = { id: string; name: string; project_ids: string[] };

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
  folders: TFolder[] = [];
  groupByFolder = false;
  collapsedFolderIds: Set<string> = new Set();

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
      folders: observable,
      groupByFolder: observable.ref,
      collapsedFolderIds: observable,
      allProjects: computed,
      sortedProjectIds: computed,
      folderGroups: computed,
      ganttBlockIds: computed,
      totalUndatedCount: computed,
      fetchPortfolio: action,
      toggleProjectExpansion: action,
      setDisplayedProjectIds: action,
      setColorBy: action,
      setSortBy: action,
      moveProject: action,
      setGroupByFolder: action,
      toggleFolderCollapse: action,
    });
  }

  private persistOrder() {
    try {
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(this.displayedProjectIds));
    } catch {
      // localStorage unavailable — manual order just won't persist across reloads
    }
  }

  private loadOrder(): string[] | null {
    try {
      const raw = window.localStorage.getItem(ORDER_KEY);
      return raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      return null;
    }
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
    // manual = the drag order the user set (displayedProjectIds order, untouched)
    if (this.sortBy === "manual") return [...this.displayedProjectIds];
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

  // Displayed projects grouped into folder swimlanes, each preserving the active
  // sort order; projects in no folder fall into a trailing "No folder" group.
  get folderGroups(): { headerId: string; name: string; projectIds: string[] }[] {
    const sorted = this.sortedProjectIds;
    const seen = new Set<string>();
    const groups: { headerId: string; name: string; projectIds: string[] }[] = [];
    for (const f of this.folders) {
      const set = new Set(f.project_ids);
      const pids = sorted.filter((id) => set.has(id) && !seen.has(id));
      pids.forEach((id) => seen.add(id));
      if (pids.length) groups.push({ headerId: FOLDER_PREFIX + f.id, name: f.name, projectIds: pids });
    }
    const ungrouped = sorted.filter((id) => !seen.has(id));
    if (ungrouped.length) groups.push({ headerId: NO_FOLDER, name: "No folder", projectIds: ungrouped });
    return groups;
  }

  // The flat id list the gantt renders. Expanding a project injects its item ids
  // right after it, so the sidebar and the grid stay in lockstep automatically.
  // With grouping on, a folder-header row precedes each swimlane's projects.
  get ganttBlockIds(): string[] {
    const ids: string[] = [];
    const pushProject = (pid: string) => {
      ids.push(pid);
      if (this.expandedProjectIds.has(pid)) ids.push(...this.sortedItemIds(pid));
    };
    if (!this.groupByFolder) {
      for (const pid of this.sortedProjectIds) pushProject(pid);
      return ids;
    }
    for (const g of this.folderGroups) {
      ids.push(g.headerId);
      if (this.collapsedFolderIds.has(g.headerId)) continue;
      for (const pid of g.projectIds) pushProject(pid);
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

  isFolderRow = computedFn((id: string): boolean => id.startsWith(FOLDER_PREFIX));

  getFolderRow = computedFn((id: string): { name: string; projectCount: number; collapsed: boolean } | undefined => {
    if (!id.startsWith(FOLDER_PREFIX)) return undefined;
    const g = this.folderGroups.find((x) => x.headerId === id);
    if (!g) return undefined;
    return { name: g.name, projectCount: g.projectIds.length, collapsed: this.collapsedFolderIds.has(id) };
  });

  getRowById = computedFn((id: string): TGanttRow | undefined => {
    if (id.startsWith(FOLDER_PREFIX)) {
      // folder header: a row with no dates, so the gantt draws no bar for it
      return { id, name: this.getFolderRow(id)?.name ?? "", sort_order: null, start_date: null, target_date: null, project_id: null };
    }
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
      const [projects, folders] = await Promise.all([
        this.service.getPortfolio(workspaceSlug),
        this.service.getFolders(workspaceSlug).catch(() => []),
      ]);
      runInAction(() => {
        this.folders = folders.map((f) => ({ id: f.id, name: f.name, project_ids: f.project_ids }));
        this.projectMap = {};
        for (const project of projects) set(this.projectMap, [project.id], project);
        // default selection: every non-archived project, in API order
        const active = projects.filter((p) => !p.archived).map((p) => p.id);
        // re-apply a saved manual drag order if one exists (dropping stale ids)
        const saved = this.loadOrder();
        if (saved) {
          const set2 = new Set(active);
          const ordered = saved.filter((id) => set2.has(id));
          for (const id of active) if (!ordered.includes(id)) ordered.push(id);
          this.displayedProjectIds = ordered;
          this.sortBy = "manual";
        } else {
          this.displayedProjectIds = active;
        }
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

  setGroupByFolder = (value: boolean): void => {
    this.groupByFolder = value;
  };

  toggleFolderCollapse = (headerId: string): void => {
    const next = new Set(this.collapsedFolderIds);
    if (next.has(headerId)) next.delete(headerId);
    else next.add(headerId);
    this.collapsedFolderIds = next;
  };

  // Drag reorder: drop `dragId` at the position of `dropId`, switch to manual sort.
  moveProject = (dragId: string, dropId: string): void => {
    if (dragId === dropId) return;
    const ids = [...this.displayedProjectIds];
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(dropId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    this.displayedProjectIds = ids;
    this.sortBy = "manual";
    this.persistOrder();
  };
}
