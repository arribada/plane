/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Export the work-item timeline. Two families, and they answer two questions.
 *
 * **Pictures** — SVG, PNG, and the MS Project / iCalendar handovers. Drawn fresh
 * from the data rather than captured from the screen: the on-screen chart
 * virtualises its rows and scrolls sideways, so most of it is not in the DOM at
 * any moment and a screenshot would be a screenshot of the visible tenth.
 * Rendering again means the export is the whole plan at a width that suits paper,
 * and it carries what the screen carries: the bands, the dependency arrows, the
 * critical chain and the weekends.
 *
 * **Tables** — CSV and a real .xlsx (see `xlsx.ts`). One row per work item with
 * its key, name, project, sprint, modules, parent, owners, dates, working days
 * and float. A funder reconciles rows; a picture pasted into a cell is not a
 * document anybody can work with.
 *
 * Both families take the SAME row list, and that list is what the chart is
 * drawing — same order, same bands, same folds — so the file and the screen can
 * never describe different plans. What was excluded travels with the file rather
 * than being left for somebody to discover: see `TExportMeta` and `provenance`.
 */

import { isoDay } from "../workload/scale";
import { routeDependency } from "./dependency/routing";
import { isNonWorking, weekdaysBetween } from "./working-days";
import { buildXlsx, XLSX_MIME, type TSheet } from "./xlsx";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A date carries a DAY here, and the callers build it as UTC midnight — see
 * `parsed` in base-gantt-root.tsx, where `new Date("2026-08-03")` is the UTC
 * midnight JS gives a bare ISO date, and `parse` in portfolio/export.ts, which
 * spells the `T00:00:00Z` out. Read it back the same way or every export west of
 * Greenwich is a day early.
 *
 * That is CORRECT for a STORED PLAN DATE and must not change. It is wrong for
 * `new Date()`, which is a genuine instant rather than a day somebody wrote down:
 * read back as UTC it answers in Greenwich's calendar, not the reader's. Use
 * `todayIso` below for that. The two calls look identical and mean opposite
 * things, which is how a PDF stamped "prepared 13 Aug" shipped beside a
 * spreadsheet named for the 12th.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The integer epoch day a plan date names, which is the only footing on which a
 * weekday question has a single answer — see the header of `working-days.ts`.
 *
 * Exact for the UTC-midnight instants this module is handed. For anything else it
 * floors to the same UTC day `iso` above prints, so the "Working days" column can
 * never disagree with the Start and End columns beside it.
 *
 * NOT `localEpochDay` from working-days.ts, which is its counterpart for the
 * chart's own `Date`s: upstream's `views/helpers.ts` builds those with
 * `new Date(y, m, d)` — LOCAL midnight — and reading a local-midnight Date as UTC
 * (or a UTC-midnight one as local) is the whole bug this file had. Pick by how
 * the Date was BUILT, and the exporters' are built as UTC.
 */
const epochDayOf = (d: Date): number => Math.floor(d.getTime() / DAY);

/**
 * Today, in the READER's calendar. Deliberately NOT `iso(new Date())`.
 *
 * An instant read back as UTC is Greenwich's day: at UTC+12 the entire local
 * morning stamps yesterday, and west of Greenwich the local evening stamps
 * tomorrow. `isoDay` is the workload timeline's helper, imported rather than
 * copied so the app has ONE answer to "what day is it where the reader is".
 */
export const todayIso = (): string => isoDay(new Date());

/**
 * Today as a plain day, in the same UTC-midnight representation every row uses.
 *
 * The drawn chart needs today on exactly that footing: it is compared against the
 * range and positioned by subtraction from `min`, both of which are UTC
 * midnights. Passing the raw instant in put the "Today" line up to a day off its
 * own column as well as mis-stamping the caption.
 */
export const todayAsDay = (): Date => new Date(`${todayIso()}T00:00:00Z`);

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
  /**
   * Whether this item was MARKED a deliverable. Undefined means nobody has said,
   * and the exporters fall back to the one-day guess — which is how every one-day
   * bench test used to reach MS Project stamped as a Project milestone.
   */
  milestone?: boolean;

  /**
   * Everything below is for the spreadsheet formats only; the drawn ones ignore
   * it. A picture of a plan answers "when"; a sheet has to answer "whose", "in
   * which sprint" and "how much room does it have", or the reader goes back to
   * the app to find out and the file was pointless.
   */
  project?: string;
  /** Cycle, which this fork calls a sprint everywhere the reader can see. */
  sprint?: string;
  modules?: string;
  parent?: string;
  /** Every assignee, not just the first — `assignee` above stays the first. */
  assignees?: string;
  priority?: string;
  labels?: string;
  /** Working days this can slip before anything else has to move. The same
   *  number `slack` below carries for the DRAWN tail — one field per family
   *  because the two are filled by different callers, so fill both from
   *  `useProjectSlack`'s `free` and they cannot drift. */
  freeFloat?: number;
  /** Working days it can slip before the project's own end date moves. Zero
   *  means it is on the critical path, which is what `critical` restates. */
  totalFloat?: number;
  /** Sub-task nesting depth, 0 for a top-level item. */
  depth?: number;

  /**
   * Everything below is for the DRAWN formats, and each of it is something the
   * screen shows that the picture used to drop on the floor. An export that
   * silently omits what the reader was looking at is the defect, not a
   * simplification: they pressed the button while looking at the hatched bars
   * and the red chain, and got a flat blue chart with neither.
   */
  /** Finished: drawn hatched with a tick, never a different colour. */
  done?: boolean;
  /** Cancelled: drawn hollow and struck, with a ✕. Its own flag rather than a
   *  second reading of `done`, because the picture leaving the building must not
   *  put a tick on work that was abandoned. */
  cancelled?: boolean;
  /** 0–100. The share of this item's children that are finished, as the bar's
   *  own progress fill — the same number the screen draws inside the bar. */
  progress?: number;
  /** The frozen plan this row was promised against, drawn as a ghost outline
   *  under the live bar. Absent when no baseline is on screen. */
  baselineStart?: Date | null;
  baselineEnd?: Date | null;
  /** Which legend entry this row reads under. Carried so the drawn legend and
   *  the bars cannot disagree, and so the spreadsheet can name the colour rule
   *  it was exported with. */
  seriesLabel?: string;
  /** Working days of room past the bar's end, drawn as a slack tail. */
  slack?: number;
};

