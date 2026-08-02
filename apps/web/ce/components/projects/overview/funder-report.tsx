/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The quarterly report to a funder, as a file.
 *
 * Everything in here is already on the Overview screen; the only thing missing
 * was a way for it to leave the browser. Today that gap is filled by somebody
 * reading figures off a monitor and retyping them into a document — which is
 * where transcription errors enter a grant report, and where the currency
 * provenance the budget block works so hard to preserve gets lost.
 *
 * Deliberately NOT a screenshot of the page. A report is read by someone who was
 * not in the room: it needs its period stated, its figures labelled, and its
 * caveats attached to the numbers they qualify rather than sitting in a tooltip.
 */
import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { renderFormattedDate } from "@plane/utils";
import type {
  TProcurementRequest,
  TProjectBudget,
  TProjectExpense,
  TProjectOverview,
} from "@/plane-web/types/arribada";

/**
 * Plain hex and explicit sizes: @react-pdf does not see the app's CSS variables,
 * and a report is printed rather than themed. Arribada navy for the rules and
 * headings so the sheet is recognisably theirs without colouring the figures.
 */
const NAVY = "#0a1929";
const INK = "#1a1a1a";
const MUTED = "#5f6b76";
const RULE = "#d8dee4";

const styles = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 48, paddingHorizontal: 44, fontSize: 10, color: INK },
  title: { fontSize: 20, color: NAVY, marginBottom: 2 },
  subtitle: { fontSize: 10, color: MUTED, marginBottom: 14 },
  rule: { borderBottomWidth: 2, borderBottomColor: NAVY, marginBottom: 16 },
  section: { fontSize: 12, color: NAVY, marginTop: 18, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowRule: { borderBottomWidth: 0.5, borderBottomColor: RULE },
  label: { color: MUTED },
  cell: { flex: 1, paddingRight: 8 },
  cellRight: { width: 90, textAlign: "right" },
  narrative: { lineHeight: 1.5, marginTop: 4 },
  caveat: { fontSize: 8, color: MUTED, marginTop: 4, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    fontSize: 8,
    color: MUTED,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 6,
  },
  tile: { width: "25%", paddingVertical: 6 },
  tileValue: { fontSize: 16, color: NAVY },
  tileLabel: { fontSize: 8, color: MUTED },
});

export type TFunderReportInput = {
  overview: TProjectOverview;
  budget: TProjectBudget | null;
  expenses: TProjectExpense[];
  requests: TProcurementRequest[];
  /** Deliverables, in date order, with the name a funder should read. */
  milestones: { id: string; name: string; date: string | null; kind: string; done: boolean }[];
  money: (amount: number, currency: string) => string;
  generatedOn: string;
};

const Row = ({ left, right, muted }: { left: string; right: string; muted?: boolean }) => (
  <View style={[styles.row, styles.rowRule]}>
    <Text style={[styles.cell, muted ? styles.label : {}]}>{left}</Text>
    <Text style={styles.cellRight}>{right}</Text>
  </View>
);

