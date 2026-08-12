/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Export" for the work-item timeline.
 *
 * The menu offers a SCOPE before it offers a format, and the default is the
 * chart as it stands — same order, same bands, same folds, same filters. That
 * ordering is the fix: the export used to be a second pass over the whole
 * project that merely resembled what was on screen, so folding a band changed
 * the picture and changed nothing about the file. Somebody who has spent ten
 * minutes arranging a view expects the file to be OF that view.
 *
 * "Everything" is still one click away, because the other reasonable
 * expectation — "give me the whole plan regardless of what I folded" — is just
 * as common, and guessing between them is what produced the complaint. It is
 * offered rather than assumed, and whichever is picked is written into the file.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import {
  CalendarDays,
  Check,
  Download,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  GanttChartSquare,
  Table2,
} from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import {
  buildGanttCsv,
  buildGanttSvg,
  buildGanttWorkbook,
  buildIcs,
  buildMsProjectXml,
  CanvasTooLargeError,
  downloadCsv,
  downloadPng,
  downloadSvg,
  downloadText,
  downloadXlsx,
  type TExportEdge,
  type TExportLegendEntry,
  type TExportMeta,
  type TExportRow,
} from "./export";

/** A filename a file manager will accept, from a project name that may not be one. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "timeline";

export type TExportScope = "view" | "all";

export type TExportPayload = {
  rows: TExportRow[];
  edges: TExportEdge[];
  meta: TExportMeta;
  showWeekends: boolean;
  /** The series swatches the chart is showing. Handed straight to the drawn
   *  formats so the file's legend and the screen's are the same list — a picture
   *  whose colours mean something only to the person who pressed the button is
   *  the defect this whole pass exists for. */
  legend?: TExportLegendEntry[];
  /** The server has pages the client has not fetched — the file would stop short. */
  partial?: boolean;
};

type Props = {
  /**
   * Rebuilt on demand so the export always reflects the chart as it is now, and
   * takes the scope so "as shown" and "everything" are two different row lists
   * rather than one list the formats interpret differently.
   */
  collect: (scope: TExportScope) => TExportPayload;
};