export type TExportEdge = { from: string; to: string; critical?: boolean };

/** One row of the drawn legend. Same shape the on-screen legend takes, because
 *  the caller hands both the same list. */
export type TExportLegendEntry = { label: string; color: string; count?: number };

/**
 * What the file is a file OF.
 *
 * The complaint this exists for: "je fais un export portfolio, tout est fermé,
 * ça exporte juste la timeline du projet". The export was a second query that
 * happened to resemble the chart — it ignored which bands were folded, which
 * projects were expanded, the sort, the colour rule and the filters — so the
 * artefact and the screen it was taken from disagreed, and only one of them was
 * in front of the person who pressed the button.
 *
 * So the rows now come from what is drawn, and this block records the settings
 * that produced them. It is written into the file, because a plan that leaves
 * the building without saying what it excluded is the one that gets argued over.
 */
export type TExportMeta = {
  title: string;
  /** "view" = the chart as configured. "all" = the reader asked for everything. */
  scope: "view" | "all";
  /** Human labels, exactly as the toolbar spells them. */
  groupBy?: string;
  colorBy?: string;
  sortBy?: string;
  /** Bands or projects folded shut, and therefore not contributing rows. */
  collapsed?: number;
  /** Filters in force, phrased as the toolbar phrases them. */
  filters?: string[];
  /** Named, not silent — the convention `budget-export.ts` set. */
  omissions?: string[];
  /** The name of the frozen plan the ghosts are drawn against, when one was on
   *  screen. Absent means no baseline was shown — which is not the same as "this
   *  project has never been baselined", and the drawn caption says so. */
  baselineName?: string;
  /** What one row IS, singular. Defaults to "work item"; the portfolio's rows are
   *  a mix of projects and work items, so it passes "row". */
  rowNoun?: string;
  /** What one folded thing is, singular. Defaults to "group"; the portfolio folds
   *  projects, not bands. */
  collapsedNoun?: string;
};

/**
 * Mon–Fri days in an inclusive range. The gantt, the scheduler and the budget all
 * count working days; a spreadsheet that only reported calendar days would
 * disagree with every other number in the system.
 *
 * Handed to `working-days.ts` rather than reimplemented here. The version this
 * replaces opened with `const first = start.getDay()` — the LOCAL weekday of a
 * UTC-anchored Date. West of Greenwich a UTC-midnight Monday is Sunday evening
 * locally, so the week was read as starting a day early and every Mon–Fri span
 * came back as 4. That is the "Working days" column of every spreadsheet a funder
 * receives, and of the portfolio table, which counts through this same function.
 *
 * `weekdaysBetween` takes integer epoch days, so the question cannot be asked in
 * a timezone at all — and it is the same closed form the backend's
 * `weekdays_between` uses, so the two halves cannot drift. It already answers 0
 * for a reversed range, which is why the old guard is gone rather than moved: on
 * Dates that guard compared instants, and on epoch days it compares days.
 */
export const workingDays = (start: Date, end: Date): number => weekdaysBetween(epochDayOf(start), epochDayOf(end));

/**
 * The provenance block, shared by the CSV (as `#` comments) and the workbook (as
 * grey rows above the table). One source so the two files can never describe the
 * same export differently.
 */
export const provenance = (meta: TExportMeta, rowCount: number): string[] => {
  // The portfolio's rows are projects AND work items, so calling them all work
  // items in the first line the reader sees would be wrong by half.
  const noun = meta.rowNoun ?? "work item";
  const folded = meta.collapsedNoun ?? "group";
  const lines = [`# ${meta.title} — timeline`];
  lines.push(
    meta.scope === "view"
      ? `# ${rowCount} ${noun}${rowCount === 1 ? "" : "s"}, exactly as the timeline was set up on screen.`
      : `# ${rowCount} ${noun}${rowCount === 1 ? "" : "s"} — everything on the timeline, ignoring what was folded or filtered.`
  );

  const settings: string[] = [];
  if (meta.groupBy) settings.push(`grouped by ${meta.groupBy}`);
  if (meta.sortBy) settings.push(`ordered by ${meta.sortBy}`);
  if (meta.colorBy) settings.push(`coloured by ${meta.colorBy}`);
  if (settings.length) lines.push(`# View: ${settings.join(", ")}.`);

  if (meta.scope === "view" && meta.collapsed)
    lines.push(
      `# ${meta.collapsed} collapsed ${folded}${meta.collapsed === 1 ? " is" : "s are"} folded shut, so ${meta.collapsed === 1 ? "its" : "their"} work items are not below. Export again with "Everything" to include them.`
    );
  if (meta.scope === "view" && meta.filters?.length)
    lines.push(`# Filtered: ${meta.filters.join("; ")}. Rows excluded by a filter are not below.`);
  if (meta.omissions?.length) lines.push(`# Not in this file: ${meta.omissions.join("; ")}.`);
  // `todayIso()`, not `iso(new Date())`: this line is the date the READER did the
  // export, so it has to be their calendar day. It also has to agree with the day
  // the toolbar puts in the filename — the two are read side by side, and they
  // disagreed for anybody far enough from Greenwich.
  lines.push(`# Exported ${todayIso()}.`);
  return lines;
};

