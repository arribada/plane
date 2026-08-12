/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { reorderWithinSubset } from "@/plane-web/components/gantt-chart/reorder";
import type { TSubtaskNode, TSubtaskTree } from "@/plane-web/components/gantt-chart/subtasks";
import type {
  TPortfolioGroupBy,
  TPortfolioSubgroup,
  TPortfolioSubgroupBy,
} from "@/plane-web/components/portfolio/grouping";
import {
  buildSubgroups,
  projectStatusKey,
  STATUS_BAND_ORDER,
  statusBandLabel,
  subgroupRowId,
} from "@/plane-web/components/portfolio/grouping";
import {
  EMPTY_SUBTASK_TREE,
  buildSubtaskTree,
  hideCollapsedDescendants,
} from "@/plane-web/components/gantt-chart/subtasks";
import type {
  TCriticalPathDiagnostics,
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
  /** The board failed to load, so an empty timeline means "we don't know", not
   *  "this workspace has no projects". The mirror of `userLoadFailed` below. */
  loadFailed: boolean;
  /** The folders failed to load, so "group by folder" is drawing an arrangement
   *  it could not read rather than one that does not exist. */
  foldersFailed: boolean;
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
  /** Any field of a loaded row, changed in place. `undefined` means "not
   *  mentioned" and is skipped; `null` means "cleared" and is written. */
  applyItemFields: (itemId: string, patch: Partial<TPortfolioItem>) => void;
  /** Drop a row the board must stop drawing — deleted, or archived out of the
   *  set this endpoint returns. A no-op for a row that is not loaded. */
  removeItem: (itemId: string) => void;
  applyProjectDates: (projectId: string, dates: { start_date?: string | null; target_date?: string | null }) => void;
  /** false when the reload failed and the board is showing stale rows. */
  refreshProjectItems: (workspaceSlug: string, projectId: string) => Promise<boolean>;
  /** Re-read the rows and every expanded project's items after a bulk write the
   *  server made, keeping the reader's arrangement. false when it failed. */
  refreshLoaded: (workspaceSlug: string) => Promise<boolean>;
  setDisplayedProjectIds: (ids: string[]) => void;
  setColorBy: (value: TPortfolioColorBy) => void;
  setSortBy: (value: TPortfolioSortBy) => void;
  moveProject: (dragId: string, dropId: string) => void;
  setGroupByFolder: (value: boolean) => void;
  /** Bands over the PROJECT rows: none ("project"), folders, or status. */
  groupBy: TPortfolioGroupBy;
  setGroupBy: (value: TPortfolioGroupBy) => void;
  /** Bands over one project's WORK ITEMS — the rule internal to a project. */
  subgroupBy: TPortfolioSubgroupBy;
  setSubgroupBy: (value: TPortfolioSubgroupBy) => void;
  toggleSubgroupCollapse: (rowId: string) => void;
  isSubgroupRow: (id: string) => boolean;
  getSubgroupRow: (id: string) => { label: string; color?: string; count: number; collapsed: boolean } | undefined;
  /** The latest status per project, pushed in by whoever fetched it, so the
   *  status bands can be computed in the store rather than in a pane. */
  setProjectStatuses: (statuses: Record<string, string>) => void;
  /** The arrangement a drag consumed on its way to the manual order — "Start
   *  date", "folders", or both — so the toolbar can say where the order came
   *  from instead of appearing to have thrown the sort away. Null when the order
   *  has never been anything but manual. */
  manualFrom: string | null;
  /** Sub-tasks folded into their parent's row. On by default. */
  nestSubtasks: boolean;
  setNestSubtasks: (value: boolean) => void;
  toggleItemCollapsed: (itemId: string) => void;
  /** The nesting of every loaded work item, built per project. */
  itemSubtaskTree: TSubtaskTree;
  isItemCollapsed: (id: string) => boolean;
  /** The project sequence the reader is looking at, folder bands consumed. */
  visibleProjectSequence: string[];
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
  /** Why the chain is empty when it is. Null until the first fetch answers, and
   *  on a backend that predates it — the legend then says nothing rather than
   *  guessing a cause. */
  criticalDiagnostics: TCriticalPathDiagnostics | null;
  /** The chain itself. Exposed because the legend reports how many bars are
   *  MARKED, and a count taken from the server's own figure would disagree with
   *  the rings on screen the moment the two definitions drift. */
  criticalIssueIds: Set<string>;
  isCriticalIssue: (id: string) => boolean;
  setShowCriticalPath: (workspaceSlug: string, value: boolean) => void;
  fetchCriticalPath: (workspaceSlug: string) => Promise<void>;
  // --- profile "Timeline" tab: the same board focused on one person ----------
  // A personal timeline is this board with a different row set — same gantt slot,
  // same getRowById, same dependency arrows. Everything below is inert while
  // `focusUserId` is null, which is what the portfolio always leaves it as.
  focusUserId: string | null;
  /** Every item assigned to the focused user, dated or not. */
  userTotalCount: number;
  /** How many of them a timeline cannot place, so the view can say so. */
  userUndatedCount: number;
  userTruncated: boolean;
  /** The load failed, so an empty board means "we don't know", not "no work". */
  userLoadFailed: boolean;
  /** Projects the focused user actually has rows in, in board order. */
  userProjectIds: string[];
  /** Their items as one flat, date-ordered list (the "no grouping" mode). */
  userItemIds: string[];
  /** Loaded items grouped by project — already computed for the gantt; exposed so
   *  a sidebar can say how many rows a project header stands for. */
  itemIdsByProject: Map<string, string[]>;
  fetchUserTimeline: (workspaceSlug: string, userId: string) => Promise<void>;
  resetUserFocus: () => void;
}

