/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { orderBy, set } from "lodash-es";
import { observable, action, makeObservable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import { STICKIES_PER_PAGE } from "@plane/constants";
import type { InstructionType, TLoader, TPaginationInfo, TSticky, TStickyLayout } from "@plane/types";
import { StickyService } from "@/services/sticky.service";

export interface IStickyStore {
  creatingSticky: boolean;
  loader: TLoader;
  workspaceStickies: Record<string, string[]>; // workspaceId -> stickyIds
  stickies: Record<string, TSticky>; // stickyId -> sticky
  searchQuery: string;
  activeStickyId: string | undefined;
  recentStickyId: string | undefined;
  showAddNewSticky: boolean;
  paginationInfo: TPaginationInfo | undefined;
  // computed
  getWorkspaceStickyIds: (workspaceSlug: string) => string[];
  // actions
  toggleShowNewSticky: (value: boolean) => void;
  updateSearchQuery: (query: string) => void;
  fetchWorkspaceStickies: (workspaceSlug: string) => void;
  createSticky: (workspaceSlug: string, sticky: Partial<TSticky>) => Promise<void>;
  updateSticky: (workspaceSlug: string, id: string, updates: Partial<TSticky>) => Promise<void>;
  deleteSticky: (workspaceSlug: string, id: string) => Promise<void>;
  updateActiveStickyId: (id: string | undefined) => void;
  fetchRecentSticky: (workspaceSlug: string) => Promise<void>;
  fetchNextWorkspaceStickies: (workspaceSlug: string) => Promise<void>;
  updateStickyPosition: (
    workspaceSlug: string,
    stickyId: string,
    destinationId: string,
    edge: InstructionType
  ) => Promise<void>;
  updateStickyLayout: (workspaceSlug: string, stickyId: string, layout: TStickyLayout) => Promise<void>;
  resetStickyLayouts: (workspaceSlug: string) => Promise<void>;
}

export class StickyStore implements IStickyStore {
  loader: TLoader = "init-loader";
  creatingSticky = false;
  workspaceStickies: Record<string, string[]> = {};
  stickies: Record<string, TSticky> = {};
  recentStickyId: string | undefined = undefined;
  searchQuery = "";
  activeStickyId: string | undefined = undefined;
  showAddNewSticky = false;
  paginationInfo: TPaginationInfo | undefined = undefined;

  // services
  stickyService;

  constructor() {
    makeObservable(this, {
      // observables
      creatingSticky: observable,
      loader: observable,
      activeStickyId: observable,
      showAddNewSticky: observable,
      recentStickyId: observable,
      workspaceStickies: observable,
      stickies: observable,
      searchQuery: observable,
      // actions
      updateSearchQuery: action,
      updateSticky: action,
      deleteSticky: action,
      fetchNextWorkspaceStickies: action,
      fetchWorkspaceStickies: action,
      createSticky: action,
      updateActiveStickyId: action,
      toggleShowNewSticky: action,
      fetchRecentSticky: action,
      updateStickyPosition: action,
      updateStickyLayout: action,
      resetStickyLayouts: action,
    });
    this.stickyService = new StickyService();
  }

  getWorkspaceStickyIds = computedFn((workspaceSlug: string) =>
    orderBy(
      (this.workspaceStickies[workspaceSlug] || []).map((stickyId) => this.stickies[stickyId]),
      ["sort_order"],
      ["desc"]
    ).map((sticky) => sticky.id)
  );

  toggleShowNewSticky = (value: boolean) => {
    this.showAddNewSticky = value;
  };

  updateSearchQuery = (query: string) => {
    this.searchQuery = query;
  };

  updateActiveStickyId = (id: string | undefined) => {
    this.activeStickyId = id;
  };

  fetchRecentSticky = async (workspaceSlug: string) => {
    const response = await this.stickyService.getStickies(workspaceSlug, "1:0:0", undefined, 1);
    runInAction(() => {
      this.recentStickyId = response.results[0]?.id;
      this.stickies[response.results[0]?.id] = response.results[0];
    });
  };
  fetchNextWorkspaceStickies = async (workspaceSlug: string) => {
    try {
      if (!this.paginationInfo?.next_cursor || !this.paginationInfo.next_page_results || this.loader === "pagination") {
        return;
      }
      this.loader = "pagination";
      const response = await this.stickyService.getStickies(
        workspaceSlug,
        this.paginationInfo.next_cursor,
        this.searchQuery
      );

      runInAction(() => {
        const { results, ...paginationInfo } = response;

        // Add new stickies to store
        results.forEach((sticky) => {
          if (!this.workspaceStickies[workspaceSlug]?.includes(sticky.id)) {
            this.workspaceStickies[workspaceSlug] = [...(this.workspaceStickies[workspaceSlug] || []), sticky.id];
          }
          this.stickies[sticky.id] = sticky;
        });

        // Update pagination info directly from backend
        set(this, "paginationInfo", paginationInfo);
        set(this, "loader", "loaded");
      });
    } catch (e) {
      console.error(e);
      runInAction(() => {
        this.loader = "loaded";
      });
    }
  };

  fetchWorkspaceStickies = async (workspaceSlug: string) => {
    try {
      if (this.workspaceStickies[workspaceSlug]) {
        this.loader = "mutation";
      } else {
        this.loader = "init-loader";
      }

      const response = await this.stickyService.getStickies(
        workspaceSlug,
        `${STICKIES_PER_PAGE}:0:0`,
        this.searchQuery
      );

      runInAction(() => {
        const { results, ...paginationInfo } = response;

        results.forEach((sticky) => {
          this.stickies[sticky.id] = sticky;
        });
        this.workspaceStickies[workspaceSlug] = results.map((sticky) => sticky.id);
        set(this, "paginationInfo", paginationInfo);
        this.loader = "loaded";
      });
    } catch (e) {
      console.error(e);
      runInAction(() => {
        this.loader = "loaded";
      });
    }
  };

  createSticky = async (workspaceSlug: string, sticky: Partial<TSticky>) => {
    if (!this.showAddNewSticky) return;
    this.showAddNewSticky = false;
    this.creatingSticky = true;
    const workspaceStickies = this.workspaceStickies[workspaceSlug] || [];
    const response = await this.stickyService.createSticky(workspaceSlug, sticky);
    runInAction(() => {
      this.stickies[response.id] = response;
      this.workspaceStickies[workspaceSlug] = [response.id, ...workspaceStickies];
      this.activeStickyId = response.id;
      this.recentStickyId = response.id;
      this.creatingSticky = false;
    });
  };

  updateSticky = async (workspaceSlug: string, id: string, updates: Partial<TSticky>) => {
    const sticky = this.stickies[id];
    if (!sticky) return;
    try {
      runInAction(() => {
        Object.keys(updates).forEach((key) => {
          const currentStickyKey = key as keyof TSticky;
          set(this.stickies[id], key, updates[currentStickyKey] || undefined);
        });
      });
      this.recentStickyId = id;
      await this.stickyService.updateSticky(workspaceSlug, id, updates);
    } catch (error) {
      console.error("Error in updating sticky:", error);
      this.stickies[id] = sticky;
      // Rethrown with the original attached: callers only show a toast, but a
      // bare `new Error()` threw away the only description of what failed.
      throw new Error("Failed to update sticky", { cause: error });
    }
  };

  deleteSticky = async (workspaceSlug: string, id: string) => {
    const sticky = this.stickies[id];
    if (!sticky) return;
    try {
      this.workspaceStickies[workspaceSlug] = this.workspaceStickies[workspaceSlug].filter(
        (stickyId) => stickyId !== id
      );
      if (this.activeStickyId === id) this.activeStickyId = undefined;
      delete this.stickies[id];
      this.recentStickyId = this.workspaceStickies[workspaceSlug][0];
      await this.stickyService.deleteSticky(workspaceSlug, id);
    } catch (e) {
      console.log(e);
      this.stickies[id] = sticky;
    }
  };

  updateStickyPosition = async (
    workspaceSlug: string,
    stickyId: string,
    destinationId: string,
    edge: InstructionType
  ) => {
    const previousSortOrder = this.stickies[stickyId].sort_order;
    try {
      let resultSequence = 10000;
      const workspaceStickies = this.workspaceStickies[workspaceSlug] || [];
      const stickies = workspaceStickies.map((id) => this.stickies[id]);
      const sortedStickies = orderBy(stickies, "sort_order", "desc").map((sticky) => sticky.id);
      const destinationSequence = this.stickies[destinationId]?.sort_order || undefined;

      if (destinationSequence) {
        const destinationIndex = sortedStickies.findIndex((id) => id === destinationId);

        if (edge === "reorder-above") {
          const prevSequence = this.stickies[sortedStickies[destinationIndex - 1]]?.sort_order || undefined;
          if (prevSequence) {
            resultSequence = (destinationSequence + prevSequence) / 2;
          } else {
            resultSequence = destinationSequence + resultSequence;
          }
        } else {
          // reorder-below
          resultSequence = destinationSequence - resultSequence;
        }
      }

      runInAction(() => {
        this.stickies[stickyId] = {
          ...this.stickies[stickyId],
          sort_order: resultSequence,
        };
      });

      await this.stickyService.updateSticky(workspaceSlug, stickyId, {
        sort_order: resultSequence,
      });
    } catch (error) {
      console.error("Failed to move sticky");
      runInAction(() => {
        this.stickies[stickyId].sort_order = previousSortOrder;
      });
      throw error;
    }
  };

  /**
   * Commits where a sticky was dragged to and how big it was made.
   *
   * Deliberately not routed through `updateSticky`: that one writes
   * `updates[key] || undefined` into the local copy, and a sticky dragged
   * against the left or top edge has a coordinate of exactly 0, which is
   * falsy. It would reach the server correctly and then read back locally as
   * "never placed", so the note would jump home until the next refetch.
   */
  updateStickyLayout = async (workspaceSlug: string, stickyId: string, layout: TStickyLayout) => {
    const sticky = this.stickies[stickyId];
    if (!sticky) return;
    const previous = {
      position_x: sticky.position_x,
      position_y: sticky.position_y,
      width: sticky.width,
      height: sticky.height,
    };
    try {
      runInAction(() => {
        Object.assign(this.stickies[stickyId], layout);
      });
      await this.stickyService.updateSticky(workspaceSlug, stickyId, layout);
    } catch (error) {
      console.error("Error in updating sticky layout:", error);
      runInAction(() => {
        Object.assign(this.stickies[stickyId], previous);
      });
      throw error;
    }
  };

  /**
   * Tidy up: every placed sticky forgets where it was put, and the automatic
   * layout takes over again. `sort_order` is untouched on purpose — it is what
   * the masonry orders by, so tidying up returns you to the arrangement you
   * had before you started dragging rather than to an arbitrary one.
   *
   * Rolls back every sticky if any write fails, because a half-tidied board is
   * a state the user cannot reason about: some notes home, some not, and no
   * way to tell which.
   */
  resetStickyLayouts = async (workspaceSlug: string) => {
    const placedIds = (this.workspaceStickies[workspaceSlug] || []).filter(
      (id) => this.stickies[id]?.position_x != null
    );
    if (placedIds.length === 0) return;
    const previous = new Map(
      placedIds.map((id) => [
        id,
        {
          position_x: this.stickies[id].position_x,
          position_y: this.stickies[id].position_y,
          width: this.stickies[id].width,
          height: this.stickies[id].height,
        },
      ])
    );
    const cleared = { position_x: null, position_y: null, width: null, height: null };
    try {
      runInAction(() => {
        placedIds.forEach((id) => Object.assign(this.stickies[id], cleared));
      });
      await Promise.all(placedIds.map((id) => this.stickyService.updateSticky(workspaceSlug, id, cleared)));
    } catch (error) {
      console.error("Error in resetting sticky layouts:", error);
      runInAction(() => {
        previous.forEach((layout, id) => {
          if (this.stickies[id]) Object.assign(this.stickies[id], layout);
        });
      });
      throw error;
    }
  };
}