/** How Plane's filter properties are spelled on screen. `cycle` is its field
 *  name; this fork calls one a sprint everywhere a reader can see it. */
const FILTER_LABEL: Record<string, string> = {
  priority: "priority",
  state_id: "state",
  state_group: "state group",
  assignee_id: "assignee",
  mention_id: "mention",
  created_by_id: "created by",
  subscriber_id: "subscriber",
  label_id: "label",
  cycle_id: "sprint",
  module_id: "module",
  project_id: "project",
  start_date: "start date",
  target_date: "due date",
  created_at: "created",
  updated_at: "updated",
};

const conditionCount = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return value ? value.split(",").length : 0;
  return value === undefined || value === null ? 0 : 1;
};

/**
 * The filters in force, as phrases the file can carry.
 *
 * Reads Plane's rich-filter expression: either a flat map of
 * `property__operator` conditions, or `{ and: [ … ] }` holding several. Values
 * are ids, so only the COUNT is reported — "3 states" is what tells a reader the
 * file is a subset at all, where a list of uuids tells them nothing. Silence
 * about a filter is how an export ends up looking like the whole project.
 */
export const describeFilters = (expression: Record<string, unknown> | null | undefined): string[] => {
  if (!expression) return [];
  const conditions: Record<string, unknown>[] = [];
  const group = (expression as { and?: unknown }).and;
  if (Array.isArray(group)) conditions.push(...(group as Record<string, unknown>[]));
  else conditions.push(expression);

  const perProperty = new Map<string, number>();
  for (const condition of conditions) {
    for (const [key, value] of Object.entries(condition ?? {})) {
      const count = conditionCount(value);
      if (count === 0) continue;
      // `state_id__in` -> `state_id`. The operator is not worth printing: what a
      // reader needs to know is that the column was narrowed at all.
      const property = key.split("__")[0];
      perProperty.set(property, (perProperty.get(property) ?? 0) + count);
    }
  }

  return [...perProperty].map(([property, count]) => {
    const label = FILTER_LABEL[property] ?? property.replace(/_id$/, "").replace(/_/g, " ");
    return count === 1 ? `1 ${label} selected` : `${count} ${label}s selected`;
  });
};

/** The one column set both spreadsheet formats use, so a reader who has learned
 *  one has learned the other. */
const SHEET_COLUMNS = [
  "Group",
  "Key",
  "Name",
  "Project",
  "Sprint",
  "Modules",
  "Parent",
  "Assignees",
  "Priority",
  "State",
  "Start",
  "End",
  "Working days",
  "Calendar days",
  "Free float (days)",
  "Total float (days)",
  "On critical path",
  "Milestone",
  "Labels",
];

/** Widths in characters, in column order. Name and Project earn theirs. */
const SHEET_WIDTHS = [18, 11, 46, 20, 16, 20, 26, 22, 10, 14, 11, 11, 13, 14, 16, 17, 16, 10, 22];

type TSheetRow = (string | number | Date | null)[];

/** One row per work item, in the order the chart draws them. Group headers
 *  become a COLUMN rather than a row: a spreadsheet filters and pivots on a
 *  value far better than it reads an interleaved heading. */
const sheetRows = (rows: TExportRow[], typed: boolean): TSheetRow[] => {
  const out: TSheetRow[] = [];
  let band = "";
  for (const row of rows) {
    if (row.kind === "group") {
      band = row.label;
      continue;
    }
    const calendar = row.start && row.end ? Math.round((row.end.getTime() - row.start.getTime()) / DAY) + 1 : null;
    const working = row.start && row.end ? workingDays(row.start, row.end) : null;
    // Indented by nesting depth so a sub-task reads as one in a flat list. Two
    // spaces, not a tab: a tab leads a CSV field and would be neutralised.
    const indent = row.depth ? "  ".repeat(row.depth) : "";
    out.push([
      band,
      row.identifier ?? "",
      indent + row.label,
      row.project ?? "",
      row.sprint ?? "",
      row.modules ?? "",
      row.parent ?? "",
      row.assignees ?? row.assignee ?? "",
      row.priority ?? "",
      row.state ?? "",
      typed ? (row.start ?? null) : row.start ? iso(row.start) : "",
      typed ? (row.end ?? null) : row.end ? iso(row.end) : "",
      typed ? working : working === null ? "" : String(working),
      typed ? calendar : calendar === null ? "" : String(calendar),
      typed ? (row.freeFloat ?? null) : row.freeFloat === undefined ? "" : String(row.freeFloat),
      typed ? (row.totalFloat ?? null) : row.totalFloat === undefined ? "" : String(row.totalFloat),
      row.critical ? "yes" : "",
      row.milestone ? "yes" : "",
      row.labels ?? "",
    ]);
  }
  return out;
};

const LABEL_W = 260;
const ROW_H = 26;
const HEAD_H = 64;
const PAD = 20;
const BAR_INSET = 6;
/** One legend row's height, and the block of them under the chart. */
const LEGEND_ROW_H = 16;
const CAPTION_H = 14;

/** How wide a proportional 11px string is, near enough to lay a legend out with.
 *  SVG has no text metrics without a DOM, and asking for one here would make the
 *  exporter untestable and browser-only for the sake of a few pixels. */
const textWidth = (text: string, size = 11) => text.length * size * 0.55;

