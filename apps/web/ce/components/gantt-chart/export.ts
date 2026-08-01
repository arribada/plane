/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Export the work-item timeline: a self-contained SVG, a PNG of it, or a CSV.
 *
 * Drawn fresh from the data rather than captured from the screen. The on-screen
 * chart virtualises its rows and scrolls sideways, so most of it is not in the DOM
 * at any moment — a screenshot of it would be a screenshot of the visible tenth.
 * Rendering again means the export is the whole plan at a width that suits paper,
 * and it carries what the screen carries: the bands, the dependency arrows, the
 * critical chain and the weekends.
 */

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type TExportRow = {
  id: string;
  /** Group headers are drawn as a band label rather than a bar. */
  kind: "group" | "item";
  label: string;
  identifier?: string;
  start: Date | null;
  end: Date | null;
  color?: string;
  assignee?: string;
  state?: string;
  critical?: boolean;
};

export type TExportEdge = { from: string; to: string; critical?: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const iso = (d: Date) => d.toISOString().slice(0, 10);

const LABEL_W = 260;
const ROW_H = 26;
const HEAD_H = 64;
const PAD = 20;
const BAR_INSET = 6;

/**
 * The SVG. Returns null when nothing on the chart is dated — an image of an empty
 * calendar is not a useful file to have handed someone.
 */
export const buildGanttSvg = (
  rows: TExportRow[],
  edges: TExportEdge[],
  options: { title: string; showWeekends?: boolean } = { title: "Timeline" }
): string | null => {
  const dated = rows.filter((r) => r.start && r.end);
  if (dated.length === 0) return null;

  const min = new Date(Math.min(...dated.map((r) => r.start!.getTime())));
  const max = new Date(Math.max(...dated.map((r) => r.end!.getTime())));
  min.setDate(min.getDate() - 2);
  max.setDate(max.getDate() + 2);
  const span = Math.max(1, (max.getTime() - min.getTime()) / DAY);

  // Wide enough to read a day, capped so a two-year plan is still one page.
  const TIME_W = Math.min(2400, Math.max(700, span * 8));
  const W = LABEL_W + TIME_W + PAD * 2;
  const H = HEAD_H + rows.length * ROW_H + PAD;
  const x = (d: Date) => LABEL_W + PAD + ((d.getTime() - min.getTime()) / DAY / span) * TIME_W;
  const rowY = (index: number) => HEAD_H + index * ROW_H;
  const midY = (index: number) => rowY(index) + ROW_H / 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif">`
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${PAD}" y="26" font-size="16" font-weight="700" fill="#111827">${esc(options.title)}</text>`);
  parts.push(
    `<text x="${W - PAD}" y="26" font-size="11" fill="#9ca3af" text-anchor="end">${iso(min)} → ${iso(max)}</text>`
  );

  // Weekends first so everything else sits on top of them.
  if (options.showWeekends !== false && span <= 400) {
    const dayW = TIME_W / span;
    for (let offset = 0; offset <= span; offset++) {
      const day = new Date(min.getTime() + offset * DAY);
      if (day.getDay() !== 0 && day.getDay() !== 6) continue;
      parts.push(
        `<rect x="${x(day).toFixed(1)}" y="${HEAD_H - 10}" width="${dayW.toFixed(2)}" height="${(H - PAD - HEAD_H + 10).toFixed(1)}" fill="#f6f7f9"/>`
      );
    }
  }

  // Month gridlines and labels.
  const monthsToDraw = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;
  for (let step = 0; step < monthsToDraw; step++) {
    const month = new Date(min.getFullYear(), min.getMonth() + step, 1);
    if (month < min) continue;
    const gx = x(month);
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${HEAD_H - 14}" x2="${gx.toFixed(1)}" y2="${H - PAD}" stroke="#eef0f3" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${(gx + 4).toFixed(1)}" y="${HEAD_H - 20}" font-size="10" fill="#9ca3af">${MONTHS[month.getMonth()]} ${String(month.getFullYear()).slice(2)}</text>`
    );
  }

  const indexById = new Map(rows.map((r, i) => [r.id, i] as const));

  // Dependency elbows, under the bars so a bar is never obscured by a line.
  for (const edge of edges) {
    const si = indexById.get(edge.from);
    const ti = indexById.get(edge.to);
    const source = si === undefined ? null : rows[si];
    const target = ti === undefined ? null : rows[ti];
    if (si === undefined || ti === undefined || !source?.end || !target?.start) continue;
    const x1 = x(source.end);
    const y1 = midY(si);
    const x2 = x(target.start);
    const y2 = midY(ti);
    const mid = Math.max(x1 + 6, x2 - 10);
    const stroke = edge.critical ? "#dc2626" : "#94a3b8";
    parts.push(
      `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} H ${mid.toFixed(1)} V ${y2.toFixed(1)} H ${x2.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${edge.critical ? 1.4 : 0.9}" opacity="${edge.critical ? 0.9 : 0.45}"/>`
    );
  }

  rows.forEach((row, index) => {
    const y = rowY(index);
    if (row.kind === "group") {
      parts.push(`<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="#f3f4f6"/>`);
      parts.push(
        `<text x="${PAD}" y="${(y + ROW_H / 2 + 4).toFixed(1)}" font-size="11" font-weight="700" fill="#111827">${esc(row.label.slice(0, 40))}</text>`
      );
      return;
    }
    const name = row.identifier ? `${row.identifier}  ${row.label}` : row.label;
    parts.push(
      `<text x="${PAD}" y="${(y + ROW_H / 2 + 4).toFixed(1)}" font-size="11" fill="#374151">${esc(name.slice(0, 38))}</text>`
    );
    if (!row.start || !row.end) return;
    const bx = x(row.start);
    const bw = Math.max(3, x(row.end) - bx);
    parts.push(
      `<rect x="${bx.toFixed(1)}" y="${(y + BAR_INSET).toFixed(1)}" width="${bw.toFixed(1)}" height="${ROW_H - BAR_INSET * 2}" rx="3" fill="${row.color ?? "#3b82f6"}" opacity="0.92"/>`
    );
    if (row.critical) {
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${(y + BAR_INSET).toFixed(1)}" width="${bw.toFixed(1)}" height="${ROW_H - BAR_INSET * 2}" rx="3" fill="none" stroke="#dc2626" stroke-width="1.2"/>`
      );
    }
  });

  parts.push("</svg>");
  return parts.join("");
};

