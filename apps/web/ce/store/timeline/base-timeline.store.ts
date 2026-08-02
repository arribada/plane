/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEqual, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// components
import type {
  ChartDataType,
  IBlockUpdateDependencyData,
  IGanttBlock,
  TGanttViews,
  EGanttBlockType,
} from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
import { GANTT_SIDEBAR_MAX_WIDTH, GANTT_SIDEBAR_MIN_WIDTH, SIDEBAR_WIDTH } from "@/components/gantt-chart/constants";
import { currentViewDataWithView } from "@/components/gantt-chart/data";
import {
  getDateFromPositionOnGantt,
  getItemPositionWidth,
  getPositionFromDate,
} from "@/components/gantt-chart/views/helpers";
// helpers
// store
import type { RootStore } from "@/plane-web/store/root.store";

// types
type BlockData = {
  id: string;
  name: string;
  sort_order: number | null;
  start_date?: string | undefined | null;
  target_date?: string | undefined | null;
  project_id?: string | undefined | null;
};

type TSidebarPreferences = {
  width: number;
  collapsed: boolean;
  // Display choices that belong to the person, not to the view: they survive a
  // reload the same way the sidebar width does.
  showWeekends?: boolean;
  dimDependencies?: boolean;
  zoom?: number;
};

/** How far the day width can be stretched or squeezed either side of a scale's own.
 *  Beyond this the header cells stop being legible in one direction and the chart
 *  stops being scrollable in the other. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
export const clampZoom = (value: number): number =>
  Math.min(Math.max(Number.isFinite(value) ? value : 1, ZOOM_MIN), ZOOM_MAX);

const SIDEBAR_STORAGE_KEY = "arribada.gantt.sidebar";

const clampSidebarWidth = (width: number) =>
  Math.min(Math.max(width, GANTT_SIDEBAR_MIN_WIDTH), GANTT_SIDEBAR_MAX_WIDTH);

export interface IBaseTimelineStore {
  // observables
  currentView: TGanttViews;
  currentViewData: ChartDataType | undefined;
  activeBlockId: string | null;
  renderView: any;
  isDragging: boolean;
  isDependencyEnabled: boolean;
  blockIds: string[] | undefined;
  linkingSourceId: string | null;
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  /** Shade Saturdays and Sundays. On by default — a bar that spans a weekend is
   *  not two days of work, and hiding that makes every estimate read long. */
  selectedBaselineId: string;
  setSelectedBaselineId: (id: string) => void;
  showWeekends: boolean;
  /** Draw the dependency arrows faintly until a block is touched, so a dense
   *  graph stops being a wall of red over the bars it is describing. */
  dimDependencies: boolean;
  /** Multiplier on the current scale's pixels-per-day. The three scales are coarse
   *  steps — 60, 20 and 5 — so this is what makes the granularity continuous. */
  zoom: number;
  //
  setBlockIds: (ids: string[]) => void;
  setLinkingSource: (id: string | null) => void;
  getBlockById: (blockId: string) => IGanttBlock;
  // computed functions
  getIsCurrentDependencyDragging: (blockId: string) => boolean;
  isBlockActive: (blockId: string) => boolean;
  // actions
  updateCurrentView: (view: TGanttViews) => void;
  updateCurrentViewData: (data: ChartDataType | undefined) => void;
  updateActiveBlockId: (blockId: string | null) => void;
  updateRenderView: (data: any) => void;
  updateAllBlocksOnChartChangeWhileDragging: (addedWidth: number) => void;
  getUpdatedPositionAfterDrag: (
    id: string,
    shouldUpdateHalfBlock: boolean,
    ignoreDependencies?: boolean
  ) => IBlockUpdateDependencyData[];
  updateBlockPosition: (id: string, deltaLeft: number, deltaWidth: number, ignoreDependencies?: boolean) => void;
  getNumberOfDaysFromPosition: (position: number | undefined) => number | undefined;
  setIsDragging: (isDragging: boolean) => void;
  setSidebarWidth: (width: number) => void;
  commitSidebarPreferences: () => void;
  toggleSidebarCollapsed: (value?: boolean) => void;
  toggleShowWeekends: (value?: boolean) => void;
  toggleDimDependencies: (value?: boolean) => void;
  setZoom: (value: number) => void;
  initGantt: () => void;

  getDateFromPositionOnGantt: (position: number, offsetDays: number) => Date | undefined;
  getPositionFromDateOnGantt: (date: string | Date, offSetWidth: number) => number | undefined;
}