/**
 * The header block, as its own lines, so a reader who was not in the room can
 * reconstruct the view without asking anybody.
 *
 * This is the substance of the report — the picture used to carry a title and a
 * date range and nothing else, so an export taken from a board grouped by module,
 * coloured by assignee, filtered to two priorities and compared against a frozen
 * plan arrived as an anonymous row of blue bars.
 */
export const svgCaptions = (meta: TExportMeta, rowCount: number, itemCount: number): string[] => {
  const lines: string[] = [];
  const view: string[] = [];
  if (meta.groupBy) view.push(`grouped by ${meta.groupBy}`);
  if (meta.sortBy) view.push(`ordered by ${meta.sortBy}`);
  if (meta.colorBy) view.push(`coloured by ${meta.colorBy}`);
  lines.push(
    `${itemCount} work item${itemCount === 1 ? "" : "s"}${view.length ? ` · ${view.join(" · ")}` : ""}${
      meta.scope === "all" ? " · everything, ignoring what was folded" : ""
    }`
  );
  if (meta.baselineName) lines.push(`Compared against the baseline “${meta.baselineName}” — drawn as hollow outlines.`);
  const caveats: string[] = [];
  if (meta.scope === "view" && meta.collapsed)
    caveats.push(`${meta.collapsed} folded ${meta.collapsed === 1 ? "group is" : "groups are"} not drawn below`);
  if (meta.scope === "view" && meta.filters?.length) caveats.push(`filtered: ${meta.filters.join("; ")}`);
  if (meta.omissions?.length) caveats.push(`not in this picture: ${meta.omissions.join("; ")}`);
  if (caveats.length) lines.push(caveats.join(" · "));
  // Void the row count claim if it disagrees with what was drawn — a caption that
  // says 40 over a picture of 12 bars is worse than no caption.
  if (rowCount !== itemCount && meta.scope === "view") lines.push(`${rowCount} rows drawn, including band headers.`);
  return lines;
};

/**
 * The SVG. Returns null when nothing on the chart is dated — an image of an empty
 * calendar is not a useful file to have handed someone.
 *
 * ---------------------------------------------------------------------------
 * What this draws that it did not
 * ---------------------------------------------------------------------------
 *
 * The reported defect was that an export "silently omits what the user is looking
 * at". Every one of these was on screen and absent from the file:
 *
 *   the colour rule       bars were painted the state colour whatever the chart
 *                         was coloured by, and nothing said which rule was used
 *   the legend            so the colours meant nothing to a recipient
 *   today                 a plan with no "now" line cannot be read as late
 *   done-ness             hatched on screen, flat in the file
 *   milestones            drawn as a diamond on screen, a 3px sliver in the file
 *   the baseline          ghosted on screen, absent from the file
 *   arrowheads            the dependency lines had no direction
 *   progress              the part-done fill inside a bar
 *   slack                 the tail showing how much room a task has
 *   provenance            no grouping, no filters, no "generated on"
 */