/** RFC-4180 quoting: a field holding a comma, a quote or a newline is wrapped and
 *  its own quotes doubled. A task called `Test "cold soak", -20 C` would otherwise
 *  quietly become two columns in whatever opened the file. */
const cell = (value: string | undefined | null) => {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** One row per work item. Group headers are a column, not a row — a spreadsheet
 *  filters and pivots on a value far better than it reads an interleaved heading. */
export const buildGanttCsv = (rows: TExportRow[]): string => {
  const lines = ["Group,Key,Name,Start,End,Days,Assignee,State,Critical"];
  let band = "";
  for (const row of rows) {
    if (row.kind === "group") {
      band = row.label;
      continue;
    }
    const days = row.start && row.end ? Math.round((row.end.getTime() - row.start.getTime()) / DAY) + 1 : "";
    lines.push(
      [
        cell(band),
        cell(row.identifier),
        cell(row.label),
        row.start ? iso(row.start) : "",
        row.end ? iso(row.end) : "",
        String(days),
        cell(row.assignee),
        cell(row.state),
        row.critical ? "yes" : "",
      ].join(",")
    );
  }
  return lines.join("\n");
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadSvg = (svg: string, filename: string): void => {
  triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
};

export const downloadCsv = (csv: string, filename: string): void => {
  // The BOM is what makes Excel read it as UTF-8 rather than the system codepage,
  // which is the difference between "Mesure d'étanchéité" and mojibake.
  triggerDownload(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }), filename);
};

/**
 * The largest canvas dimension and area browsers will actually allocate. Beyond
 * either, `toBlob` hands back a blank image rather than failing — so a two-year
 * plan with three hundred rows would have downloaded a white rectangle and said
 * nothing. Chrome and Firefox differ; these are the conservative floors.
 */
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_AREA = 268_435_456; // 16384²

export class CanvasTooLargeError extends Error {
  constructor() {
    super("canvas too large");
    this.name = "CanvasTooLargeError";
  }
}

/** Rasterise via an off-screen canvas — browser-native, no dependency. */
export const downloadPng = (svg: string, filename: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const svgUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    image.addEventListener("load", () => {
      // Drop to 1x before giving up — a plan that will not fit at retina density
      // usually fits at one, and a slightly soft PNG beats no PNG.
      const fits = (factor: number) =>
        image.width * factor <= MAX_CANVAS_SIDE &&
        image.height * factor <= MAX_CANVAS_SIDE &&
        image.width * factor * image.height * factor <= MAX_CANVAS_AREA;
      const scale = fits(2) ? 2 : 1;
      if (!fits(scale)) {
        reject(new CanvasTooLargeError());
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no canvas context"));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, filename);
        resolve();
      }, "image/png");
    });
    image.addEventListener("error", () => reject(new Error("svg render failed")));
    image.src = svgUrl;
  });

