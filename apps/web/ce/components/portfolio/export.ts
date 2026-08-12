/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Export the portfolio: a self-contained image, or the board as a table.
 *
 * The image is rendered fresh rather than screenshotted — the on-screen gantt
 * virtualises its rows and scrolls horizontally, so most of it is not in the DOM
 * — and rasterised to PNG through a canvas. No deps.
 *
 * The table is the half that was missing, and the reason it was reported:
 * "je fais un export portfolio, tout est fermé, ça exporte juste la timeline du
 * projet". Every format here now reads the board's OWN row list — the folder
 * swimlanes, the sort, the expanded projects, the filters — so a collapsed
 * project is a collapsed project in the file, and an expanded one brings its
 * work items with it. What the arrangement was, and what it left out, is written
 * into the file rather than left for the reader to deduce.
 */
import {
  buildGanttSvg,
  cell,
  downloadCsv as downloadCsvFile,
  downloadXlsx as downloadXlsxFile,
  provenance,
  workingDays,
  type TExportLegendEntry,
  type TExportMeta,
  type TExportRow,
} from "@/plane-web/components/gantt-chart/export";
import type { TSheet } from "@/plane-web/components/gantt-chart/xlsx";
import type { TPortfolioItem, TPortfolioProject } from "@/plane-web/types/arribada";

/**
 * A day, read as UTC midnight.
 *
 * It used to be `T00:00:00` — LOCAL midnight — and everything that formats a day
 * back out reads UTC: the SVG's own date range caption via `toISOString()`, and
 * the workbook's Excel serial. East of Greenwich that combination printed the
 * day before the one on the bar. The bars themselves are positioned by
 * subtraction and never noticed, which is why it survived this long.
 */
const parse = (s: string | null): Date | null => (s ? new Date(s + "T00:00:00Z") : null);

/**
 * The board as a picture.
 *
 * Deliberately a MAPPER onto `buildGanttSvg` rather than a second renderer. The
 * two used to be separate code that drew the same kind of thing differently —
 * the portfolio's had no today line, no legend, no baseline, no arrowheads and no
 * generated-on stamp, and every improvement to one silently left the other
 * behind. One renderer means the funder's copy of the portfolio and the funder's
 * copy of a project timeline are the same document, and a fix lands in both.
 *
 * What is portfolio-specific is here and only here: which dates a project bar
 * takes, what "drift" means for a project, and the fact that a project's
 * done-ness is "every one of its work items is finished".
 */
export const buildPortfolioSvg = (
  projects: TPortfolioProject[],
  title = "Portfolio timeline",
  options: {
    /** How the board is banded and coloured, so the picture says so. */
    meta?: Partial<TExportMeta>;
    legend?: TExportLegendEntry[];
    /** The colour each project bar is wearing on screen. Absent for a project
     *  means "use the drift colours", which is what this drew before anything
     *  could be coloured by anything. */
    colorOf?: (projectId: string) => string | undefined;
    /** Which projects the board is drawing as finished. */
    doneOf?: (projectId: string) => boolean;
    today?: Date;
  } = {}
): string | null => {
  const rows: TExportRow[] = [];
  for (const p of projects) {
    const start = parse(p.start_date) ?? parse(p.derived_start_date);
    const end = parse(p.target_date) ?? parse(p.derived_target_date);
    if (!start || !end) continue;
    // "Drift" on a project: the work underneath already runs past the date that
    // was promised. It is the one thing a portfolio reader is looking for, so it
    // survives whatever the board is coloured by — as a red outline, which is a
    // MARK on top of the bar rather than a hue competing with the series.
    const drift = !!(p.target_date && p.derived_target_date && parse(p.derived_target_date)! > parse(p.target_date)!);
    // The dates were inferred rather than planned — the hatched bar on screen.
    const derived = !p.start_date && !p.target_date;
    rows.push({
      id: p.id,
      kind: "item",
      label: p.name,
      identifier: p.identifier,
      start,
      end: end < start ? start : end,
      color: options.colorOf?.(p.id) ?? (drift ? "#ef4444" : "#3b82f6"),
      critical: drift,
      done: options.doneOf?.(p.id) || undefined,
      progress: p.item_count ? Math.round(((p.completed_item_count ?? 0) / p.item_count) * 100) : undefined,
      // A project's frozen promise is a single date, not a window: the baseline
      // ghost therefore runs from the live start to the promised end, which is
      // exactly the comparison "has the end moved?".
      baselineStart: p.baseline_target_date ? start : null,
      baselineEnd: parse(p.baseline_target_date),
      state: derived ? "dates inferred from the work items" : undefined,
    });
  }
  if (rows.length === 0) return null;

  const meta: TExportMeta = {
    title,
    scope: "view",
    ...options.meta,
    omissions: [
      ...(options.meta?.omissions ?? []),
      // Named rather than left for a reader to notice missing. A project with no
      // dates at either end has no bar to draw and is not in this picture.
      ...(projects.length > rows.length
        ? [`${projects.length - rows.length} project${projects.length - rows.length === 1 ? "" : "s"} with no dates`]
        : []),
    ],
  };

  return buildGanttSvg(rows, [], {
    title,
    showWeekends: false, // a portfolio spans years; weekend stripes are noise at that scale
    legend: options.legend,
    meta,
    today: options.today,
  });
};