export const buildGanttSvg = (
  rows: TExportRow[],
  edges: TExportEdge[],
  options: {
    title: string;
    showWeekends?: boolean;
    /** The series swatches. Same list the on-screen legend was handed, so the
     *  file and the screen cannot disagree about what teal means. */
    legend?: TExportLegendEntry[];
    /** Everything the header block says. Optional so the older two-argument call
     *  still produces a picture rather than throwing. */
    meta?: TExportMeta;
    /** Overridable so a test is not dated. */
    today?: Date;
  } = { title: "Timeline" }
): string | null => {
  const dated = rows.filter((r) => r.start && r.end);
  if (dated.length === 0) return null;

  // A plain day, like every other date in this renderer — `iso(today)` prints it
  // and `x(today)` positions it against a UTC-midnight `min`, so an instant here
  // was wrong twice: it stamped Greenwich's day on the caption and drew the line
  // a fraction of a column (or, past the date line, a whole day) off. A test that
  // injects `today` is already passing a UTC-midnight day and keeps working.
  const today = options.today ?? todayAsDay();
  const meta = options.meta;
  const legend = options.legend ?? [];
  const itemCount = rows.filter((r) => r.kind === "item").length;
  const captions = meta ? svgCaptions(meta, rows.length, itemCount) : [];

  const min = new Date(Math.min(...dated.map((r) => r.start!.getTime())));
  const max = new Date(Math.max(...dated.map((r) => r.end!.getTime())));
  // Baseline ghosts can reach outside the live plan — that IS the comparison, and
  // a ghost clipped off the edge is the one worth seeing.
  for (const row of rows) {
    if (row.baselineStart && row.baselineStart < min) min.setTime(row.baselineStart.getTime());
    if (row.baselineEnd && row.baselineEnd > max) max.setTime(row.baselineEnd.getTime());
  }
  // Two days of air at each end, stepped on the epoch day rather than through
  // `setDate`, which reads and writes the LOCAL date: on the two days a year a
  // clock changes it preserves the wall clock and moves the instant by an hour,
  // so the padded edge stopped being UTC midnight and every column measured from
  // it inherited the drift. Doing it here also guarantees `span` is a whole
  // number, which the day grid below and `x()` both assume.
  min.setTime((epochDayOf(min) - 2) * DAY);
  max.setTime((epochDayOf(max) + 2) * DAY);
  const span = Math.max(1, (max.getTime() - min.getTime()) / DAY);

  // Wide enough to read a day, capped so a two-year plan is still one page.
  const TIME_W = Math.min(2400, Math.max(700, span * 8));
  const W = LABEL_W + TIME_W + PAD * 2;

  // The header grows with the captions; the legend and the stamp sit under the
  // chart. Both are measured rather than guessed, or a long filter list writes
  // over the first row of bars.
  const headTop = HEAD_H + captions.length * CAPTION_H;
  // What the picture will contain, decided before it is drawn so the legend can
  // describe THAT — see layoutLegend.
  const drawn = {
    done: rows.some((r) => r.done),
    cancelled: rows.some((r) => r.cancelled),
    critical: rows.some((r) => r.critical) || edges.some((e) => e.critical),
    milestone: rows.some((r) => r.milestone),
    baseline: rows.some((r) => r.baselineStart && r.baselineEnd),
    today: today >= min && today <= max,
  };
  const legendRows = layoutLegend(legend, meta, W, drawn);
  const legendH = legendRows.length * LEGEND_ROW_H;
  const H = headTop + rows.length * ROW_H + legendH + CAPTION_H + PAD;

  const chartBottom = headTop + rows.length * ROW_H;
  const x = (d: Date) => LABEL_W + PAD + ((d.getTime() - min.getTime()) / DAY / span) * TIME_W;
  const rowY = (index: number) => headTop + index * ROW_H;
  const midY = (index: number) => rowY(index) + ROW_H / 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif">`
  );
  // A title and a description, so the file is legible to a screen reader and to
  // anything that indexes it — an SVG is a document, not only a picture.
  parts.push(`<title>${esc(options.title)} — timeline</title>`);
  if (captions.length) parts.push(`<desc>${esc(captions.join(" "))}</desc>`);

  // The arrowhead. One marker, reused: `orient="auto"` points it along whatever
  // the last segment of its path was, which is why every route below ends on a
  // horizontal run.
  parts.push(
    `<defs>` +
      // `userSpaceOnUse`, and `refX` at the tip. The default multiplies the box
      // by the line's stroke width, so the critical head came out 40% bigger than
      // the ordinary one for no reason anybody reading the file could infer; and
      // the router now ends every path ON the target bar's edge, which is where
      // the tip belongs.
      `<marker id="ah" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">` +
      `<path d="M0,0 L6,2.5 L0,5 z" fill="#94a3b8"/></marker>` +
      `<marker id="ahc" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">` +
      `<path d="M0,0 L6,2.5 L0,5 z" fill="#dc2626"/></marker>` +
      // The done texture. A pattern rather than a gradient because SVG has no
      // repeating-linear-gradient; same 45°, same period, same meaning as the
      // CSS one the screen draws.
      `<pattern id="done" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">` +
      `<rect width="10" height="10" fill="#ffffff" fill-opacity="0"/>` +
      `<rect width="5" height="10" fill="#ffffff" fill-opacity="0.45"/></pattern>` +
      `</defs>`
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${PAD}" y="26" font-size="16" font-weight="700" fill="#111827">${esc(options.title)}</text>`);
  parts.push(
    `<text x="${W - PAD}" y="26" font-size="11" fill="#9ca3af" text-anchor="end">${iso(min)} → ${iso(max)}</text>`
  );
  captions.forEach((line, index) => {
    parts.push(`<text x="${PAD}" y="${42 + index * CAPTION_H}" font-size="10" fill="#6b7280">${esc(line)}</text>`);
  });

  // Weekends first so everything else sits on top of them.
  //
  // Which column is a Saturday is decided on the epoch day, never by asking a
  // UTC-anchored Date for its LOCAL weekday: `min` is a UTC midnight, so west of
  // Greenwich `day.getDay()` answered about the previous evening and the picture
  // shaded FRIDAY and Saturday. A reader counting the working days in a bar off
  // the stripes got a different number from the "Working days" column beside it.
  if (options.showWeekends !== false && span <= 400) {
    const dayW = TIME_W / span;
    const firstDay = epochDayOf(min);
    for (let offset = 0; offset <= span; offset++) {
      if (!isNonWorking(firstDay + offset)) continue;
      const day = new Date(min.getTime() + offset * DAY);
      parts.push(
        `<rect x="${x(day).toFixed(1)}" y="${headTop - 10}" width="${dayW.toFixed(2)}" height="${(chartBottom - headTop + 10).toFixed(1)}" fill="#f6f7f9"/>`
      );
    }
  }

  // Month gridlines and labels.
  //
  // Read and built in UTC throughout. Every other date in this picture is a plain
  // day anchored at UTC midnight — see `iso()` — and `x()` positions against `min`,
  // which is one of them. `new Date(y, m, 1)` builds LOCAL midnight, so west of
  // Greenwich each gridline sat a fraction of a day-width to the right of the first
  // of the month, and `min.getMonth()` could name the PREVIOUS month whenever `min`
  // fell on the first — putting a whole extra label on the chart and shifting every
  // one after it.
  const monthsToDraw = (max.getUTCFullYear() - min.getUTCFullYear()) * 12 + (max.getUTCMonth() - min.getUTCMonth()) + 1;
  for (let step = 0; step < monthsToDraw; step++) {
    const month = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth() + step, 1));
    if (month < min) continue;
    const gx = x(month);
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${headTop - 14}" x2="${gx.toFixed(1)}" y2="${chartBottom}" stroke="#eef0f3" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${(gx + 4).toFixed(1)}" y="${headTop - 20}" font-size="10" fill="#9ca3af">${MONTHS[month.getUTCMonth()]} ${String(month.getUTCFullYear()).slice(2)}</text>`
    );
  }

  /**
   * Today. The single most useful mark on an exported plan and the one it did not
   * have: without it a bar ending last Tuesday and a bar ending next Tuesday are
   * the same picture, so nobody reading the file can tell what is late.
   *
   * Only drawn when today is inside the range — a dashed line pinned to the edge
   * of a chart about next year would be read as a deadline.
   */
  if (today >= min && today <= max) {
    const tx = x(today);
    parts.push(
      `<line x1="${tx.toFixed(1)}" y1="${headTop - 16}" x2="${tx.toFixed(1)}" y2="${chartBottom}" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.75"/>`
    );
    parts.push(
      `<text x="${(tx + 3).toFixed(1)}" y="${headTop - 20}" font-size="9" font-weight="700" fill="#dc2626">Today ${iso(today)}</text>`
    );
  }

  const indexById = new Map(rows.map((r, i) => [r.id, i] as const));

  /**
   * Dependency arrows, under the bars so a bar is never obscured by a line.
   *
   * This used to be its own arithmetic, and it was the SECOND renderer of the
   * defect that was reported on screen — the one the on-screen fix was claimed
   * to have covered and did not touch. What it computed:
   *
   *   stop = x2 - 4
   *   mid  = max(min(x1 + 6, stop), stop - 12)
   *
   * At a zero gap (`x2 === x1`) that is `mid = stop = x1 - 4`, so the path is
   * `H x1-4` — **four pixels backwards** — then `V`, then an `H` to the place it
   * is already at. The final segment has zero length, so `orient="auto"` takes
   * its bearing from the vertical and the arrowhead points at the floor. A hard
   * L, a stub doubling back, a head aimed at nothing. It is worse than that: the
   * final horizontal is zero for ANY gap under 22px, which at this file's scale
   * is most of a short project.
   *
   * It calls `routeDependency` now — the same function, on the same bar boxes,
   * as the screen. One router, one shape, one place to fix it.
   */
  for (const edge of edges) {
    const si = indexById.get(edge.from);
    const ti = indexById.get(edge.to);
    const source = si === undefined ? null : rows[si];
    const target = ti === undefined ? null : rows[ti];
    if (si === undefined || ti === undefined || !source?.end || !target?.start) continue;
    const arrow = routeDependency(
      {
        left: x(source.start ?? source.end),
        right: x(source.end),
        y: midY(si),
      },
      {
        left: x(target.start),
        right: x(target.end ?? target.start),
        y: midY(ti),
      },
      ROW_H
    );
    const stroke = edge.critical ? "#dc2626" : "#94a3b8";
    const head = edge.critical ? "ahc" : "ah";
    parts.push(
      `<path d="${arrow.d}" fill="none" stroke="${stroke}" stroke-width="${edge.critical ? 1.4 : 0.9}" opacity="${edge.critical ? 0.9 : 0.5}" marker-end="url(#${head})"/>`
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
    // The glyph goes in the LABEL as well as on the bar: a one-day bar has no room
    // for a texture, and a greyscale print has no colour to carry it either. The
    // ✕ and the strike are the same pair the screen draws, for the same reason —
    // a ✓ on abandoned work reads as achieved in a file a funder opens.
    const indent = (row.depth ?? 0) * 8;
    const glyph = row.cancelled ? "✕ " : row.done ? "✓ " : "";
    const name = `${glyph}${row.identifier ? `${row.identifier}  ` : ""}${row.label}`;
    const strike = row.cancelled ? ` text-decoration="line-through"` : "";
    parts.push(
      `<text x="${PAD + indent}" y="${(y + ROW_H / 2 + 4).toFixed(1)}" font-size="11"${strike} fill="${row.done || row.cancelled ? "#6b7280" : "#374151"}">${esc(name.slice(0, 38))}</text>`
    );
    if (!row.start || !row.end) return;

    const barY = y + BAR_INSET;
    const barH = ROW_H - BAR_INSET * 2;

    /**
     * The baseline ghost, UNDER the live bar. A hollow outline, because the
     * comparison is "where did it move to", and a filled second bar would read as
     * a second task.
     */
    if (row.baselineStart && row.baselineEnd) {
      const gx = x(row.baselineStart);
      const gw = Math.max(2, x(row.baselineEnd) - gx);
      parts.push(
        `<rect x="${gx.toFixed(1)}" y="${(barY - 2).toFixed(1)}" width="${gw.toFixed(1)}" height="${barH + 4}" rx="3" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3 2"/>`
      );
    }

    const bx = x(row.start);
    const bw = Math.max(3, x(row.end) - bx);
    const fill = row.color ?? "#3b82f6";

    /**
     * A marked deliverable is a diamond, not a bar. On screen a one-day item is
     * drawn as a diamond and the bar behind it steps aside; the export drew the
     * 3px sliver instead, which reads as a rendering fault rather than a
     * milestone.
     */
    if (row.milestone) {
      const cx = bx + bw / 2;
      const cy = y + ROW_H / 2;
      const r = Math.min(6, ROW_H / 2 - 2);
      parts.push(
        `<path d="M ${cx.toFixed(1)} ${(cy - r).toFixed(1)} L ${(cx + r).toFixed(1)} ${cy.toFixed(1)} L ${cx.toFixed(1)} ${(cy + r).toFixed(1)} L ${(cx - r).toFixed(1)} ${cy.toFixed(1)} Z" fill="${fill}" stroke="#111827" stroke-width="0.8"/>`
      );
      return;
    }

    // Cancelled: no fill, the series colour as an outline — the same picture the
    // screen draws, and for the same reason. A filled bar for abandoned work
    // overstates the plan, and this is the copy that leaves the building.
    if (row.cancelled) {
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${barY.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH}" rx="3" fill="none" stroke="${fill}" stroke-width="2"/>` +
          `<line x1="${bx.toFixed(1)}" y1="${(y + ROW_H / 2).toFixed(1)}" x2="${(bx + bw).toFixed(1)}" y2="${(y + ROW_H / 2).toFixed(1)}" stroke="${fill}" stroke-width="1"/>`
      );
      return;
    }
    parts.push(
      `<rect x="${bx.toFixed(1)}" y="${barY.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH}" rx="3" fill="${fill}" opacity="0.92"/>`
    );
    // Done: the same 45° hatch the screen draws, laid over the bar's OWN colour so
    // the colour-by choice stays readable. Never a separate hue — see palette.ts.
    if (row.done) {
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${barY.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH}" rx="3" fill="url(#done)"/>`
      );
    } else if (row.progress && row.progress > 0 && row.progress < 100) {
      // The part-done fill, exactly the number the screen writes inside the bar.
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${barY.toFixed(1)}" width="${((bw * row.progress) / 100).toFixed(1)}" height="${barH}" rx="3" fill="#000000" opacity="0.22"/>`
      );
    }
    // Slack: how many working days of room this has before anything else moves.
    // A thin tail rather than a second bar, because it is not work.
    if (row.slack && row.slack > 0 && span > 0) {
      const tail = (row.slack * TIME_W) / span;
      parts.push(
        `<line x1="${(bx + bw).toFixed(1)}" y1="${(y + ROW_H / 2).toFixed(1)}" x2="${(bx + bw + tail).toFixed(1)}" y2="${(y + ROW_H / 2).toFixed(1)}" stroke="${fill}" stroke-width="1" stroke-dasharray="2 2" opacity="0.55"/>`
      );
    }
    if (row.critical) {
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${barY.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH}" rx="3" fill="none" stroke="#dc2626" stroke-width="1.2"/>`
      );
    }
  });

  // The legend, under the chart, where it does not compete with the plan.
  let legendY = chartBottom + 14;
  for (const line of legendRows) {
    let lx = PAD;
    for (const entry of line) {
      parts.push(swatchSvg(entry, lx, legendY));
      lx += entry.width;
    }
    legendY += LEGEND_ROW_H;
  }

  // Who made this and when. Every artefact that leaves the building says so —
  // a plan with no date on it gets quoted a year later as if it were current.
  //
  // `iso(today)` is right BECAUSE `today` was resolved to a plain day above; the
  // same expression over a raw `new Date()` is the bug. This stamp and the CSV's
  // "# Exported" line now come from one notion of today, so a picture and a sheet
  // pulled in the same breath cannot be dated a day apart.
  parts.push(
    `<text x="${PAD}" y="${(H - 6).toFixed(1)}" font-size="9" fill="#9ca3af">Generated ${iso(today)} from Arribada Plane${meta?.title ? ` · ${esc(meta.title)}` : ""}</text>`
  );

  parts.push("</svg>");
  return parts.join("");
};

