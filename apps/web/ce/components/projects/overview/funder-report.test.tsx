/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The currency the funder report puts on the committed total.
 *
 * `allocation.committed` is not always in the allocation's currency: a budget
 * held outside the EUR/GBP pair cannot be converted into, so the server sums in
 * a currency it can reach and says which in `committed_currency`. The report
 * formatted the figure with the allocation's code regardless — a sterling total
 * printed as francs, on the page that goes to the funder.
 *
 * @react-pdf is replaced with plain elements: what is under test is the text,
 * not the typesetting.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportDocument, type TFunderReportInput } from "./funder-report";
import type { TProjectBudget, TProjectOverview } from "@/plane-web/types/arribada";

vi.mock("@react-pdf/renderer", () => {
  // vitest hoists this factory above the imports, so a module-scope `Box` would
  // be read before its initialisation; it has to live inside the factory.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Document: Box,
    Page: Box,
    View: Box,
    Text: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    StyleSheet: { create: (styles: Record<string, unknown>) => styles },
    pdf: vi.fn(),
  };
});

const OVERVIEW = {
  project: { name: "Sea Turtle Tag GPS" },
  status: null,
  items: { total: 0, completed: 0, started: 0, overdue: 0, undated: 0 },
} as unknown as TProjectOverview;

const budgetWith = (allocation: Record<string, unknown>): TProjectBudget =>
  ({
    display: null,
    span: { start_date: null, target_date: null },
    allocation: { excluded_currencies: [], ...allocation },
  }) as unknown as TProjectBudget;

const draw = (budget: TProjectBudget) => {
  const input: TFunderReportInput = {
    overview: OVERVIEW,
    budget,
    expenses: [],
    requests: [],
    milestones: [],
    // Bare, so an assertion reads the currency the report CHOSE.
    money: (amount, currency) => `${amount} ${currency}`,
    generatedOn: "1 Sep 2026",
  };
  return render(<ReportDocument {...input} />);
};

describe("the committed total", () => {
  it("is stated in the currency the server summed it in, not the allocation's", () => {
    draw(
      budgetWith({
        amount: 100000,
        currency: "CHF",
        committed: 4000,
        committed_currency: "GBP",
        basis_mismatch: true,
        remaining: null,
        percent: null,
      })
    );

    expect(screen.getByText("4000 GBP")).toBeInTheDocument();
    expect(screen.queryByText("4000 CHF")).not.toBeInTheDocument();
    // And the reader is told why the two figures on the page do not match.
    expect(screen.getByText(/stated in GBP, and no remaining figure is given/)).toBeInTheDocument();
    expect(screen.getByText("100000 CHF")).toBeInTheDocument();
  });

  it("stays in the allocation's currency in the ordinary case, with no caveat", () => {
    draw(
      budgetWith({
        amount: 10000,
        currency: "EUR",
        committed: 4000,
        committed_currency: "EUR",
        basis_mismatch: false,
        remaining: 6000,
        percent: 40,
      })
    );

    expect(screen.getByText("4000 EUR")).toBeInTheDocument();
    expect(screen.getByText("6000 EUR")).toBeInTheDocument();
    expect(screen.queryByText(/cannot be compared/)).not.toBeInTheDocument();
  });

  it("falls back to the allocation's currency on an older server that names none", () => {
    draw(budgetWith({ amount: 10000, currency: "GBP", committed: 4000, remaining: 6000, percent: 40 }));
    expect(screen.getByText("4000 GBP")).toBeInTheDocument();
  });
});
