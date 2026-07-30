/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";

export function PlaneWordmark({ width = "146", height = "44", className, color = "currentColor" }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 146 44"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Live text rather than traced outlines: the wordmark then picks up the
          app font at every size and stays crisp, and there is no glyph data to
          re-cut when the type changes. */}
      <text
        x="73"
        y="32"
        textAnchor="middle"
        fontFamily="inherit"
        fontSize="30"
        fontWeight={600}
        letterSpacing="0.5"
        fill={color}
      >
        Arribada
      </text>
    </svg>
  );
}