/**
 * MS Project XML (the `http://schemas.microsoft.com/project` namespace Project has
 * read since 2003, and which Primavera, Smartsheet and GanttProject all import).
 *
 * Two things make it work rather than merely parse. Tasks need a contiguous 1..n
 * `UID` and a `PredecessorLink` referring to those UIDs, not to our own ids — so
 * the edges are remapped. And Project treats a task with no `Duration` as a
 * milestone, which is exactly right for a same-day item and exactly wrong if
 * emitted by accident, so the duration is always written.
 */
export const buildMsProjectXml = (rows: TExportRow[], edges: TExportEdge[], title: string): string => {
  const items = rows.filter((r) => r.kind === "item" && r.start && r.end);
  if (items.length === 0) return "";

  const uidById = new Map(items.map((row, index) => [row.id, index + 1] as const));
  // Project wants a full dateTime; the day itself is what we hold.
  const at = (d: Date, endOfDay = false) => `${iso(d)}T${endOfDay ? "17:00:00" : "08:00:00"}`;

  const predecessors = new Map<number, number[]>();
  for (const edge of edges) {
    const from = uidById.get(edge.from);
    const to = uidById.get(edge.to);
    if (!from || !to) continue;
    const list = predecessors.get(to);
    if (list) list.push(from);
    else predecessors.set(to, [from]);
  }

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    `<Name>${esc(title)}</Name>`,
    `<Title>${esc(title)}</Title>`,
    "<ScheduleFromStart>1</ScheduleFromStart>",
    `<StartDate>${at(items.reduce((a, b) => (a.start! < b.start! ? a : b)).start!)}</StartDate>`,
    "<CalendarUID>1</CalendarUID>",
    "<Tasks>",
  ];

  items.forEach((row, index) => {
    const uid = index + 1;
    // Inclusive day count, expressed the way Project reads it: PT<hours>H0M0S at
    // eight hours a day. Writing days directly is not part of the schema.
    const days = Math.max(1, Math.round((row.end!.getTime() - row.start!.getTime()) / DAY) + 1);
    parts.push(
      "<Task>",
      `<UID>${uid}</UID>`,
      `<ID>${uid}</ID>`,
      `<Name>${esc(row.identifier ? `${row.identifier} ${row.label}` : row.label)}</Name>`,
      "<Active>1</Active>",
      "<Type>1</Type>",
      "<OutlineLevel>1</OutlineLevel>",
      `<Start>${at(row.start!)}</Start>`,
      `<Finish>${at(row.end!, true)}</Finish>`,
      `<Duration>PT${days * 8}H0M0S</Duration>`,
      "<DurationFormat>7</DurationFormat>",
      `<Milestone>${days === 1 ? 1 : 0}</Milestone>`,
      `<PercentComplete>${row.state ? "" : ""}0</PercentComplete>`
    );
    for (const from of predecessors.get(uid) ?? []) {
      // Type 1 is finish-to-start, which is what every edge we draw means.
      parts.push(
        "<PredecessorLink>",
        `<PredecessorUID>${from}</PredecessorUID>`,
        "<Type>1</Type>",
        "</PredecessorLink>"
      );
    }
    parts.push("</Task>");
  });

  parts.push("</Tasks>", "</Project>");
  return parts.join("");
};

const stamp = (d: Date) => iso(d).replace(/-/g, "");
// RFC 5545 §3.3.11: backslash first, or it would escape the escapes added after
// it. A task named "Field trip; day 2, Praia" becomes two properties otherwise.
const escapeText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string): string => {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) chunks.push(" " + line.slice(i, i + 74));
  return chunks.join("\r\n");
};

/**
 * iCalendar. One all-day VEVENT per dated item, so a plan can be subscribed to or
 * dropped into a calendar without anybody re-typing it.
 *
 * DTEND is exclusive in RFC 5545 — a task finishing on the 20th ends on the 21st —
 * and getting that wrong is how every exported plan ends a day early. Lines are
 * folded at 75 octets because Outlook is strict about it where Google is not.
 */
export const buildIcs = (rows: TExportRow[], title: string): string => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Arribada//Timeline//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(title)}`,
  ];

  for (const row of rows) {
    if (row.kind !== "item" || !row.start || !row.end) continue;
    const exclusiveEnd = new Date(row.end.getTime() + DAY);
    lines.push(
      "BEGIN:VEVENT",
      // Stable per item, so re-importing updates the event instead of duplicating it.
      `UID:${row.id}@arribada`,
      `DTSTART;VALUE=DATE:${stamp(row.start)}`,
      `DTEND;VALUE=DATE:${stamp(exclusiveEnd)}`,
      `SUMMARY:${escapeText(row.identifier ? `${row.identifier} ${row.label}` : row.label)}`,
      row.assignee ? `DESCRIPTION:${escapeText(`Owner: ${row.assignee}`)}` : "DESCRIPTION:",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map((line) => fold(line)).join("\r\n");
};

export const downloadText = (text: string, filename: string, mime: string): void => {
  triggerDownload(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
};