/** One drawn legend item: what it says, how to draw it, and how much room it
 *  takes so the rows can be wrapped without a DOM. */
type TLegendItem = {
  label: string;
  color: string;
  kind: "swatch" | "hatch" | "hollow" | "dashed" | "diamond" | "ring" | "line";
  width: number;
};

/** What the picture actually ended up containing, so the legend can describe
 *  THAT rather than the set of things this renderer is capable of. */
type TDrawn = {
  done: boolean;
  cancelled: boolean;
  critical: boolean;
  milestone: boolean;
  baseline: boolean;
  today: boolean;
};

/**
 * Wrap the legend into lines that fit the page.
 *
 * The MARKS come after the series and are the things the bars are wearing — a
 * recipient looking at a hollow dashed outline has no other way to learn it is
 * the frozen plan.
 *
 * Every one of them is conditional on having been DRAWN. A legend is a promise
 * about the picture beside it: a "Today" key over a chart whose range does not
 * contain today, or a "Critical path" key over a plan with no chain, sends the
 * reader hunting for something that is not there and quietly undermines the
 * entries that ARE true.
 */
const layoutLegend = (
  legend: TExportLegendEntry[],
  meta: TExportMeta | undefined,
  width: number,
  drawn: TDrawn
): TLegendItem[][] => {
  const items: TLegendItem[] = [];
  // A single series is not an encoding — the title says what the chart is.
  if (legend.length >= 2)
    for (const entry of legend) {
      const label = entry.count === undefined ? entry.label : `${entry.label} (${entry.count})`;
      items.push({ label, color: entry.color, kind: "swatch", width: textWidth(label) + 26 });
    }
  const mark = (label: string, color: string, kind: TLegendItem["kind"]) =>
    items.push({ label, color, kind, width: textWidth(label) + 26 });
  if (drawn.baseline && meta?.baselineName) mark(`Baseline “${meta.baselineName}”`, "#9ca3af", "dashed");
  else if (drawn.baseline) mark("Baseline", "#9ca3af", "dashed");
  if (drawn.done) mark("Finished", "#64748b", "hatch");
  if (drawn.cancelled) mark("Cancelled", "#64748b", "hollow");
  if (drawn.critical) mark("Critical path", "#dc2626", "ring");
  if (drawn.milestone) mark("Deliverable", "#64748b", "diamond");
  if (drawn.today) mark("Today", "#dc2626", "line");

  const lines: TLegendItem[][] = [];
  let line: TLegendItem[] = [];
  let used = PAD;
  for (const item of items) {
    if (line.length > 0 && used + item.width > width - PAD) {
      lines.push(line);
      line = [];
      used = PAD;
    }
    line.push(item);
    used += item.width;
  }
  if (line.length) lines.push(line);
  return lines;
};

