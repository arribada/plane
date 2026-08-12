/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChartDataType, IBlockUpdateData, IGanttBlock } from "@plane/types";

export const handleOrderChange = (
  draggingBlockId: string | undefined,
  droppedBlockId: string | undefined,
  dropAtEndOfList: boolean,
  blockIds: string[] | null,
  getBlockById: (id: string, currentViewData?: ChartDataType) => IGanttBlock,
  blockUpdateHandler: (block: any, payload: IBlockUpdateData) => void,
  /** ARRIBADA FIX: the sort_order to use for an id, overriding the store's.
   *  A reorder that begins by freezing the on-screen sequence has just rewritten
   *  every sort_order server-side, and the local store still holds the ones from
   *  before — so the midpoint below would be computed from numbers nobody is
   *  looking at and the row would land somewhere other than where it was
   *  dropped. Absent, or returning undefined for an id, falls straight back to
   *  the store, which is every drag that did not begin with a freeze. */
  sortOrderOf?: (id: string) => number | undefined
) => {
  if (!blockIds || !draggingBlockId || !droppedBlockId) return;

  const orderOf = (id: string | undefined): number =>
    (id === undefined ? undefined : (sortOrderOf?.(id) ?? getBlockById(id)?.sort_order)) ?? 0;

  const sourceBlockIndex = blockIds.findIndex((id) => id === draggingBlockId);
  const destinationBlockIndex = dropAtEndOfList ? blockIds.length : blockIds.findIndex((id) => id === droppedBlockId);

  // return if dropped outside the list
  if (sourceBlockIndex === -1 || destinationBlockIndex === -1 || sourceBlockIndex === destinationBlockIndex) return;

  let updatedSortOrder = orderOf(blockIds[sourceBlockIndex]);

  // update the sort order to the lowest if dropped at the top
  if (destinationBlockIndex === 0) updatedSortOrder = orderOf(blockIds[0]) - 1000;
  // update the sort order to the highest if dropped at the bottom
  else if (destinationBlockIndex === blockIds.length) updatedSortOrder = orderOf(blockIds[blockIds.length - 1]) + 1000;
  // update the sort order to the average of the two adjacent blocks if dropped in between
  else {
    const destinationSortingOrder = orderOf(blockIds[destinationBlockIndex]);
    const relativeDestinationSortingOrder = orderOf(blockIds[destinationBlockIndex - 1]);

    updatedSortOrder = (destinationSortingOrder + relativeDestinationSortingOrder) / 2;
  }

  // call the block update handler with the updated sort order, new and old index
  blockUpdateHandler(getBlockById(blockIds[sourceBlockIndex])?.data, {
    sort_order: {
      destinationIndex: destinationBlockIndex,
      newSortOrder: updatedSortOrder,
      sourceIndex: sourceBlockIndex,
    },
  });
};