/** One shared empty array, so "this project has no rows" is a stable reference. */
const NO_ITEMS: string[] = [];

const ORDER_KEY = "arribada.portfolio.manualOrder";
const FOLDER_PREFIX = "__folder__:";
const STATUS_PREFIX = "__pstat__:";
const SUBGROUP_PREFIX = "__psub__:";
const NO_FOLDER = FOLDER_PREFIX + "none";
type TFolder = { id: string; name: string; parent_id: string | null; project_ids: string[] };

/** Only for the sentence the toolbar prints after a drag has consumed a sort.
 *  The toolbar's own SORT_OPTIONS is the display list; duplicating four words
 *  here is cheaper than a component importing from a store or the reverse. */
const SORT_LABEL: Record<string, string> = {
  start_date: "Start date",
  target_date: "Target date",
  name: "Name",
  undated: "Undated first",
};

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
  // What the portfolio was sorted and coloured by before a per-user timeline took
  // the store over; null when no such view is open. See fetchUserTimeline.
  // Deliberately absent from makeObservable: nothing renders these, they are only
  // read by resetUserFocus, and making them reactive would invalidate observers
  // for a value none of them display.
  preFocusSortBy: TPortfolioSortBy | null = null;
  preFocusColorBy: TPortfolioColorBy | null = null;
  isLoading = false;
  loadFailed = false;
  foldersFailed = false;
  folders: TFolder[] = [];
  groupBy: TPortfolioGroupBy = "project";
  subgroupBy: TPortfolioSubgroupBy = "none";
  collapsedSubgroupIds: Set<string> = new Set();
  projectStatuses: Record<string, string> = {};
  manualFrom: string | null = null;
  nestSubtasks = true;
  collapsedItemIds: Set<string> = new Set();
  collapsedFolderIds: Set<string> = new Set();
  focusFolderId: string | null = null; // when set, the portfolio shows only this folder's projects
  // item-level filters (apply to loaded task rows)
  priorityFilter: Set<string> = new Set();
  assignedToMeOnly = false;
  meUserId: string | null = null;
  // cross-project critical path
  showCriticalPath = false;
  criticalIssueIds: Set<string> = new Set();
  /** Why the chain is what it is, so the toggle can explain an empty answer
   *  rather than look broken. Null until the first fetch answers. */
  criticalDiagnostics: TCriticalPathDiagnostics | null = null;
  crossEdges: { from: string; to: string; kind: string; cross_project: boolean; critical: boolean }[] = [];
  // per-user focus (profile "Timeline" tab); null on the portfolio, always
  focusUserId: string | null = null;
  userTotalCount = 0;
  userUndatedCount = 0;
  userTruncated = false;
  userLoadFailed = false;

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
      loadFailed: observable.ref,
      foldersFailed: observable.ref,
      folders: observable,
      groupBy: observable.ref,
      subgroupBy: observable.ref,
      collapsedSubgroupIds: observable,
      projectStatuses: observable,
      manualFrom: observable.ref,
      nestSubtasks: observable.ref,
      collapsedItemIds: observable,
      collapsedFolderIds: observable,
      focusFolderId: observable.ref,
      priorityFilter: observable,
      assignedToMeOnly: observable.ref,
      meUserId: observable.ref,
      showCriticalPath: observable.ref,
      criticalIssueIds: observable,
      criticalDiagnostics: observable.ref,
      crossEdges: observable,
      focusUserId: observable.ref,
      userTotalCount: observable.ref,
      userUndatedCount: observable.ref,
      userTruncated: observable.ref,
      userLoadFailed: observable.ref,
      userProjectIds: computed,
      userItemIds: computed,
      fetchUserTimeline: action,
      resetUserFocus: action,
      allProjects: computed,
      scopedProjectIds: computed,
      sortedProjectIds: computed,
      itemIdsByProject: computed,
      focusFolderName: computed,
      folderGroups: computed,
      ganttBlockIds: computed,
      totalUndatedCount: computed,
      hasActiveFilters: computed,
      fetchPortfolio: action,
      toggleProjectExpansion: action,
      applyItemDates: action,
      applyItemFields: action,
      removeItem: action,
      applyProjectDates: action,
      refreshProjectItems: action,
      refreshLoaded: action,
      setDisplayedProjectIds: action,
      setColorBy: action,
      setSortBy: action,
      moveProject: action,
      setGroupByFolder: action,
      setGroupBy: action,
      setSubgroupBy: action,
      toggleSubgroupCollapse: action,
      setProjectStatuses: action,
      setNestSubtasks: action,
      toggleItemCollapsed: action,
      itemSubtaskTree: computed,
      visibleProjectSequence: computed,
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
    // Focused on one person: only the projects they actually have work in. A personal
    // timeline listing every project in the workspace, most of them empty, is noise.
    if (this.focusUserId) return this.userProjectIds;
    if (!this.focusFolderId) return this.displayedProjectIds;
    if (!this.folders.some((f) => f.id === this.focusFolderId)) return this.displayedProjectIds;
    // The whole subtree, not just the folder's own projects. Folders nest, and
    // the sidebar already counts a parent as holding everything underneath it —
    // so focusing "Tracker" and getting three of its five projects, with the two
    // in its subfolder silently missing, disagreed with the count the user had
    // just read two inches away.
    const wanted = this.folderSubtreeIds(this.focusFolderId);
    const ids = new Set(this.folders.filter((f) => wanted.has(f.id)).flatMap((f) => f.project_ids));
    return [...ids].filter((id) => !!this.projectMap[id]);
  }

  /** A folder and every folder beneath it. The hop cap is a backstop against a
   *  cycle the server refuses to create but a direct DB edit could. */
  folderSubtreeIds(rootId: string): Set<string> {
    const children = new Map<string, string[]>();
    for (const f of this.folders) {
      if (!f.parent_id) continue;
      children.set(f.parent_id, [...(children.get(f.parent_id) ?? []), f.id]);
    }
    const out = new Set<string>([rootId]);
    const queue = [rootId];
    let hops = 0;
    while (queue.length > 0 && hops < 256) {
      const next = queue.shift() as string;
      for (const child of children.get(next) ?? []) {
        if (out.has(child)) continue;
        out.add(child);
        queue.push(child);
      }
      hops += 1;
    }
    return out;
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

  /**
   * Every project's items, filtered and sorted, built in one pass.
   *
   * This used to be done per project: `Object.values(itemMap).filter(...)` walked
   * the whole map to find one project's rows, once for every expanded project. On
   * a board with a dozen projects open that is a dozen full scans, and because
   * `ganttBlockIds` is a computed over an observable map, all of them ran again
   * every time anybody edited a single date.
   *
   * One grouping pass, then one sort per project. The filters are read here so the
   * computed still invalidates when they change.
   */
  get itemIdsByProject(): Map<string, string[]> {
    const grouped = new Map<string, TPortfolioItem[]>();
    for (const item of Object.values(this.itemMap)) {
      const projectId = this.itemProjectId[item.id];
      if (!projectId || !this.itemMatchesFilters(item)) continue;
      const bucket = grouped.get(projectId);
      if (bucket) bucket.push(item);
      else grouped.set(projectId, [item]);
    }

    const out = new Map<string, string[]>();
    for (const [projectId, rows] of grouped) {
      // Each bucket is ours alone — it was built above — so sorting in place
      // mutates nothing anyone else holds.
      rows.sort((a, b) => {
        if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date);
        if (a.start_date) return -1;
        if (b.start_date) return 1;
        return a.sequence_id - b.sequence_id;
      });
      out.set(
        projectId,
        rows.map((it) => it.id)
      );
    }
    return out;
  }

  private sortedItemIds(projectId: string): string[] {
    // NO_ITEMS, not `?? []`. A project whose rows are not loaded — every collapsed
    // one — would otherwise get a freshly-minted array on each call, so an observer
    // comparing by reference sees a change that never happened and re-renders on
    // every tick of anything else in the store.
    return this.itemIdsByProject.get(projectId) ?? NO_ITEMS;
  }

  /**
   * Sub-task nesting for the work items under an expanded project.
   *
   * Built per project and merged, not globally: a portfolio spans a workspace, and
   * a sub-task whose parent lives in another project would otherwise be drawn
   * under a row that is not on this project's list at all — or, worse, be pulled
   * out of its own project's block and into somebody else's. A cross-project child
   * keeps a top-level row under its own project, which is where it belongs.
   */
  get itemSubtaskTree(): TSubtaskTree {
    if (!this.nestSubtasks) return EMPTY_SUBTASK_TREE;
    const byId = new Map<string, TSubtaskNode>();
    const order: string[] = [];
    for (const [projectId, ids] of this.itemIdsByProject) {
      if (ids.length === 0) continue;
      // The scope is the band, not the project, whenever there are bands: a
      // sub-task in a different band from its parent stays a top-level row of
      // its own band, exactly as on the work-item timeline. A chevron pointing
      // at a row inside another band is a chevron pointing off screen.
      const scopes = this.subgroupBy === "none" ? [ids] : this.subgroupsOf(projectId).map((band) => band.itemIds);
      for (const scope of scopes) {
        const tree = buildSubtaskTree(scope, (id) => this.itemMap[id]);
        for (const [id, node] of tree.byId) byId.set(id, node);
        order.push(...tree.order);
      }
    }
    return { order, byId };
  }

  isItemCollapsed = computedFn((id: string): boolean => this.collapsedItemIds.has(id));

  /**
   * A project's rows in the order the chart draws them: banded by the subgroup
   * axis, nested inside each band, with anything behind a folded parent or a
   * folded band left out.
   *
   * The order of the three is the whole composition, and it is the same one the
   * work-item timeline uses: band first (so a band keeps meaning "everything
   * with this value"), then nest inside it, then hide what is folded.
   */
  private displayItemIds(projectId: string): string[] {
    const ids = this.sortedItemIds(projectId);
    if (ids.length === 0) return ids;
    if (this.subgroupBy === "none") return this.nestAndFold(ids);

    const out: string[] = [];
    for (const band of this.subgroupsOf(projectId)) {
      const rowId = subgroupRowId(projectId, band.key);
      out.push(rowId);
      if (this.collapsedSubgroupIds.has(rowId)) continue;
      out.push(...this.nestAndFold(band.itemIds));
    }
    return out;
  }

  /** Nesting and its folds, over one scope — a whole project, or one band of it. */
  private nestAndFold(ids: string[]): string[] {
    if (!this.nestSubtasks) return ids;
    const tree = this.itemSubtaskTree;
    const inScope = new Set(ids);
    const nested = tree.order.filter((id) => inScope.has(id));
    return hideCollapsedDescendants(nested, tree, this.collapsedItemIds);
  }

  // Projects the focused user has loaded rows in, kept in board order. Reads
  // itemIdsByProject rather than itemMap so it can never disagree with the rows the
  // gantt draws under each project header.
  get userProjectIds(): string[] {
    if (!this.focusUserId) return [];
    const grouped = this.itemIdsByProject;
    return this.displayedProjectIds.filter((id) => !!grouped.get(id)?.length);
  }

  // The same rows as one flat, date-ordered list — the "no grouping" mode, where a
  // person reads their own weeks straight down the page instead of per project.
  get userItemIds(): string[] {
    if (!this.focusUserId) return [];
    // Object.values() is already a copy, so sorting it mutates nothing observable.
    const rows = Object.values(this.itemMap).filter((it) => this.itemMatchesFilters(it));
    rows.sort((a, b) => {
      const byStart = cmpDate(a.start_date, b.start_date);
      if (byStart) return byStart;
      const byTarget = cmpDate(a.target_date, b.target_date);
      if (byTarget) return byTarget;
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

    // Depth-first over the folder tree, not a flat pass. Folders nest, and a
    // parent whose projects all live in its subfolders holds none of its own —
    // so a flat pass skipped it as empty and left its children sitting among
    // unrelated top-level swimlanes, with nothing on screen saying they belonged
    // together. The swimlane list is flat, so the hierarchy is carried in the
    // name as a path; an empty parent still does not get a row of its own.
    const byParent = new Map<string | null, TFolder[]>();
    const known = new Set(this.folders.map((f) => f.id));
    for (const f of this.folders) {
      // A folder whose parent has gone missing is treated as a root rather than
      // dropped: losing a swimlane is worse than misplacing one.
      const key = f.parent_id && known.has(f.parent_id) ? f.parent_id : null;
      byParent.set(key, [...(byParent.get(key) ?? []), f]);
    }

    const walk = (parentId: string | null, prefix: string) => {
      for (const f of byParent.get(parentId) ?? []) {
        const path = prefix ? `${prefix} / ${f.name}` : f.name;
        const inFolder = new Set(f.project_ids);
        const pids = sorted.filter((id) => inFolder.has(id) && !seen.has(id));
        pids.forEach((id) => seen.add(id));
        if (pids.length) groups.push({ headerId: FOLDER_PREFIX + f.id, name: path, projectIds: pids });
        // Children follow their parent, whether or not the parent had a row.
        walk(f.id, path);
      }
    };
    walk(null, "");

    const ungrouped = sorted.filter((id) => !seen.has(id));
    if (ungrouped.length) groups.push({ headerId: NO_FOLDER, name: "No folder", projectIds: ungrouped });
    return groups;
  }

  /**
   * Bands over the project rows, for whichever group axis is in force.
   *
   * `folder` delegates to folderGroups, which walks the folder tree; `status`
   * bands by the latest project update, worst first, because a portfolio is read
   * to find what is going wrong. `project` produces no bands at all — the board
   * as it has always been, which is why it is the default.
   */
  get bandGroups(): { headerId: string; name: string; projectIds: string[] }[] {
    if (this.groupBy === "folder") return this.folderGroups;
    if (this.groupBy !== "status") return [];

    const sorted = this.sortedProjectIds;
    const byKey = new Map<string, string[]>();
    for (const pid of sorted) {
      const key = projectStatusKey(this.projectMap[pid], (id) => this.projectStatuses[id]);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(pid);
      else byKey.set(key, [pid]);
    }
    return STATUS_BAND_ORDER.filter((key) => byKey.has(key)).map((key) => ({
      headerId: STATUS_PREFIX + key,
      name: statusBandLabel(key),
      projectIds: byKey.get(key) as string[],
    }));
  }

  /** One project's work items banded by the subgroup axis. Computed from the raw
   *  per-project list, so the bands are decided before anything is nested — the
   *  same order of operations the work-item timeline uses, and for the same
   *  reason: a band has to keep meaning "everything with this value". */
  subgroupsOf = computedFn((projectId: string): TPortfolioSubgroup[] =>
    buildSubgroups(this.sortedItemIds(projectId), (id) => this.itemMap[id], this.subgroupBy, {
      getState: () => undefined,
    })
  );

  isSubgroupRow = computedFn((id: string): boolean => id.startsWith(SUBGROUP_PREFIX));

  getSubgroupRow = computedFn(
    (id: string): { label: string; color?: string; count: number; collapsed: boolean } | undefined => {
      if (!id.startsWith(SUBGROUP_PREFIX)) return undefined;
      // `__psub__:<projectId>:<key>` — the project scopes the id, so the same
      // module under two projects is two independently collapsible bands.
      const rest = id.slice(SUBGROUP_PREFIX.length);
      const split = rest.indexOf(":");
      if (split === -1) return undefined;
      const projectId = rest.slice(0, split);
      const key = rest.slice(split + 1);
      const band = this.subgroupsOf(projectId).find((b) => b.key === key);
      if (!band) return undefined;
      return {
        label: band.label,
        color: band.color,
        count: band.itemIds.length,
        collapsed: this.collapsedSubgroupIds.has(id),
      };
    }
  );

  // The flat id list the gantt renders. Expanding a project injects its item ids
  // right after it, so the sidebar and the grid stay in lockstep automatically.
  // With a group axis in force, a band header precedes each swimlane's projects;
  // with a subgroup axis, a band header precedes each run of a project's items.
  get ganttBlockIds(): string[] {
    const ids: string[] = [];
    const pushProject = (pid: string) => {
      ids.push(pid);
      if (this.expandedProjectIds.has(pid)) ids.push(...this.displayItemIds(pid));
    };
    if (this.groupBy === "project") {
      for (const pid of this.sortedProjectIds) pushProject(pid);
      return ids;
    }
    for (const g of this.bandGroups) {
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

  isFolderRow = computedFn((id: string): boolean => id.startsWith(FOLDER_PREFIX) || id.startsWith(STATUS_PREFIX));

  /** The header of a band over PROJECT rows, whichever axis produced it. Named
   *  for folders because that is what it started as and what the sidebar still
   *  calls it; a status band draws identically and collapses the same way. */
  getFolderRow = computedFn((id: string): { name: string; projectCount: number; collapsed: boolean } | undefined => {
    if (!id.startsWith(FOLDER_PREFIX) && !id.startsWith(STATUS_PREFIX)) return undefined;
    const g = this.bandGroups.find((x) => x.headerId === id);
    if (!g) return undefined;
    return { name: g.name, projectCount: g.projectIds.length, collapsed: this.collapsedFolderIds.has(id) };
  });

  getRowById = computedFn((id: string): TGanttRow | undefined => {
    // Every synthetic header — folder, status band, subgroup band — is a row with
    // no dates, so the gantt draws no bar for it but still gives it a row of the
    // standard height. That height is not cosmetic: both panes map over the same
    // id list and every dependency arrow computes its y from a row's index in it.
    if (id.startsWith(FOLDER_PREFIX) || id.startsWith(STATUS_PREFIX) || id.startsWith(SUBGROUP_PREFIX)) {
      return {
        id,
        name:
          this.getFolderRow(id)?.name ??
          this.bandGroups.find((band) => band.headerId === id)?.name ??
          this.getSubgroupRow(id)?.label ??
          "",
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

  /**
   * The portfolio board.
   *
   * The per-user timeline right below this one has carried a `userLoadFailed`
   * flag since it was written, for exactly the reason this one needed it and did
   * not have it: the board is entered by navigating to it, so there is nobody to
   * hand a rejection to, and an empty timeline that cannot say whether it failed
   * or the workspace simply has no projects is the worse outcome. Without it a
   * 500 here drew a blank planning board and left it at that.
   */
  fetchPortfolio = async (workspaceSlug: string): Promise<void> => {
    runInAction(() => {
      this.isLoading = true;
      this.loadFailed = false;
    });
    try {
      const [projectsOutcome, foldersOutcome] = await Promise.allSettled([
        this.service.getPortfolio(workspaceSlug),
        this.service.getFolders(workspaceSlug),
      ]);
      // The board IS the projects: without them there is nothing to arrange.
      if (projectsOutcome.status === "rejected") throw projectsOutcome.reason;
      const projects = projectsOutcome.value;
      // Folders are a way of arranging the board rather than the board itself, so
      // one that will not load must not blank it — but "group by folder" showing
      // every project ungrouped is indistinguishable from a workspace that has no
      // folders, so the failure is recorded for the toolbar to say so.
      const folders = foldersOutcome.status === "fulfilled" ? foldersOutcome.value : [];
      runInAction(() => {
        this.foldersFailed = foldersOutcome.status === "rejected";
        this.folders = folders.map((f) => ({
          id: f.id,
          name: f.name,
          parent_id: f.parent_id ?? null,
          project_ids: f.project_ids,
        }));
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
    } catch {
      // Recorded, not rethrown, for the same reason fetchUserTimeline swallows:
      // the caller is a useEffect on a page nobody can hand a rejection to. What
      // it may not do is leave a board that reads as "this workspace has no
      // projects".
      runInAction(() => {
        this.loadFailed = true;
        this.projectMap = {};
        this.displayedProjectIds = [];
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  };

  /**
   * Load one person's whole timeline: every dated item assigned to them, in every
   * project the caller can see, in one request.
   *
   * Deliberately NOT fetchPortfolio() + toggleProjectExpansion(): that path lazy-loads
   * items one project at a time on expand, so "assigned to me" could only ever filter
   * the projects somebody had already opened by hand. It also re-reads the saved manual
   * drag order and force-flips sortBy to "manual", which would silently import the
   * user's portfolio arrangement into a view that never offered them one.
   *
   * The item-level filters are cleared: on this board every row is already assigned to
   * the subject, and inheriting the portfolio's "assigned to me" toggle would blank out
   * a colleague's timeline entirely.
   */
  fetchUserTimeline = async (workspaceSlug: string, userId: string): Promise<void> => {
    runInAction(() => {
      this.isLoading = true;
      this.userLoadFailed = false;
      // This view forces its own sort and colour, and this store is a singleton
      // shared with the portfolio. Remember what the portfolio was showing so
      // leaving does not hand it back a sort choice the user never made:
      // fetchPortfolio only reassigns sortBy when a saved manual order exists, so
      // on a workspace without one the leak is permanent and silent.
      // Captured on entry only — re-entering the same view must not overwrite the
      // portfolio's setting with this view's own.
      if (!this.focusUserId) {
        this.preFocusSortBy = this.sortBy;
        this.preFocusColorBy = this.colorBy;
      }
    });
    try {
      const [projects, folders, timeline] = await Promise.all([
        this.service.getPortfolio(workspaceSlug),
        this.service.getFolders(workspaceSlug).catch(() => []),
        this.service.getUserTimeline(workspaceSlug, userId),
      ]);
      runInAction(() => {
        this.folders = folders.map((f) => ({
          id: f.id,
          name: f.name,
          parent_id: f.parent_id ?? null,
          project_ids: f.project_ids,
        }));
        this.projectMap = {};
        for (const project of projects) set(this.projectMap, [project.id], project);

        const items: Record<string, TPortfolioItem> = {};
        const owner: Record<string, string> = {};
        const withRows = new Set<string>();
        for (const row of timeline.items ?? []) {
          const { project_id: projectId, ...item } = row;
          items[item.id] = item;
          owner[item.id] = projectId;
          withRows.add(projectId);
        }
        this.itemMap = items;
        this.itemProjectId = owner;
        // Every project here arrived whole, so mark it loaded: that alone stops a
        // collapse/expand from lazily pulling in everybody else's work items.
        this.loadedItemProjects = withRows;
        // A personal timeline with collapsed project rows shows nothing at all.
        this.expandedProjectIds = new Set(withRows);
        this.displayedProjectIds = projects.filter((p) => !p.archived).map((p) => p.id);

        this.sortBy = "start_date";
        // groupByFolder is deliberately left alone: the view owns that switch, and
        // resetting it here would fight the control on every profile-to-profile move.
        this.focusFolderId = null;
        this.priorityFilter = new Set();
        this.assignedToMeOnly = false;

        this.userTotalCount = timeline.total_count ?? 0;
        this.userUndatedCount = timeline.undated_count ?? 0;
        this.userTruncated = !!timeline.truncated;
        this.focusUserId = userId;
      });
    } catch {
      // Swallowed on purpose, and recorded: the view is entered by clicking a tab, so
      // there is nobody to hand the rejection to, and an empty board that cannot say
      // whether it failed or the person simply has no work is the worse outcome.
      runInAction(() => {
        this.itemMap = {};
        this.itemProjectId = {};
        this.loadedItemProjects = new Set();
        this.expandedProjectIds = new Set();
        this.userTotalCount = 0;
        this.userUndatedCount = 0;
        this.userTruncated = false;
        this.userLoadFailed = true;
        this.focusUserId = userId;
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  };

  /** Leave the personal view. Not optional: this store is a singleton on RootStore,
   *  so without it /portfolio would open filtered to one person, every project
   *  force-expanded, with a row set that came from somebody else's profile. */
  resetUserFocus = (): void => {
    this.focusUserId = null;
    this.userTotalCount = 0;
    this.userUndatedCount = 0;
    this.userTruncated = false;
    this.userLoadFailed = false;
    this.itemMap = {};
    this.itemProjectId = {};
    this.loadedItemProjects = new Set();
    this.expandedProjectIds = new Set();
    // emptied rather than left stale: fetchPortfolio rebuilds it on the way in
    this.displayedProjectIds = [];
    this.priorityFilter = new Set();
    this.assignedToMeOnly = false;
    this.groupBy = "project";
    if (this.preFocusSortBy) this.sortBy = this.preFocusSortBy;
    if (this.preFocusColorBy) this.colorBy = this.preFocusColorBy;
    this.preFocusSortBy = null;
    this.preFocusColorBy = null;
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
  /**
   * A project's PLANNED window, moved on the portfolio timeline.
   *
   * Deliberately only start/target — never the derived dates. Those are computed
   * from the project's work items (MIN start / MAX target) and the gap between
   * the two is the whole reading of this board: writing over them would erase the
   * drift the chart exists to show.
   */
  applyProjectDates = (projectId: string, dates: { start_date?: string | null; target_date?: string | null }): void => {
    const project = this.projectMap[projectId];
    if (!project) return;
    const next = { ...project };
    if (dates.start_date !== undefined) next.start_date = dates.start_date;
    if (dates.target_date !== undefined) next.target_date = dates.target_date;
    set(this.projectMap, [projectId], next);
  };

  applyItemDates = (itemId: string, dates: { start_date?: string | null; target_date?: string | null }): void => {
    this.applyItemFields(itemId, dates);
  };

  /**
   * One field of a loaded row, or nine.
   *
   * `applyItemDates` was this function with two fields hard-coded, and the two
   * were the only ones anything could change without a refetch — which is why
   * marking a work item done in the peek panel left the bar drawing the state it
   * had before. The mirror in `portfolio-issue-mirror.ts` writes through here now.
   *
   * `undefined` is skipped rather than assigned: a caller passing a partial must
   * be able to leave a field alone, and `{ start_date: undefined }` from a spread
   * would otherwise erase a date nobody touched. `null` IS written — that is how
   * a date, a sprint or a parent gets cleared.
   */
  applyItemFields = (itemId: string, patch: Partial<TPortfolioItem>): void => {
    const item = this.itemMap[itemId];
    if (!item) return;
    const next = { ...item } as Record<string, unknown>;
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (next[key] === value) continue;
      next[key] = value;
      changed = true;
    }
    // Nothing to say: rewriting the entry anyway would mint a new object identity
    // and re-render every bar in the project for a change that did not happen.
    if (!changed) return;
    set(this.itemMap, [itemId], next as TPortfolioItem);
  };

  /**
   * A row that has left the board.
   *
   * The counts beside it are the SERVER's figures — the sidebar prints
   * `item_count` and draws its progress bar from `completed_item_count` — so
   * they are adjusted here too. Without that, deleting a row left "12" written
   * next to eleven bars, which reads as the delete having half worked.
   * `completed_item_count` is deliberately NOT touched: this store does not hold
   * state groups, so it cannot know whether the row it just dropped was one of
   * the completed ones, and guessing would make the percentage lie in the other
   * direction. The next fetch corrects both.
   */
  removeItem = (itemId: string): void => {
    const item = this.itemMap[itemId];
    if (!item) return;
    const projectId = this.itemProjectId[itemId];
    const nextItems = { ...this.itemMap };
    delete nextItems[itemId];
    const nextOwner = { ...this.itemProjectId };
    delete nextOwner[itemId];
    this.itemMap = nextItems;
    this.itemProjectId = nextOwner;
    if (this.collapsedItemIds.has(itemId)) {
      const folds = new Set(this.collapsedItemIds);
      folds.delete(itemId);
      this.collapsedItemIds = folds;
    }
    const project = projectId ? this.projectMap[projectId] : undefined;
    if (!project) return;
    const undated = !item.start_date && !item.target_date;
    set(this.projectMap, [projectId], {
      ...project,
      item_count: Math.max(0, project.item_count - 1),
      undated_item_count: undated ? Math.max(0, project.undated_item_count - 1) : project.undated_item_count,
    });
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

  /**
   * Re-read everything the board is currently showing, after the SERVER changed it.
   *
   * The two bulk actions in the toolbar are the case: "reflow" auto-schedules every
   * project in scope and "capture baseline" snapshots them. Neither writes through
   * this store, so afterwards `projectMap` holds the pre-reflow windows and the
   * pre-capture baseline fields — which is what the drift badge is computed from,
   * so the board went on reporting drift against a baseline that had been replaced.
   * Reflow refetched the rows but not the items, so the task bars it had just moved
   * kept their old dates.
   *
   * Deliberately NOT fetchPortfolio(): that rebuilds `displayedProjectIds` from the
   * API and force-flips `sortBy` to "manual" whenever a saved order exists, so a
   * reflow visibly reshuffled the board and silently changed the sort. Same reason
   * `refreshProjectItems` above exists. The arrangement is the reader's; only the
   * data is the server's.
   *
   * Items are refetched for every project the reader has expanded — a capture
   * changes none of them, and pays one request per open project for the sake of
   * having one answer to "the server moved things underneath us".
   *
   * @returns false when the board is still showing stale rows.
   */
  refreshLoaded = async (workspaceSlug: string): Promise<boolean> => {
    const loaded = [...this.loadedItemProjects];
    try {
      const [projects, itemLists] = await Promise.all([
        this.service.getPortfolio(workspaceSlug),
        Promise.all(loaded.map((projectId) => this.service.getProjectItems(workspaceSlug, projectId))),
      ]);
      runInAction(() => {
        const nextProjects: Record<string, TPortfolioProject> = {};
        for (const project of projects) nextProjects[project.id] = project;
        this.projectMap = nextProjects;

        // Rebuilt rather than merged, so a work item deleted since the last load
        // stops being drawn. A project nobody has expanded keeps no items either
        // way, so it contributes nothing here.
        const nextItems: Record<string, TPortfolioItem> = {};
        const nextOwner: Record<string, string> = {};
        loaded.forEach((projectId, index) => {
          for (const item of itemLists[index] ?? []) {
            nextItems[item.id] = item;
            nextOwner[item.id] = projectId;
          }
        });
        this.itemMap = nextItems;
        this.itemProjectId = nextOwner;
      });
      return true;
    } catch {
      // Same contract as refreshProjectItems: the prior rows stay on screen and the
      // caller is the only one that can tell the reader they are out of date.
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
    // Picking an order by hand answers "where did my sort go?" itself.
    this.manualFrom = null;
  };

  /** Kept because "group by folder" is a real, separate thing a caller asks for
   *  (focusing a folder turns it on). It is now one value of `groupBy` rather
   *  than a switch of its own, so there is one answer to "how is this banded". */
  get groupByFolder(): boolean {
    return this.groupBy === "folder";
  }

  setGroupByFolder = (value: boolean): void => {
    this.setGroupBy(value ? "folder" : "project");
  };

  setGroupBy = (value: TPortfolioGroupBy): void => {
    this.groupBy = value;
    // A fold names a header from the banding being left behind.
    this.collapsedFolderIds = new Set();
    if (value !== "project") this.manualFrom = null;
  };

  setSubgroupBy = (value: TPortfolioSubgroupBy): void => {
    this.subgroupBy = value;
    this.collapsedSubgroupIds = new Set();
  };

  toggleSubgroupCollapse = (rowId: string): void => {
    const next = new Set(this.collapsedSubgroupIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    this.collapsedSubgroupIds = next;
  };

  setProjectStatuses = (statuses: Record<string, string>): void => {
    this.projectStatuses = statuses;
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
    // Grouping ON, not off. It was switched off because a single folder's
    // projects were one flat list and a lone swimlane header said nothing. Now
    // that folders nest, the focus brings the whole subtree — so the bands ARE
    // the structure, and each one folds. Opening a folder and losing the shape
    // it was opened for is the wrong trade.
    //
    // Still a switch: anybody who wants the flat list turns it off in Display,
    // and that choice survives until the next focus.
    if (folderId) this.groupBy = "folder";
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

  /** Highlights the critical chain. It does not decide whether dependencies are
   *  drawn at all — the board loads its edges up front now.
   *
   *  The fetch runs whenever the diagnostics are missing, not only when the id
   *  set is empty. An empty set is the ANSWER on a workspace with no dependency
   *  links, so gating on it meant the one case that most needs an explanation
   *  re-asked the server on every toggle and still had nothing to say. */
  setShowCriticalPath = (workspaceSlug: string, value: boolean): void => {
    this.showCriticalPath = value;
    if (value && !this.criticalDiagnostics) void this.fetchCriticalPath(workspaceSlug);
  };

  fetchCriticalPath = async (workspaceSlug: string): Promise<void> => {
    try {
      const r = await this.service.getWorkspaceCriticalPath(workspaceSlug);
      runInAction(() => {
        this.criticalIssueIds = new Set(r.issue_ids);
        this.crossEdges = r.edges ?? [];
        this.criticalDiagnostics = r.diagnostics ?? null;
      });
    } catch {
      // leave prior state; the toggle just won't highlight anything
    }
  };

  /**
   * Drag reorder: drop `dragId` where `dropId` sits, and take the arrangement on
   * screen with you.
   *
   * This used to reorder `displayedProjectIds` — the SAVED order — while the
   * reader was looking at a date sort or a set of folder swimlanes, then switch
   * to manual. The row landed at the index it had in a list nobody was looking
   * at, and every other row jumped at the same time, so the one gesture that is
   * supposed to be direct manipulation was the one that scrambled the board.
   * Dragging was therefore offered only in manual mode, which meant the answer to
   * "can I just move this one" was no.
   *
   * Now the visible sequence — sorted, folder-banded, whatever produced it — IS
   * the order that gets written down, and the move is applied to that. Nothing
   * moves except the row under the hand. Where the arrangement came from is kept
   * in `manualFrom` so the toolbar can say so rather than appear to have
   * discarded it.
   */
  moveProject = (dragId: string, dropId: string): void => {
    if (dragId === dropId) return;
    const visible = this.visibleProjectSequence;
    // Projects outside the current scope — a focused folder, another page of the
    // board — are not on screen and must keep their saved places.
    const next = reorderWithinSubset(this.displayedProjectIds, visible, dragId, dropId);
    if (next === this.displayedProjectIds) return;

    const fromSort = this.sortBy === "manual" ? null : (SORT_LABEL[this.sortBy] ?? this.sortBy);
    const fromBands = this.groupBy === "folder" ? "folders" : this.groupBy === "status" ? "status bands" : null;
    this.displayedProjectIds = next;
    this.sortBy = "manual";
    this.groupBy = "project";
    this.manualFrom = fromBands ? (fromSort ? `${fromSort}, inside ${fromBands}` : fromBands) : fromSort;
    this.persistOrder();
  };

  /** What the reader sees, folder bands consumed: the same projects in the same
   *  places, with the headers taken out. */
  get visibleProjectSequence(): string[] {
    if (this.groupBy === "project") return this.sortedProjectIds;
    return this.bandGroups.flatMap((group) => group.projectIds);
  }

  setNestSubtasks = (value: boolean): void => {
    this.nestSubtasks = value;
    // A fold means nothing once the rows are flat, and a stale one would hide
    // rows the moment nesting came back on.
    if (!value) this.collapsedItemIds = new Set();
  };

  toggleItemCollapsed = (itemId: string): void => {
    const next = new Set(this.collapsedItemIds);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    this.collapsedItemIds = next;
  };
}