/** One legend entry drawn at (x, y). The swatch shapes deliberately match the
 *  on-screen legend's, so the two are the same picture. */
const swatchSvg = (item: TLegendItem, x: number, y: number): string => {
  const cy = y + 4;
  let glyph: string;
  if (item.kind === "hatch")
    glyph =
      `<rect x="${x}" y="${cy - 5}" width="14" height="10" rx="2" fill="${item.color}"/>` +
      `<rect x="${x}" y="${cy - 5}" width="14" height="10" rx="2" fill="url(#done)"/>`;
  else if (item.kind === "hollow")
    // Solid outline and a strike, so it cannot be read as the dashed baseline
    // ghost two entries above it.
    glyph =
      `<rect x="${x}" y="${cy - 5}" width="14" height="10" rx="2" fill="none" stroke="${item.color}" stroke-width="2"/>` +
      `<line x1="${x + 1}" y1="${cy}" x2="${x + 13}" y2="${cy}" stroke="${item.color}" stroke-width="1"/>`;
  else if (item.kind === "dashed")
    glyph = `<rect x="${x}" y="${cy - 5}" width="14" height="10" rx="2" fill="none" stroke="${item.color}" stroke-width="1" stroke-dasharray="3 2"/>`;
  else if (item.kind === "diamond")
    glyph = `<path d="M ${x + 7} ${cy - 6} L ${x + 13} ${cy} L ${x + 7} ${cy + 6} L ${x + 1} ${cy} Z" fill="${item.color}"/>`;
  else if (item.kind === "ring")
    glyph = `<rect x="${x + 0.5}" y="${cy - 4.5}" width="13" height="9" rx="2" fill="none" stroke="${item.color}" stroke-width="1.5"/>`;
  else if (item.kind === "line")
    glyph = `<line x1="${x}" y1="${cy}" x2="${x + 14}" y2="${cy}" stroke="${item.color}" stroke-width="1.4" stroke-dasharray="4 3"/>`;
  else glyph = `<rect x="${x}" y="${cy - 5}" width="14" height="10" rx="2" fill="${item.color}"/>`;
  return `${glyph}<text x="${x + 19}" y="${cy + 4}" font-size="11" fill="#374151">${esc(item.label)}</text>`;
};

