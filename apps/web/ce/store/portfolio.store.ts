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
  // What the timeline actually draws: displayedProjectIds narrowed to the folder in
  // focus. Anything acting on "what you can see" must read this, not the wider list.
  scopedProjectIds: string[];
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
  applyItemDates: (itemId: string, dates: { start_date?: string | null; target_date?: string | null }) => void;
  /** false when the reload failed and the board is showing stale rows. */
  refreshProjectItems: (workspaceSlug: string, projectId: string) => Promise<boolean>;
  setDisplayedProjectIds: (ids: string[]) => void;
  setColorBy: (value: TPortfolioColorBy) => void;
  setSortBy: (value: TPortfolioSortBy) => void;
  moveProject: (dragId: string, dropId: string) => void;
  setGroupByFolder: (value: boolean) => void;
  toggleFolderCollapse: (headerId: string) => void;
  focusFolderId: string | null;
  focusFolderName: string | null;
  setFocusFolder: (folderId: string | null) => void;
  hasActiveFilters: boolean;
  // Observables the toolbar reads back to render its own controls; they were only
  // ever on the class, so `usePortfolio()` (typed as this interface) could not see them.
  priorityFilter: Set<string>;
  assignedToMeOnly: boolean;
  groupByFolder: boolean;
  togglePriorityFilter: (priority: string) => void;
  setAssignedToMeOnly: (value: boolean) => void;
  setMeUserId: (id: string | null) => void;
  clearFilters: () => void;
  showCriticalPath: boolean;
  crossEdges: { from: string; to: string; kind: string; cross_project: boolean; critical: boolean }[];
  isCriticalIssue: (id: string) => boolean;
  setShowCriticalPath: (workspaceSlug: string, value: boolean) => void;
  fetchCriticalPath: (workspaceSlug: string) => Promise<void>;
}

const ORDER_KEY = "arribada.portfolio.manualOrder";
const FOLDER_PREFIX = "__folder__:";
const NO_FOLDER = FOLDER_PREFIX + "none";
type TFolder = { id: string; name: string; project_ids: string[] };

