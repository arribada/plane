/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";

export function PlaneLockup({ width = "253", height = "53", className, color = "currentColor" }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 253 53"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Mark drawn in its own 64-unit square then scaled into the lockup, so it
          stays byte-identical to PlaneLogo. */}
      <g transform="translate(2 4.5) scale(0.6875)">
        <path d="M32 3L62 61H52.7L44.9 46H19.1L11.3 61H2ZM23.2 38H40.8L32 21Z" fill={color} fillRule="evenodd" />
      </g>
      {/* viewBox kept at 253x53 so the height/width pairs the call sites hardcode
          still land on the original aspect ratio. */}
      <text x="60" y="41" fontFamily="inherit" fontSize="40" fontWeight={600} letterSpacing="1" fill={color}>
        Arribada
      </text>
    </svg>
  );
}