/**
 * A value that begins `=`, `+`, `-`, `@`, a tab or a carriage return is executed
 * as a formula the moment the file is opened — in Excel, in LibreOffice and in
 * Google Sheets. `=cmd|' /C calc'!A0` is the classic; `=HYPERLINK("http://…"&A1)`
 * is the one that actually matters, because it exfiltrates the row it sits in
 * and looks like a link while doing it.
 *
 * This is not theoretical here. Work item names arrive from GitHub issue titles
 * through the triage importer, and nothing between a stranger typing one and
 * this function running validates the first character.
 *
 * Neutralised with a leading apostrophe, which every spreadsheet reads as "the
 * rest is text" and none of them display. NUMBERS ARE LEFT ALONE — `-1250.00` in
 * the budget sheet has to stay a number a funder can sum, and quoting it would
 * turn a column of money into a column of strings. That is the whole reason the
 * numeric test is here rather than a blanket prefix.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export const neutralise = (text: string): string =>
  FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;

/** RFC-4180 quoting: a field holding a comma, a quote or a newline is wrapped and
 *  its own quotes doubled. A task called `Test "cold soak", -20 C` would otherwise
 *  quietly become two columns in whatever opened the file.
 *
 *  Formula neutralisation happens FIRST. Doing it after the quoting would put the
 *  apostrophe outside the quotes, where it is a stray character rather than a
 *  text marker. */
export const cell = (value: string | undefined | null) => {
  const text = neutralise(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * One row per work item, with the provenance rows `budget-export.ts` established
 * — `#`-led, which a spreadsheet shows and a parser skips, and which is where
 * anything the file does NOT contain gets said out loud.
 *
 * `meta` is optional so the shape stays callable from a test with nothing but
 * rows; every real caller passes it, and without it the file says nothing about
 * where it came from.
 */
export const buildGanttCsv = (rows: TExportRow[], meta?: TExportMeta): string => {
  const table = sheetRows(rows, false);
  const lines: string[] = [];
  if (meta) lines.push(...provenance(meta, table.length));
  lines.push(SHEET_COLUMNS.join(","));
  for (const row of table) lines.push(row.map((value) => cell(value === null ? "" : String(value))).join(","));
  return lines.join("\n");
};

/**
 * The same table as a real workbook: dates as dates, counts as numbers, the
 * header frozen and filterable.
 *
 * A second sheet carries the provenance in full rather than only the two lines
 * that fit above the table — including what is not in the file. A funder or a
 * reviewer opening this six months later has no other way to know that a folded
 * band was left out.
 */
export const buildGanttWorkbook = (rows: TExportRow[], meta: TExportMeta): TSheet[] => {
  const table = sheetRows(rows, true);
  const notes = provenance(meta, table.length)
    // The `#` is CSV comment syntax and means nothing in a spreadsheet cell.
    .map((line) => line.replace(/^# ?/, ""));

  return [
    {
      name: "Work items",
      headerRow: true,
      widths: SHEET_WIDTHS,
      notes: notes.slice(0, 2),
      rows: [SHEET_COLUMNS, ...table],
    },
    {
      name: "About this export",
      rows: notes.map((line) => [line]),
    },
  ];
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

export const downloadXlsx = (sheets: TSheet[], filename: string): void => {
  // `as BlobPart`: TS types Uint8Array as ArrayBufferView<ArrayBufferLike>, and
  // BlobPart wants ArrayBufferView<ArrayBuffer>. The bytes are the same.
  triggerDownload(new Blob([buildXlsx(sheets) as BlobPart], { type: XLSX_MIME }), filename);
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
      // The mark where there is one, the old duration guess where there is not.
      `<Milestone>${(row.milestone ?? days === 1) ? 1 : 0}</Milestone>`,
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
