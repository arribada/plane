/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const BLOCK_HEIGHT = 44;

export const HEADER_HEIGHT = 48;

export const GANTT_BREADCRUMBS_HEIGHT = 40;

/** Default width of the timeline sidebar; the live width lives on the timeline store. */
export const SIDEBAR_WIDTH = 360;

export const GANTT_SIDEBAR_MIN_WIDTH = 240;

export const GANTT_SIDEBAR_MAX_WIDTH = 640;

export const GANTT_SIDEBAR_COLLAPSED_WIDTH = 28;

export const DEFAULT_BLOCK_WIDTH = 60;

/** Width of a resize/dependency hit area, and the bar width below which those
 *  handles step fully outside the bar.
 *
 *  Each handle straddles the edge, taking half its width from inside the bar, so
 *  a bar loses HANDLE_WIDTH to them in total. Below the threshold that left no
 *  middle to grab and the bar could not be moved at all — which is every short
 *  task at the month and quarter scales, where a three-day item is eight pixels
 *  wide. Under it the handles sit entirely outside and the whole bar moves. */
export const HANDLE_WIDTH = 12;
export const NARROW_BLOCK_PX = 28;

export const GANTT_SELECT_GROUP = "gantt-issues";