// Date comparator for row sorting: dated rows come before undated ones.
const cmpDate = (a: string | null, b: string | null) => {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
};

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
  focusFolderId: string | null = null; // when set, the portfolio shows only this folder's projects
  // item-level filters (apply to loaded task rows)
  priorityFilter: Set<string> = new Set();
  assignedToMeOnly = false;
  meUserId: string | null = null;
  // cross-project critical path
  showCriticalPath = false;
  criticalIssueIds: Set<string> = new Set();
  crossEdges: { from: string; to: string; kind: string; cross_project: boolean; critical: boolean }[] = [];

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
      focusFolderId: observable.ref,
      priorityFilter: observable,
      assignedToMeOnly: observable.ref,
      meUserId: observable.ref,
      showCriticalPath: observable.ref,
      criticalIssueIds: observable,
      crossEdges: observable,
      allProjects: computed,
      scopedProjectIds: computed,
      sortedProjectIds: computed,
      focusFolderName: computed,
      folderGroups: computed,
      ganttBlockIds: computed,
      totalUndatedCount: computed,
      hasActiveFilters: computed,
      fetchPortfolio: action,
      toggleProjectExpansion: action,
      applyItemDates: action,
      refreshProjectItems: action,
      setDisplayedProjectIds: action,
      setColorBy: action,
      setSortBy: action,
      moveProject: action,
      setGroupByFolder: action,
      toggleFolderCollapse: action,
      setFocusFolder: action,
      togglePriorityFilter: action,
      setAssignedToMeOnly: action,
      setMeUserId: action,
      clearFilters: action,
      setShowCriticalPath: action,
      fetchCriticalPath: action,
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

  // The base project set the timeline shows: the user's selection, or — when a
  // folder is focused — only that folder's projects (a folder-scoped portfolio).
  get scopedProjectIds(): string[] {
    if (!this.focusFolderId) return this.displayedProjectIds;
    const folder = this.folders.find((f) => f.id === this.focusFolderId);
    if (!folder) return this.displayedProjectIds;
    return folder.project_ids.filter((id) => !!this.projectMap[id]);
  }

  get focusFolderName(): string | null {
    if (!this.focusFolderId) return null;
    return this.folders.find((f) => f.id === this.focusFolderId)?.name ?? null;
  }

  get sortedProjectIds(): string[] {
    // manual = the drag order the user set (displayedProjectIds order, untouched)
    if (this.sortBy === "manual") return this.scopedProjectIds.filter((id) => !!this.projectMap[id]);
    const ids = [...this.scopedProjectIds];
    const p = (id: string) => this.projectMap[id];
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

  get hasActiveFilters(): boolean {
    return this.priorityFilter.size > 0 || this.assignedToMeOnly;
  }

  private itemMatchesFilters(it: TPortfolioItem): boolean {
    if (this.priorityFilter.size > 0 && !this.priorityFilter.has(it.priority)) return false;
    if (this.assignedToMeOnly && this.meUserId && !(it.assignees ?? []).some((a) => a.id === this.meUserId))
      return false;
    return true;
  }

  private sortedItemIds(projectId: string): string[] {
    // `filter` already returned a fresh array, so sorting it in place mutates nothing shared
    const rows = Object.values(this.itemMap).filter(
      (it) => this.itemProjectId[it.id] === projectId && this.itemMatchesFilters(it)
    );
    rows.sort((a, b) => {
      if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date);
      if (a.start_date) return -1;
      if (b.start_date) return 1;
      return a.sequence_id - b.sequence_id;
    });
    return rows.map((it) => it.id);
  }

  // Displayed projects grouped into folder swimlanes, each preserving the active
  // sort order; projects in no folder fall into a trailing "No folder" group.
  get folderGroups(): { headerId: string; name: string; projectIds: string[] }[] {
    const sorted = this.sortedProjectIds;
    const seen = new Set<string>();
    const groups: { headerId: string; name: string; projectIds: string[] }[] = [];
    for (const f of this.folders) {
      const inFolder = new Set(f.project_ids);
      const pids = sorted.filter((id) => inFolder.has(id) && !seen.has(id));
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
    return this.scopedProjectIds.reduce((sum, id) => sum + (this.projectMap[id]?.undated_item_count ?? 0), 0);
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
      return {
        id,
        name: this.getFolderRow(id)?.name ?? "",
        sort_order: null,
        start_date: null,
        target_date: null,
        project_id: null,
      };
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

  // Dates written elsewhere (bulk modal, AI planner) land on the timeline at once,
  // without waiting for the round-trip a full refresh would need.
  applyItemDates = (itemId: string, dates: { start_date?: string | null; target_date?: string | null }): void => {
    const item = this.itemMap[itemId];
    if (!item) return;
    const next = { ...item };
    if (dates.start_date !== undefined) next.start_date = dates.start_date;
    if (dates.target_date !== undefined) next.target_date = dates.target_date;
    set(this.itemMap, [itemId], next);
  };

  // Reload one project's items and its own row counts. Deliberately NOT
  // fetchPortfolio(): that resets displayedProjectIds and force-switches sortBy to
  // "manual" whenever a saved order exists, visibly reshuffling the board.
  refreshProjectItems = async (workspaceSlug: string, projectId: string): Promise<boolean> => {
    runInAction(() => {
      const loaded = new Set(this.loadedItemProjects);
      loaded.delete(projectId);
      this.loadedItemProjects = loaded;
    });
    try {
      const [items, projects] = await Promise.all([
        this.service.getProjectItems(workspaceSlug, projectId),
        this.service.getPortfolio(workspaceSlug).catch(() => [] as TPortfolioProject[]),
      ]);
      runInAction(() => {
        // rebuild rather than merge, so items deleted since the last load disappear
        const nextItems: Record<string, TPortfolioItem> = {};
        const nextOwner: Record<string, string> = {};
        for (const [id, pid] of Object.entries(this.itemProjectId)) {
          if (pid === projectId || !this.itemMap[id]) continue;
          nextItems[id] = this.itemMap[id];
          nextOwner[id] = pid;
        }
        for (const item of items) {
          nextItems[item.id] = item;
          nextOwner[item.id] = projectId;
        }
        this.itemMap = nextItems;
        this.itemProjectId = nextOwner;
        this.loadedItemProjects = new Set(this.loadedItemProjects).add(projectId);
        const fresh = projects.find((p) => p.id === projectId);
        if (fresh) set(this.projectMap, [projectId], fresh);
      });
      return true;
    } catch {
      // The prior rows stay on screen and the project stays marked unloaded, so
      // the next expand re-fetches it. Until then the board is out of date, and
      // the caller is the only one that can say so — hence the boolean rather
      // than a swallowed rejection.
      return false;
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

  // Focus the portfolio on a single folder (show only its projects), or clear (null).
  setFocusFolder = (folderId: string | null): void => {
    this.focusFolderId = folderId;
    // in single-folder view the swimlane grouping is redundant
    if (folderId) this.groupByFolder = false;
  };

  togglePriorityFilter = (priority: string): void => {
    const next = new Set(this.priorityFilter);
    if (next.has(priority)) next.delete(priority);
    else next.add(priority);
    this.priorityFilter = next;
  };

  setAssignedToMeOnly = (value: boolean): void => {
    this.assignedToMeOnly = value;
  };

  setMeUserId = (id: string | null): void => {
    this.meUserId = id;
  };

  clearFilters = (): void => {
    this.priorityFilter = new Set();
    this.assignedToMeOnly = false;
  };

  isCriticalIssue = computedFn((id: string): boolean => this.showCriticalPath && this.criticalIssueIds.has(id));

  setShowCriticalPath = (workspaceSlug: string, value: boolean): void => {
    this.showCriticalPath = value;
    if (value && this.criticalIssueIds.size === 0 && this.crossEdges.length === 0) {
      void this.fetchCriticalPath(workspaceSlug);
    }
  };

  fetchCriticalPath = async (workspaceSlug: string): Promise<void> => {
    try {
      const r = await this.service.getWorkspaceCriticalPath(workspaceSlug);
      runInAction(() => {
        this.criticalIssueIds = new Set(r.issue_ids);
        this.crossEdges = r.edges ?? [];
      });
    } catch {
      // leave prior state; the toggle just won't highlight anything
    }
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
