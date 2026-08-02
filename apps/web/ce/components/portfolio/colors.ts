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

// Project health from its planned vs derived dates: red = drifting or past due,
// amber = due within a week, green = on track, gray = no dates to judge.
//
// `glyph` travels with the colour because red-and-green on an 8px dot is exactly
// the pair a deuteranope cannot separate — roughly one person on a ten-person
// team — and a dot has no shape to fall back on. It also survives a screenshot
// pasted into a funder update, where the tooltip does not, and it is readable on
// a phone, where hovering is not a thing.
export const projectHealth = (p: {
  target_date: string | null;
  derived_target_date: string | null;
}): { color: string; label: string; glyph: string } | null => {
  const planned = p.target_date;
  const derived = p.derived_target_date;
  if (!planned && !derived) return null; // nothing to judge
  const today = new Date().toISOString().slice(0, 10);
  const end = derived ?? planned!;
  if (planned && derived && derived > planned) return { color: "#dc2626", label: "Drifting past the plan", glyph: "!" };
  if (end < today) return { color: "#dc2626", label: "Past due", glyph: "!" };
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  if (end <= soon.toISOString().slice(0, 10)) return { color: "#f59e0b", label: "Due within a week", glyph: "•" };
  return { color: "#16a34a", label: "On track", glyph: "✓" };
};

// Drift in days of the current derived target vs the frozen baseline target.
// Positive = the project's end has slipped past its baseline; negative = ahead.
export const baselineDrift = (p: {
  derived_target_date: string | null;
  baseline_target_date: string | null;
}): number | null => {
  if (!p.baseline_target_date || !p.derived_target_date) return null;
  const base = new Date(p.baseline_target_date + "T00:00:00").getTime();
  const cur = new Date(p.derived_target_date + "T00:00:00").getTime();
  const days = Math.round((cur - base) / 86400000);
  return days === 0 ? null : days;
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
