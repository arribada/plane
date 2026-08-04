/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The money, as a file.
 *
 * The timeline one directory away exports four ways; this sheet exported none, so
 * the only route from a project's costs into a grant report or a finance
 * spreadsheet was somebody re-typing them. Funders reconcile money, not Gantt
 * charts.
 *
 * Every amount here is the RECORDED one, in the currency it was entered in —
 * never the converted reading the page may be showing. The screen goes to real
 * trouble to keep those apart (the "≈", the rate, the date it was set); a
 * spreadsheet that flattened them would undo all of it, and would be the version
 * that reaches the funder. The display currency and its rate travel in the header
 * rows instead, so the conversion is reproducible rather than baked in.
 */
import { cell } from "@/plane-web/components/gantt-chart/export";
import type { TProcurementRequest, TProjectExpense } from "@/plane-web/types/arribada";

const CSV_HEADER = [
  "Kind",
  "Category",
  "Label",
  "Quantity",
  "Unit amount",
  "Total",
  "Currency",
  "Status",
  "Date",
  "Supplier",
  "Requested by",
  "Decided by",
  "Decided at",
  // The two columns a reorder is actually placed from. A purchase request has
  // neither yet — it is a question, not a thing anybody has sourced — so those
  // rows leave them empty.
  "Part number",
  "Link",
  "Notes",
].join(",");

export type TBudgetExportContext = {
  projectName: string;
  /** What the page is currently reading in, or "" when nothing is converted. */
  displayCurrency: string;
  /** GBP per 1 EUR, and the day somebody wrote it down. */
  rate?: number | null;
  rateCapturedOn?: string | null;
  rateConfigured?: boolean;
};

export const buildBudgetCsv = (
  expenses: TProjectExpense[],
  requests: TProcurementRequest[],
  context: TBudgetExportContext
): string => {
  const lines: string[] = [];

  // Comment rows, not data rows: a spreadsheet shows them and a parser skips them
  // on a leading #, and neither should mistake provenance for a transaction.
  lines.push(`# ${context.projectName} — costs`);
  lines.push("# Amounts are as recorded, each in its own currency. Nothing here is converted.");
  if (context.displayCurrency) {
    const provenance = context.rateConfigured
      ? `recorded ${context.rateCapturedOn ?? "date unknown"}`
      : "a starting value nobody has set";
    lines.push(
      `# The page was being read in ${context.displayCurrency} at 1 EUR = ${context.rate} GBP (${provenance}).`
    );
  }
  lines.push(CSV_HEADER);

  for (const expense of expenses) {
    lines.push(
      [
        cell("Expense"),
        cell(expense.category),
        cell(expense.label),
        cell(String(expense.quantity)),
        cell(String(expense.amount)),
        cell(String(expense.total)),
        cell(expense.currency),
        cell(expense.planned ? "Budgeted" : "Spent"),
        cell(expense.incurred_on ?? ""),
        cell(""),
        cell(""),
        cell(""),
        cell(""),
        cell(expense.manufacturer_part_number ?? ""),
        cell(expense.url ?? ""),
        cell(expense.notes ?? ""),
      ].join(",")
    );
  }

  for (const request of requests) {
    lines.push(
      [
        cell("Purchase request"),
        cell(request.category),
        cell(request.label),
        cell(String(request.quantity)),
        cell(String(request.amount)),
        cell(String(request.total)),
        cell(request.currency),
        cell(request.status),
        cell(request.needed_by ?? ""),
        cell(request.supplier ?? ""),
        cell(request.requested_by_name ?? ""),
        cell(request.decided_by_name ?? ""),
        cell(request.decided_at ?? ""),
        cell(""),
        cell(""),
        cell(request.decision_note ?? request.justification ?? ""),
      ].join(",")
    );
  }

  // An approved request also exists as an expense, so a naive total over this file
  // would double-count it. Said here rather than left for somebody to discover in
  // a reconciliation.
  lines.push("");
  lines.push("# An approved purchase request also appears above as an expense — filter on Kind before totalling.");

  return lines.join("\n");
};
