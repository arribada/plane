/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Parse an Asana CSV export into rows we can turn into work items. Asana quotes any field that
 * contains a comma, a newline or a quote, and escapes a quote by doubling it — so a hand-rolled
 * split on "," loses every note with a comma in it. This is a small state machine that respects
 * the quoting, which is all the correctness this import rests on.
 */

export type TAsanaRow = {
  name: string;
  section: string;
  assigneeEmail: string;
  startDate: string; // YYYY-MM-DD or ""
  dueDate: string; // YYYY-MM-DD or ""
  notes: string;
  parent: string; // the parent task's NAME, as Asana exports it
  blockedBy: string[]; // task names this is blocked by
  blocking: string[]; // task names this blocks
  asanaId: string; // the human id, e.g. USER-30
};

/** Split raw CSV text into rows of string cells, honouring quotes and doubled-quote escapes. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if the export carries one (Asana's does).
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow a \r\n as one break; end the row on any newline that closed a non-empty line.
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      // Skip fully blank lines the export sometimes trails.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
};

const splitDeps = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** An Asana date cell is either empty or YYYY-MM-DD; anything else we drop rather than guess. */
const normaliseDate = (value: string): string => {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
};

/** Turn parsed cells into rows keyed by Asana's column names, tolerant of column order. */
export const rowsFromCsv = (text: string): { rows: TAsanaRow[]; error: string | null } => {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: "The file has no task rows." };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    name: col("Name"),
    section: col("Section/Column"),
    assigneeEmail: col("Assignee Email"),
    startDate: col("Start Date"),
    dueDate: col("Due Date"),
    notes: col("Notes"),
    parent: col("Parent task"),
    blockedBy: col("Blocked By (Dependencies)"),
    blocking: col("Blocking (Dependencies)"),
    asanaId: col("ID"),
  };
  if (idx.name === -1) return { rows: [], error: "No 'Name' column — is this an Asana CSV export?" };
  const at = (cells: string[], i: number) => (i >= 0 && i < cells.length ? cells[i] : "");
  const rows: TAsanaRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const name = at(cells, idx.name).trim();
    if (!name) continue; // a task with no name is not a task
    rows.push({
      name,
      section: at(cells, idx.section).trim(),
      assigneeEmail: at(cells, idx.assigneeEmail).trim().toLowerCase(),
      startDate: normaliseDate(at(cells, idx.startDate)),
      dueDate: normaliseDate(at(cells, idx.dueDate)),
      notes: at(cells, idx.notes),
      parent: at(cells, idx.parent).trim(),
      blockedBy: splitDeps(at(cells, idx.blockedBy)),
      blocking: splitDeps(at(cells, idx.blocking)),
      asanaId: at(cells, idx.asanaId).trim(),
    });
  }
  return { rows, error: rows.length === 0 ? "No task rows found in the file." : null };
};