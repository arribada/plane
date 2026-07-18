/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Priority palette (mirrors Plane's issue priority colors).
export const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#dc2626",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#3f76ff",
  none: "#94a3b8",
};

// Deterministic, well-spread hue from an id — same project always gets the same
// color, no palette to maintain and no extra data to fetch.
export const projectColor = (id: string): string => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 58%, 52%)`;
};

// Pick black/white text for contrast against a bar color. Handles hex and hsl.
export const readableTextColor = (color: string): string => {
  let r = 0;
  let g = 0;
  let b = 0;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const hsl = color.match(/hsl\(\s*(\d+)[,\s]+(\d+)%[,\s]+(\d+)%/i);
    if (hsl) {
      const h = +hsl[1] / 360;
      const s = +hsl[2] / 100;
      const l = +hsl[3] / 100;
      if (s === 0) {
        r = g = b = l * 255;
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hue2rgb = (t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        r = hue2rgb(h + 1 / 3) * 255;
        g = hue2rgb(h) * 255;
        b = hue2rgb(h - 1 / 3) * 255;
      }
    } else {
      return "#ffffff";
    }
  }
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#0f0f0f" : "#ffffff";
};
