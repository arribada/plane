/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Export" for the work-item timeline. Builds the file from the rows the chart is
 * currently showing — same order, same bands, same filters — so what comes out is
 * what was on screen, not a different query that happens to look similar.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { CalendarDays, Download, FileCode2, FileImage, FileSpreadsheet, GanttChartSquare } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import {
  buildGanttCsv,
  buildGanttSvg,
  buildIcs,
  buildMsProjectXml,
  CanvasTooLargeError,
  downloadCsv,
  downloadPng,
  downloadSvg,
  downloadText,
  type TExportEdge,
  type TExportRow,
} from "./export";

/** A filename a file manager will accept, from a project name that may not be one. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "timeline";

type Props = {
  /** Rebuilt on demand so the export always reflects the chart as it is now. */
  collect: () => {
    rows: TExportRow[];
    edges: TExportEdge[];
    title: string;
    showWeekends: boolean;
    /** The server has pages the client has not fetched — the file would stop short. */
    partial?: boolean;
  };
};

export const GanttExportButton = observer(function GanttExportButton({ collect }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const run = async (kind: "svg" | "png" | "csv" | "mpp" | "ics") => {
    setOpen(false);
    setBusy(true);
    try {
      const { rows, edges, title, showWeekends, partial } = collect();
      if (partial) {
        // Refusing beats handing over a plan that looks whole and is not. The
        // server still has pages the client has not fetched, so the file would
        // stop wherever scrolling stopped — and nothing in a CSV or an MS-Project
        // XML says how much is missing.
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Not everything is loaded yet",
          message:
            "This timeline has more work items than have been fetched. Scroll to the bottom of the list so they all load, then export — otherwise the file would silently stop short.",
        });
        return;
      }
      const name = slug(title);
      if (kind === "csv") {
        downloadCsv(buildGanttCsv(rows), `${name}.csv`);
        return;
      }
      if (kind === "mpp") {
        const xml = buildMsProjectXml(rows, edges, title);
        if (!xml) {
          setToast({ type: TOAST_TYPE.WARNING, title: "Nothing to export", message: "No dated work items." });
          return;
        }
        downloadText(xml, `${name}.xml`, "application/xml");
        return;
      }
      if (kind === "ics") {
        downloadText(buildIcs(rows, title), `${name}.ics`, "text/calendar");
        return;
      }
      const svg = buildGanttSvg(rows, edges, { title, showWeekends });
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
      if (kind === "svg") downloadSvg(svg, `${name}.svg`);
      else await downloadPng(svg, `${name}.png`);
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
          <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-52 rounded-md border border-subtle bg-layer-1 p-1">
            <button type="button" className={item} onClick={() => void run("png")}>
              <FileImage className="size-3.5 text-tertiary" />
              PNG image
            </button>
            <button type="button" className={item} onClick={() => void run("svg")}>
              <FileCode2 className="size-3.5 text-tertiary" />
              SVG (stays sharp)
            </button>
            <button type="button" className={item} onClick={() => void run("csv")}>
              <FileSpreadsheet className="size-3.5 text-tertiary" />
              CSV (dates and owners)
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
