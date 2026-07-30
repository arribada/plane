/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderFormattedDate } from "@plane/utils";

// A half-open range still tells the reader something, so one missing end is
// rendered rather than swallowed.
export const formatRange = (start: string | null, target: string | null): string => {
  const from = renderFormattedDate(start);
  const to = renderFormattedDate(target);
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "";
};

export const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