export class BaseTimeLineStore implements IBaseTimelineStore {
  blocksMap: Record<string, IGanttBlock> = {};
  blockIds: string[] | undefined = undefined;

  isDragging: boolean = false;
  currentView: TGanttViews = "week";
  showWeekends = true;
  dimDependencies = true;
  zoom = 1;
  currentViewData: ChartDataType | undefined = undefined;
  activeBlockId: string | null = null;
  renderView: any = [];
  // click-to-link: the block whose dependency handle was clicked first
  linkingSourceId: string | null = null;
  // Which named plan snapshot the ghost bars draw. Empty = the newest, which is
  // what a reader wants until they deliberately look back at an older promise.
  // Not persisted: it is a question being asked, not a preference.
  selectedBaselineId: string = "";
  sidebarWidth: number = SIDEBAR_WIDTH;
  isSidebarCollapsed: boolean = false;

  rootStore: RootStore;

  isDependencyEnabled = false;

  constructor(_rootStore: RootStore) {
    // restore before makeObservable so the persisted size is the first observed value
    this.restoreSidebarPreferences();

    makeObservable(this, {
      // observables
      blocksMap: observable,
      blockIds: observable,
      isDragging: observable.ref,
      currentView: observable.ref,
      currentViewData: observable,
      activeBlockId: observable.ref,
      renderView: observable,
      linkingSourceId: observable.ref,
      selectedBaselineId: observable.ref,
      setSelectedBaselineId: action,
      sidebarWidth: observable.ref,
      isSidebarCollapsed: observable.ref,
      showWeekends: observable.ref,
      dimDependencies: observable.ref,
      zoom: observable.ref,
      // actions
      setIsDragging: action,
      setBlockIds: action.bound,
      initGantt: action.bound,
      updateCurrentView: action.bound,
      updateCurrentViewData: action.bound,
      updateActiveBlockId: action.bound,
      updateRenderView: action.bound,
      setLinkingSource: action.bound,
      setSidebarWidth: action.bound,
      toggleSidebarCollapsed: action.bound,
      toggleShowWeekends: action.bound,
      toggleDimDependencies: action.bound,
      setZoom: action.bound,
    });

    this.initGantt();

    this.rootStore = _rootStore;
  }

  /**
   * Update Block Ids to derive blocks from
   * @param ids
   */
  setBlockIds = (ids: string[]) => {
    this.blockIds = ids;
  };

  /**
   * setIsDragging
   * @param isDragging
   */
  setIsDragging = (isDragging: boolean) => {
    runInAction(() => {
      this.isDragging = isDragging;
    });
  };

  /**
   * @description set the timeline sidebar width, clamped to the allowed range
   * this fires on every mousemove of a resize drag, so it never touches localStorage;
   * the caller commits once at the end of the drag via commitSidebarPreferences
   * @param {number} width
   */
  setSidebarWidth = (width: number) => {
    runInAction(() => {
      this.sidebarWidth = clampSidebarWidth(width);
    });
  };

  /**
   * @description persist the current sidebar preferences, to be called at the end of a resize drag
   */
  commitSidebarPreferences = () => {
    this.persistSidebarPreferences();
  };

  /**
   * @description collapse/expand the timeline sidebar, toggles when no value is passed
   * @param {boolean | undefined} value
   */
  toggleSidebarCollapsed = (value?: boolean) => {
    runInAction(() => {
      this.isSidebarCollapsed = value ?? !this.isSidebarCollapsed;
    });
    this.persistSidebarPreferences();
  };

  toggleShowWeekends = (value?: boolean) => {
    runInAction(() => {
      this.showWeekends = value ?? !this.showWeekends;
    });
    this.persistSidebarPreferences();
  };

  setZoom = (value: number) => {
    runInAction(() => {
      this.zoom = clampZoom(value);
    });
    this.persistSidebarPreferences();
  };

  toggleDimDependencies = (value?: boolean) => {
    runInAction(() => {
      this.dimDependencies = value ?? !this.dimDependencies;
    });
    this.persistSidebarPreferences();
  };