/* ---------------------------------------------------------------- table --- */

/**
 * What the table builders need from the board, as a shape rather than as the
 * store class. Keeps this module free of a MobX import and — more usefully —
 * means a test can hand it four plain objects instead of standing up a store.
 */
export type TPortfolioSource = {
  /** The board's own flat row list: folder headers, projects, and the work items
   *  of whichever projects are expanded, in the order the chart draws them. */
  ganttBlockIds: string[];
  /** Every project in scope, in the same sort, ignoring what is expanded. */
  sortedProjectIds: string[];
  isFolderRow: (id: string) => boolean;
  isProjectRow: (id: string) => boolean;
  getFolderRow: (id: string) => { name: string; projectCount: number; collapsed: boolean } | undefined;
  /** Bands INSIDE a project — sprint, module, discipline. Optional so this stays
   *  callable from a test with four objects, and skipped when walking the rows:
   *  the value each band stands for is already a column, so the header row would
   *  only be a duplicate with no dates. */
  isSubgroupRow?: (id: string) => boolean;
  getProject: (id: string) => TPortfolioProject | undefined;
  getItem: (id: string) => TPortfolioItem | undefined;
  getRowProjectId: (id: string) => string | undefined;
  isCriticalIssue: (id: string) => boolean;
  colorBy: string;
  sortBy: string;
  /** How the project rows are banded. `groupByFolder` is the older switch and is
   *  read only when `groupBy` is absent. */
  groupBy?: string;
  subgroupBy?: string;
  groupByFolder: boolean;
  expandedProjectIds: Set<string>;
  priorityFilter: Set<string>;
  assignedToMeOnly: boolean;
  focusFolderName: string | null;
};

/**
 * One row of the board, flattened.
 *
 * `kind` keeps the project summary and its work items apart, because on a
 * portfolio they are genuinely different things and a sheet that blurred them
 * would double-count every total somebody tried to take.
 */
export type TPortfolioRow = {
  folder: string;
  kind: "Project" | "Work item";
  project: string;
  key: string;
  name: string;
  owners: string;
  priority: string;
  /** The three the board bands and colours by, so the sheet can be pivoted the
   *  same way the screen is arranged. Empty on a project summary row. */
  sprint: string;
  module: string;
  disciplines: string;
  start: Date | null;
  end: Date | null;
  /** Whether the dates were planned or inferred from the work items underneath —
   *  the same distinction the chart draws as a hatched bar. */
  datesFrom: "planned" | "derived from work items" | "";
  /** True when the work underneath already runs past the promised end date. */
  slipping: boolean;
  critical: boolean;
  itemCount: number | null;
  doneCount: number | null;
  undatedCount: number | null;
};

const parseDay = (value: string | null | undefined): Date | null => (value ? parse(value) : null);

export type TPortfolioScope = "view" | "all";

/**
 * The board as rows.
 *
 * "view" walks `ganttBlockIds`, which IS what the chart draws — so a collapsed
 * project contributes its own summary row and no work items, exactly as on
 * screen. "all" walks every project in scope instead, and still cannot invent
 * the work items of a project nobody has expanded: those rows have never been
 * fetched. That gap is reported by `collapsedProjects` rather than papered over.
 */