export const GanttExportButton = observer(function GanttExportButton({ collect }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<TExportScope>("view");

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const run = async (kind: "svg" | "png" | "csv" | "xlsx" | "mpp" | "ics") => {
    setOpen(false);
    setBusy(true);
    try {
      const { rows, edges, meta, showWeekends, legend, partial } = collect(scope);
      if (partial) {
        // Refusing beats handing over a plan that looks whole and is not. The
        // server still has pages the client has not fetched, so the file would
        // stop wherever scrolling stopped — and nothing in a CSV or an
        // MS-Project XML says how much is missing. A folded band is a CHOICE and
        // is recorded as one in the file; an unfetched page is neither.
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Not everything is loaded yet",
          message:
            "This timeline has more work items than have been fetched. Scroll to the bottom of the list so they all load, then export — otherwise the file would silently stop short.",
        });
        return;
      }
      const name = slug(meta.title);
      const suffix = scope === "all" ? "-full" : "";
      if (kind === "csv") {
        downloadCsv(buildGanttCsv(rows, meta), `${name}${suffix}.csv`);
        return;
      }
      if (kind === "xlsx") {
        downloadXlsx(buildGanttWorkbook(rows, meta), `${name}${suffix}.xlsx`);
        return;
      }
      if (kind === "mpp") {
        const xml = buildMsProjectXml(rows, edges, meta.title);
        if (!xml) {
          setToast({ type: TOAST_TYPE.WARNING, title: "Nothing to export", message: "No dated work items." });
          return;
        }
        downloadText(xml, `${name}${suffix}.xml`, "application/xml");
        return;
      }
      if (kind === "ics") {
        downloadText(buildIcs(rows, meta.title), `${name}${suffix}.ics`, "text/calendar");
        return;
      }
      const svg = buildGanttSvg(rows, edges, { title: meta.title, showWeekends, legend, meta });
      if (!svg) {
        // The chart can be full of rows and still have nothing to draw: an item
        // with no dates has no bar. Saying so beats handing over a blank file.
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Nothing to export",
          message: "None of the work items on this timeline have both a start and an end date.",
        });
        return;
      }
      if (kind === "svg") downloadSvg(svg, `${name}${suffix}.svg`);
      else await downloadPng(svg, `${name}${suffix}.png`);
    } catch (error) {
      // A long plan can exceed what a browser will allocate for a canvas, and
      // toBlob answers that with a blank image rather than an error — so this is
      // caught and named instead of quietly downloading a white rectangle.
      const tooBig = error instanceof CanvasTooLargeError;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: tooBig ? "Too large for a PNG" : "Couldn't build the file",
        message: tooBig
          ? "This plan is past what a browser can rasterise. Export as SVG — it stays sharp at any size."
          : "Nothing was downloaded. Try again, or export as CSV.",
      });
    } finally {
      setBusy(false);
    }
  };

  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-13 hover:bg-layer-2";

  const scopeRow = (value: TExportScope, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setScope(value)}
      aria-pressed={scope === value}
      className={cn("flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-13 hover:bg-layer-2", {
        "bg-accent-primary/10": scope === value,
      })}
    >
      <span
        className={cn("mt-0.5 flex size-4 flex-shrink-0 items-center justify-center rounded-full border", {
          "border-accent-strong bg-accent-primary text-white": scope === value,
          "border-subtle": scope !== value,
        })}
      >
        {scope === value && <Check className="size-2.5" />}
      </span>
      <span>
        {label}
        <span className="block text-11 text-tertiary">{hint}</span>
      </span>
    </button>
  );

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title="Save this timeline as an image or a spreadsheet"
        className="shadow-sm flex items-center gap-1.5 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-12 text-secondary hover:bg-layer-2 disabled:opacity-50"
      >
        <Download className="size-3.5" />
        {busy ? "Exporting…" : "Export"}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close the export menu"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* `whitespace-normal`: this panel is handed to the header as
              `toolbarActions` and lands inside a `whitespace-nowrap` group, which
              inherits. See group-by.tsx. */}
          <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-64 rounded-md border border-subtle bg-layer-1 p-1 break-words whitespace-normal">
            {/* Scope first, because it changes what every format below contains. */}
            <div className="px-2 pt-1 pb-0.5 text-10 font-medium tracking-wide text-secondary/70 uppercase">
              What to include
            </div>
            {scopeRow("view", "This view", "The bands, folds and filters on screen")}
            {scopeRow("all", "Everything", "Every work item, whatever is folded")}
            <div className="my-1 border-t border-subtle" />
            <div className="px-2 pb-0.5 text-10 font-medium tracking-wide text-secondary/70 uppercase">
              As a spreadsheet
            </div>
            <button type="button" className={item} onClick={() => void run("xlsx")}>
              <Table2 className="size-3.5 text-tertiary" />
              <span>
                Excel workbook
                <span className="block text-11 text-tertiary">One row per work item, dates and float</span>
              </span>
            </button>
            <button type="button" className={item} onClick={() => void run("csv")}>
              <FileSpreadsheet className="size-3.5 text-tertiary" />
              CSV (same columns)
            </button>
            <div className="my-1 border-t border-subtle" />
            <div className="px-2 pb-0.5 text-10 font-medium tracking-wide text-secondary/70 uppercase">
              As a picture
            </div>
            <button type="button" className={item} onClick={() => void run("png")}>
              <FileImage className="size-3.5 text-tertiary" />
              PNG image
            </button>
            <button type="button" className={item} onClick={() => void run("svg")}>
              <FileCode2 className="size-3.5 text-tertiary" />
              SVG (stays sharp)
            </button>
            <div className="my-1 border-t border-subtle" />
            <button type="button" className={item} onClick={() => void run("mpp")}>
              <GanttChartSquare className="size-3.5 text-tertiary" />
              <span>
                MS Project XML
                <span className="block text-11 text-tertiary">Also opens in Primavera, Smartsheet</span>
              </span>
            </button>
            <button type="button" className={item} onClick={() => void run("ics")}>
              <CalendarDays className="size-3.5 text-tertiary" />
              <span>
                Calendar (.ics)
                <span className="block text-11 text-tertiary">One all-day event per item</span>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
});
