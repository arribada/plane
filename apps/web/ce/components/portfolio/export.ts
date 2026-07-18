/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Export the portfolio timeline as a self-contained image. Rather than screenshot
 * the on-screen gantt (which virtualizes rows and scrolls horizontally, so most of
 * it isn't in the DOM), we render a fresh SVG straight from the project data at
 * full width — then hand back SVG, or rasterize it to PNG via a canvas. No deps.
 */
import type { TPortfolioProject } from "@/plane-web/types/arribada";

type Row = { name: string; identifier: string; start: Date; end: Date; drift: boolean };

const DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (s: string | null): Date | null => (s ? new Date(s + "T00:00:00") : null);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Build an SVG timeline string for the displayed projects (those with any dates).
export const buildPortfolioSvg = (projects: TPortfolioProject[], title = "Portfolio timeline"): string | null => {
  const rows: Row[] = [];
  for (const p of projects) {
    const start = parse(p.start_date) ?? parse(p.derived_start_date);
    const end = parse(p.target_date) ?? parse(p.derived_target_date);
    if (!start || !end) continue;
    const drift = !!(p.target_date && p.derived_target_date && parse(p.derived_target_date)! > parse(p.target_date)!);
    rows.push({ name: p.name, identifier: p.identifier, start, end: end < start ? start : end, drift });
  }
  if (rows.length === 0) return null;

  const min = new Date(Math.min(...rows.map((r) => r.start.getTime())));
  const max = new Date(Math.max(...rows.map((r) => r.end.getTime())));
  // pad the range by a few days each side
  min.setDate(min.getDate() - 3);
  max.setDate(max.getDate() + 3);
  const span = Math.max(1, (max.getTime() - min.getTime()) / DAY);

  const LABEL_W = 200;
  const ROW_H = 30;
  const HEAD_H = 56;
  const PAD = 20;
  const TIME_W = Math.min(1600, Math.max(600, span * 6)); // ~6px/day, clamped
  const W = LABEL_W + TIME_W + PAD * 2;
  const H = HEAD_H + rows.length * ROW_H + PAD;
  const x = (d: Date) => LABEL_W + PAD + ((d.getTime() - min.getTime()) / DAY / span) * TIME_W;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${PAD}" y="26" font-size="16" font-weight="700" fill="#111827">${esc(title)}</text>`);
  parts.push(`<text x="${W - PAD}" y="26" font-size="11" fill="#9ca3af" text-anchor="end">${min.toISOString().slice(0, 10)} → ${max.toISOString().slice(0, 10)}</text>`);

  // month gridlines + labels
  const cur = new Date(min.getFullYear(), min.getMonth(), 1);
  while (cur <= max) {
    if (cur >= min) {
      const gx = x(cur);
      parts.push(`<line x1="${gx.toFixed(1)}" y1="${HEAD_H - 14}" x2="${gx.toFixed(1)}" y2="${H - PAD}" stroke="#eef0f3" stroke-width="1"/>`);
      parts.push(`<text x="${(gx + 4).toFixed(1)}" y="${HEAD_H - 20}" font-size="10" fill="#9ca3af">${MONTHS[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}</text>`);
    }
    cur.setMonth(cur.getMonth() + 1);
  }

  rows.forEach((r, i) => {
    const y = HEAD_H + i * ROW_H;
    const bx = x(r.start);
    const bw = Math.max(4, x(r.end) - bx);
    const fill = r.drift ? "#ef4444" : "#3b82f6";
    parts.push(`<text x="${PAD}" y="${(y + ROW_H / 2 + 4).toFixed(1)}" font-size="12" fill="#374151">${esc(r.name.slice(0, 30))}</text>`);
    parts.push(`<rect x="${bx.toFixed(1)}" y="${(y + 6).toFixed(1)}" width="${bw.toFixed(1)}" height="${ROW_H - 12}" rx="4" fill="${fill}" opacity="0.9"/>`);
  });

  parts.push("</svg>");
  return parts.join("");
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const downloadSvg = (svg: string, filename: string) => {
  triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
};

// Rasterize the SVG to a PNG via an off-screen canvas (all browser-native).
export const downloadPng = (svg: string, filename: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const svgUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    img.onload = () => {
      const scale = 2; // retina-ish
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas context"));
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, filename);
        resolve();
      }, "image/png");
    };
    img.onerror = () => reject(new Error("svg render failed"));
    img.src = svgUrl;
  });