function ReportDocument({ overview, budget, expenses, requests, milestones, money, generatedOn }: TFunderReportInput) {
  const span = budget?.span;
  const alloc = budget?.allocation;
  const period =
    span?.start_date || span?.target_date
      ? `${renderFormattedDate(span?.start_date) ?? "start not set"} — ${renderFormattedDate(span?.target_date) ?? "end not set"}`
      : "No project dates recorded";

  const currency = alloc?.currency ?? "EUR";
  // Approved-but-unspent is a real claim on the budget and the reason a report
  // can look healthy the week before it is not.
  const outstanding = requests.filter((r) => r.status === "approved" || r.status === "ordered");

  return (
    <Document title={`${overview.project.name} — progress report`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{overview.project.name}</Text>
        <Text style={styles.subtitle}>
          Progress report · {period} · prepared {generatedOn}
        </Text>
        <View style={styles.rule} />

        {/* The narrative first: a funder reads the sentence before the table. */}
        {overview.status ? (
          <>
            <Text style={styles.section}>Where the project stands</Text>
            <Text style={styles.narrative}>{overview.status.message}</Text>
            <Text style={styles.caveat}>
              Status recorded {renderFormattedDate(overview.status.created_at)}
              {overview.status.author ? ` by ${overview.status.author}` : ""}.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.section}>Where the project stands</Text>
            <Text style={[styles.narrative, styles.label]}>
              No status update has been written for this project, so this report carries figures only.
            </Text>
          </>
        )}

        <Text style={styles.section}>Work</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {[
            { value: overview.items.total, label: "Work items" },
            { value: overview.items.completed, label: "Completed" },
            { value: overview.items.started, label: "In progress" },
            { value: overview.items.overdue, label: "Overdue" },
          ].map((tile) => (
            <View key={tile.label} style={styles.tile}>
              <Text style={styles.tileValue}>{tile.value}</Text>
              <Text style={styles.tileLabel}>{tile.label}</Text>
            </View>
          ))}
        </View>
        {overview.items.undated > 0 && (
          <Text style={styles.caveat}>
            {overview.items.undated} work {overview.items.undated === 1 ? "item has" : "items have"} no dates, so they
            are counted above but appear nowhere on a timeline.
          </Text>
        )}

        <Text style={styles.section}>Deliverables</Text>
        {milestones.length === 0 ? (
          <Text style={[styles.narrative, styles.label]}>
            No work items have been marked as deliverables on this project.
          </Text>
        ) : (
          milestones.map((m) => (
            <Row
              key={m.id}
              left={`${m.done ? "Delivered" : "Planned"} · ${m.name}`}
              right={renderFormattedDate(m.date) ?? "no date"}
            />
          ))
        )}

        <Text style={styles.section}>Money</Text>
        {alloc?.amount == null ? (
          <Text style={[styles.narrative, styles.label]}>No budget has been recorded for this project.</Text>
        ) : (
          <>
            <Row left="Budget" right={money(alloc.amount, currency)} />
            <Row left="Committed" right={money(alloc.committed, currency)} />
            <Row left="Remaining" right={alloc.remaining == null ? "—" : money(alloc.remaining, currency)} />
            {outstanding.length > 0 && (
              <Text style={styles.caveat}>
                Includes {outstanding.length} approved {outstanding.length === 1 ? "purchase" : "purchases"} not yet
                paid.
              </Text>
            )}
            {alloc.excluded_currencies.length > 0 && (
              <Text style={styles.caveat}>
                Figures recorded in {alloc.excluded_currencies.join(", ")} are counted separately and are NOT included
                above — this project's budget is held in {currency}.
              </Text>
            )}
          </>
        )}

        {expenses.length > 0 && (
          <>
            <Text style={styles.section}>Expenses as recorded</Text>
            {expenses.slice(0, 24).map((e) => (
              <Row
                key={e.id}
                left={`${e.label}${e.incurred_on ? ` · ${renderFormattedDate(e.incurred_on)}` : ""}${e.planned ? " · budgeted" : ""}`}
                right={money(e.total, e.currency)}
              />
            ))}
            {expenses.length > 24 && (
              <Text style={styles.caveat}>
                {expenses.length - 24} further {expenses.length - 24 === 1 ? "line is" : "lines are"} recorded and not
                listed here. The full sheet exports as CSV from the project overview.
              </Text>
            )}
            <Text style={styles.caveat}>
              Each amount is shown in the currency it was entered in. Nothing on this page has been converted.
            </Text>
          </>
        )}

        <Text style={styles.footer} fixed>
          {overview.project.name} · prepared {generatedOn} from the project record. Figures are as recorded on that date
          and are not a certified financial statement.
        </Text>
      </Page>
    </Document>
  );
}

/** Build the report and hand the browser a file. */
export async function downloadFunderReport(input: TFunderReportInput): Promise<void> {
  const blob = await pdf(<ReportDocument {...input} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${
    input.overview.project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "project"
  }-report.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick rather than immediately: Safari has not finished
  // reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