export const portfolioRows = (
  source: TPortfolioSource,
  scope: TPortfolioScope
): { rows: TPortfolioRow[]; collapsedProjects: string[] } => {
  const rows: TPortfolioRow[] = [];
  const collapsedProjects: string[] = [];
  let folder = "";

  const pushProject = (id: string) => {
    const project = source.getProject(id);
    if (!project) return;
    const planned = !!(project.start_date || project.target_date);
    const start = parseDay(project.start_date) ?? parseDay(project.derived_start_date);
    const end = parseDay(project.target_date) ?? parseDay(project.derived_target_date);
    const promised = parseDay(project.target_date);
    const actual = parseDay(project.derived_target_date);
    rows.push({
      folder,
      kind: "Project",
      project: project.name,
      key: project.identifier,
      name: project.name,
      owners: "",
      priority: "",
      sprint: "",
      module: "",
      disciplines: "",
      start,
      end: end && start && end < start ? start : end,
      datesFrom: start || end ? (planned ? "planned" : "derived from work items") : "",
      slipping: !!(promised && actual && actual > promised),
      critical: false,
      itemCount: project.item_count,
      doneCount: project.completed_item_count ?? 0,
      undatedCount: project.undated_item_count,
    });
    if (!source.expandedProjectIds.has(id)) collapsedProjects.push(project.name);
  };

  const pushItem = (id: string) => {
    const item = source.getItem(id);
    if (!item) return;
    const owner = source.getRowProjectId(id);
    const project = owner ? source.getProject(owner) : undefined;
    rows.push({
      folder,
      kind: "Work item",
      project: project?.name ?? "",
      key: project?.identifier ? `${project.identifier}-${item.sequence_id}` : String(item.sequence_id),
      name: item.name,
      owners: item.assignees.map((a) => a.name).join(", "),
      priority: item.priority,
      sprint: item.cycle?.name ?? "",
      module: item.module?.name ?? "",
      disciplines: (item.disciplines ?? []).join(", "),
      start: parseDay(item.start_date),
      end: parseDay(item.target_date),
      datesFrom: "",
      slipping: false,
      critical: source.isCriticalIssue(id),
      itemCount: null,
      doneCount: null,
      undatedCount: null,
    });
  };

  if (scope === "all") {
    for (const id of source.sortedProjectIds) pushProject(id);
    return { rows, collapsedProjects };
  }

  for (const id of source.ganttBlockIds) {
    if (source.isFolderRow(id)) {
      folder = source.getFolderRow(id)?.name ?? "";
      continue;
    }
    if (source.isSubgroupRow?.(id)) continue;
    if (source.isProjectRow(id)) pushProject(id);
    else pushItem(id);
  }
  return { rows, collapsedProjects };
};

/** The board's arrangement, in the words the toolbar uses for it. */
export const portfolioMeta = (
  source: TPortfolioSource,
  scope: TPortfolioScope,
  collapsedProjects: string[]
): TExportMeta => {
  const filters: string[] = [];
  if (source.priorityFilter.size)
    filters.push(`priority in ${[...source.priorityFilter].join(", ")} (work items only)`);
  if (source.assignedToMeOnly) filters.push("assigned to me (work items only)");
  if (source.focusFolderName) filters.push(`folder "${source.focusFolderName}"`);

  const omissions = [
    "each work item's state and recorded effort, which the portfolio does not load",
    "float — that is computed per project, on a project's own timeline",
  ];
  if (collapsedProjects.length)
    omissions.push(
      `the work items of ${collapsedProjects.length} collapsed project${collapsedProjects.length === 1 ? "" : "s"} (${collapsedProjects.slice(0, 6).join(", ")}${collapsedProjects.length > 6 ? ", …" : ""}) — expand a project to load them`
    );

  const bands = [
    source.groupBy && source.groupBy !== "project" ? source.groupBy : source.groupByFolder ? "folder" : "",
    source.subgroupBy && source.subgroupBy !== "none" ? `${source.subgroupBy} within each project` : "",
  ].filter(Boolean);

  return {
    title: source.focusFolderName ? `Portfolio — ${source.focusFolderName}` : "Portfolio",
    scope: scope === "all" ? "all" : "view",
    groupBy: bands.length ? bands.join(", then ") : undefined,
    sortBy: source.sortBy,
    colorBy: source.colorBy,
    collapsed: collapsedProjects.length,
    filters,
    omissions,
    // A portfolio row is a project OR a work item, so the provenance line must
    // not call all of them work items.
    rowNoun: "row",
    collapsedNoun: "project",
  };
};