  /** localStorage is unavailable in some browsers/privacy modes, so both sides are best-effort */
  setSelectedBaselineId = (id: string) => {
    this.selectedBaselineId = id;
  };

  private restoreSidebarPreferences() {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (!stored) {
        // Nothing saved, so this is a first visit. On a 390px phone the default
        // sidebar takes the whole viewport and the first paint is a list of task
        // names with no chart beside it — the one thing the page is for. Start
        // collapsed there; the Collapse/expand button is always visible, so a
        // reader who wants the names back is one tap away, and this choice is
        // persisted the moment they make it.
        this.isSidebarCollapsed = typeof window !== "undefined" && window.innerWidth < 768;
        return;
      }

      const { width, collapsed, showWeekends, dimDependencies, zoom } = JSON.parse(
        stored
      ) as Partial<TSidebarPreferences>;
      if (typeof width === "number" && Number.isFinite(width)) this.sidebarWidth = clampSidebarWidth(width);
      if (typeof collapsed === "boolean") this.isSidebarCollapsed = collapsed;
      if (typeof showWeekends === "boolean") this.showWeekends = showWeekends;
      if (typeof dimDependencies === "boolean") this.dimDependencies = dimDependencies;
      if (typeof zoom === "number") this.zoom = clampZoom(zoom);
    } catch {
      // keep the defaults
    }
  }

  private persistSidebarPreferences() {
    try {
      const preferences: TSidebarPreferences = {
        width: this.sidebarWidth,
        collapsed: this.isSidebarCollapsed,
        showWeekends: this.showWeekends,
        dimDependencies: this.dimDependencies,
        zoom: this.zoom,
      };
      localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // width stays session-only
    }
  }

  /**
   * @description check if block is active
   * @param {string} blockId
   */
  isBlockActive = computedFn((blockId: string): boolean => this.activeBlockId === blockId);

  /**
   * @description update current view
   * @param {TGanttViews} view
   */
  updateCurrentView = (view: TGanttViews) => {
    this.currentView = view;
  };

  /**
   * @description update current view data
   * @param {ChartDataType | undefined} data
   */
  updateCurrentViewData = (data: ChartDataType | undefined) => {
    runInAction(() => {
      this.currentViewData = data;
    });
  };

  /**
   * @description update active block
   * @param {string | null} block
   */
  updateActiveBlockId = (blockId: string | null) => {
    this.activeBlockId = blockId;
  };

  /**
   * @description set (or clear) the click-to-link source block
   * @param {string | null} id
   */
  setLinkingSource = (id: string | null) => {
    this.linkingSourceId = id;
  };

  /**
   * @description update render view
   * @param {any[]} data
   */
  updateRenderView = (data: any[]) => {
    this.renderView = data;
  };

  /**
   * @description initialize gantt chart with month view
   */
  initGantt = () => {
    const newCurrentViewData = currentViewDataWithView(this.currentView);

    runInAction(() => {
      this.currentViewData = newCurrentViewData;
      this.blocksMap = {};
      this.blockIds = undefined;
    });
  };

  /** Gets Block from Id */
  getBlockById = computedFn((blockId: string) => this.blocksMap[blockId]);

  /**
   * updates the BlocksMap from blockIds
   * @param getDataById
   * @returns
   */
  updateBlocks(getDataById: (id: string) => BlockData | undefined | null, type?: EGanttBlockType, index?: number) {
    if (!this.blockIds || !Array.isArray(this.blockIds) || this.isDragging) return true;

    const updatedBlockMaps: { path: string[]; value: any }[] = [];
    const newBlocks: IGanttBlock[] = [];

    // Loop through blockIds to generate blocks Data
    for (const blockId of this.blockIds) {
      const blockData = getDataById(blockId);
      if (!blockData) continue;

      const block: IGanttBlock = {
        data: blockData,
        id: blockData?.id,
        name: blockData.name,
        sort_order: blockData?.sort_order ?? undefined,
        start_date: blockData?.start_date ?? undefined,
        target_date: blockData?.target_date ?? undefined,
        meta: {
          type,
          index,
          project_id: blockData?.project_id,
        },
      };
      if (this.currentViewData && (this.currentViewData?.data?.startDate || this.currentViewData?.data?.dayWidth)) {
        block.position = getItemPositionWidth(this.currentViewData, block);
      }

      // create block updates if the block already exists, or push them to newBlocks
      if (this.blocksMap[blockId]) {
        for (const key of Object.keys(block)) {
          const currValue = this.blocksMap[blockId][key as keyof IGanttBlock];
          const nextValue = block[key as keyof IGanttBlock];
          if (!isEqual(currValue, nextValue)) {
            updatedBlockMaps.push({ path: [blockId, key], value: nextValue });
          }
        }
      } else {
        newBlocks.push(block);
      }
    }

    // update the store with the block updates
    runInAction(() => {
      for (const updatedBlock of updatedBlockMaps) {
        set(this.blocksMap, updatedBlock.path, updatedBlock.value);
      }

      for (const newBlock of newBlocks) {
        set(this.blocksMap, [newBlock.id], newBlock);
      }
    });
  }

  /**
   * returns number of days that the position pixels span across the timeline chart
   * @param position
   * @returns
   */
  getNumberOfDaysFromPosition = (position: number | undefined) => {
    if (!this.currentViewData || !position) return;

    return Math.round(position / this.currentViewData.data.dayWidth);
  };

  /**
   * returns position of the date on chart
   */
  getPositionFromDateOnGantt = computedFn((date: string | Date, offSetWidth: number) => {
    if (!this.currentViewData) return;

    return getPositionFromDate(this.currentViewData, date, offSetWidth);
  });

  /**
   * returns the date at which the position corresponds to on the timeline chart
   */
  getDateFromPositionOnGantt = computedFn((position: number, offsetDays: number) => {
    if (!this.currentViewData) return;

    return getDateFromPositionOnGantt(position, this.currentViewData, offsetDays);
  });

  /**
   * Adds width on Chart position change while the blocks are being dragged
   * @param addedWidth
   */
  updateAllBlocksOnChartChangeWhileDragging = action((addedWidth: number) => {
    if (!this.blockIds || !this.isDragging) return;

    runInAction(() => {
      this.blockIds?.forEach((blockId) => {
        const currBlock = this.blocksMap[blockId];

        if (!currBlock || !currBlock.position) return;

        currBlock.position.marginLeft += addedWidth;
      });
    });
  });

  /**
   * returns updates dates of blocks post drag.
   * @param id
   * @param shouldUpdateHalfBlock if is a half block then update the incomplete block only if this is true
   * @returns
   */
  getUpdatedPositionAfterDrag = action((id: string, shouldUpdateHalfBlock: boolean) => {
    const currBlock = this.blocksMap[id];

    if (!currBlock?.position || !this.currentViewData) return [];

    const updatePayload: IBlockUpdateDependencyData = { id, meta: currBlock.meta };

    // If shouldUpdateHalfBlock or the start date is available then update start date
    if (shouldUpdateHalfBlock || currBlock.start_date) {
      updatePayload.start_date = renderFormattedPayloadDate(
        getDateFromPositionOnGantt(currBlock.position.marginLeft, this.currentViewData)
      );
    }
    // If shouldUpdateHalfBlock or the target date is available then update target date
    if (shouldUpdateHalfBlock || currBlock.target_date) {
      updatePayload.target_date = renderFormattedPayloadDate(
        getDateFromPositionOnGantt(currBlock.position.marginLeft + currBlock.position.width, this.currentViewData, -1)
      );
    }

    return [updatePayload];
  });

  /**
   * updates the block's position such as marginLeft and width while dragging
   * @param id
   * @param deltaLeft
   * @param deltaWidth
   * @returns
   */
  updateBlockPosition = action((id: string, deltaLeft: number, deltaWidth: number) => {
    const currBlock = this.blocksMap[id];

    if (!currBlock?.position) return;

    const newMarginLeft = currBlock.position.marginLeft + deltaLeft;
    const newWidth = currBlock.position.width + deltaWidth;

    runInAction(() => {
      set(this.blocksMap, [id, "position"], {
        marginLeft: newMarginLeft ?? currBlock.position?.marginLeft,
        width: newWidth ?? currBlock.position?.width,
      });
    });
  });

  // Dummy method to return if the current Block's dependency is being dragged
  getIsCurrentDependencyDragging = computedFn((_blockId: string) => false);
}
