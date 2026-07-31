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
import { Download, FileImage, FileSpreadsheet, FileCode2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import {
  buildGanttCsv,
  buildGanttSvg,
  downloadCsv,
  downloadPng,
  downloadSvg,
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
  collect: () => { rows: TExportRow[]; edges: TExportEdge[]; title: string; showWeekends: boolean };
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

  const run = async (kind: "svg" | "png" | "csv") => {
    setOpen(false);
    setBusy(true);
    try {
      const { rows, edges, title, showWeekends } = collect();
      const name = slug(title);
      if (kind === "csv") {
        downloadCsv(buildGanttCsv(rows), `${name}.csv`);
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
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't build the file",
        message: "Nothing was downloaded. Try again, or export as CSV.",
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
          </div>
        </>
      )}
    </div>
  );
});
