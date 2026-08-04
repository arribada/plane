/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLogoProps } from "./common";

export type TSticky = {
  created_at?: string | undefined;
  created_by?: string | undefined;
  background_color?: string | null | undefined;
  description?: object | undefined;
  description_html?: string | undefined;
  id: string;
  logo_props: TLogoProps | undefined;
  name?: string;
  sort_order: number | undefined;
  updated_at?: string | undefined;
  updated_by?: string | undefined;
  workspace: string | undefined;
  /**
   * Where the owner dragged this note, and how big they made it.
   *
   * null / undefined means "never touched — lay this one out automatically",
   * which is what keeps the packed masonry the default and makes "tidy up" a
   * write of nulls rather than a second layout-mode flag to keep in sync.
   * All four move together: a sticky is either placed or it is not.
   */
  position_x?: number | null;
  position_y?: number | null;
  width?: number | null;
  height?: number | null;
};

/** The four coordinates as one value, since they are only ever set together. */
export type TStickyLayout = {
  position_x: number;
  position_y: number;
  width: number;
  height: number;
};