const PORTFOLIO_COLUMNS = [
  "Folder",
  "Row",
  "Project",
  "Key",
  "Name",
  "Owners",
  "Discipline",
  "Sprint",
  "Module",
  "Priority",
  "Start",
  "End",
  "Working days",
  "Dates from",
  "Running late",
  "On critical path",
  "Work items",
  "Completed",
  "Without dates",
];

const PORTFOLIO_WIDTHS = [22, 11, 24, 12, 46, 24, 18, 16, 18, 10, 11, 11, 13, 22, 12, 16, 11, 11, 13];

/**
 * A stored plan day, printed. `parse` above built it as UTC midnight, so reading
 * it back as UTC is the round trip and must stay exactly as it is.
 *
 * The same expression over `new Date()` would be a bug rather than a round trip —
 * an instant has no stored day to recover, and reading one back as UTC answers in
 * Greenwich's calendar instead of the reader's. There is no such call in this
 * module: the only "now" the portfolio stamps is the toolbar's filename and the
 * provenance line, and both go through `todayIso` in the gantt exporter. Keep it
 * that way; do not "simplify" this into a local-day helper, which would move the
 * printed dates off the bars for everybody east of Greenwich.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);

const tableRows = (rows: TPortfolioRow[], typed: boolean): (string | number | Date | null)[][] =>
  rows.map((row) => [
    row.folder,
    row.kind,
    row.project,
    row.key,
    // Work items sit under their project, indented, so a flat list still reads
    // as the board did. Two spaces, never a tab — a tab leads a CSV field.
    row.kind === "Work item" ? `  ${row.name}` : row.name,
    row.owners,
    row.disciplines,
    row.sprint,
    row.module,
    row.priority,
    typed ? row.start : row.start ? iso(row.start) : "",
    typed ? row.end : row.end ? iso(row.end) : "",
    row.start && row.end ? (typed ? workingDays(row.start, row.end) : String(workingDays(row.start, row.end))) : "",
    row.datesFrom,
    row.slipping ? "yes" : "",
    row.critical ? "yes" : "",
    typed ? row.itemCount : (row.itemCount?.toString() ?? ""),
    typed ? row.doneCount : (row.doneCount?.toString() ?? ""),
    typed ? row.undatedCount : (row.undatedCount?.toString() ?? ""),
  ]);

export const buildPortfolioCsv = (rows: TPortfolioRow[], meta: TExportMeta): string => {
  const lines = provenance(meta, rows.length);
  lines.push(PORTFOLIO_COLUMNS.join(","));
  for (const row of tableRows(rows, false))
    lines.push(row.map((value) => cell(value === null ? "" : String(value))).join(","));
  return lines.join("\n");
};

export const buildPortfolioWorkbook = (rows: TPortfolioRow[], meta: TExportMeta): TSheet[] => {
  const notes = provenance(meta, rows.length).map((line) => line.replace(/^# ?/, ""));
  return [
    {
      name: "Portfolio",
      headerRow: true,
      widths: PORTFOLIO_WIDTHS,
      notes: notes.slice(0, 2),
      rows: [PORTFOLIO_COLUMNS, ...tableRows(rows, true)],
    },
    { name: "About this export", rows: notes.map((line) => [line]) },
  ];
};

export const downloadPortfolioCsv = downloadCsvFile;
export const downloadPortfolioWorkbook = downloadXlsxFile;

/* --------------------------------------------------------------- picture --- */

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
    // `onload`/`onerror` rather than `addEventListener`: this image is created,
    // used once and dropped, and the assignment form is what guarantees exactly
    // one handler — a second `addEventListener` on a retry would fire the first
    // one again and resolve the promise twice.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- see above
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
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- as above
    img.onerror = () => reject(new Error("svg render failed"));
    img.src = svgUrl;
  });
