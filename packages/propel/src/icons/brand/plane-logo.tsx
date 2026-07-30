/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";

// Square intrinsic defaults so they match the square viewBox: every call site sizes
// with `h-N w-auto`, and a non-square default would letterbox the mark.
export function PlaneLogo({ width = "64", height = "64", className, color = "currentColor" }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 64 64"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Arribada "A": one outline whose bottom notch separates the legs, plus an
          evenodd counter above the crossbar. currentColor so the same mark works
          on white, on navy and on an accent-primary tile. */}
      <path d="M32 3L62 61H52.7L44.9 46H19.1L11.3 61H2ZM23.2 38H40.8L32 21Z" fill={color} fillRule="evenodd" />
    </svg>
  );
}
