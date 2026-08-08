/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The chart somebody decides on before a project is over.
 *
 * It used to build its own series from the raw expense list, and all three
 * things wrong with it needed something this component cannot have:
 *
 * - it summed `expense.total` ACROSS CURRENCIES, while the ceiling it was drawn
 *   against and the caption under it were in the allocation's. Converting needs
 *   the workspace's recorded EUR/GBP rate.
 * - it OMITTED LABOUR while labelling its own series "Committed" and drawing it
 *   against the full allocation. Most projects here are almost entirely people:
 *   £750,000 of work beside £15,000 of parts drew a line at about 2% of a full
 *   ceiling, on a project that had spent its budget.
 * - it clipped the axis to the project's span but not the buckets behind it, so
 *   a receipt dated outside that window contributed to no point and left the
 *   chart without being counted anywhere.
 *
 * So the series is computed on the server (`_spend_curve`) and this file is what
 * it draws. Every test below fails against pre-fix HEAD, where the component
 * takes `expenses` and there is no `curve` in the payload at all.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpendCurve } from "./spend-curve";
import type { TSpendCurve } from "@/plane-web/types/arribada";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

// The chart library is not under test; what it is HANDED is. Rendered as JSON so
// a test can assert on the series rather than on an SVG.
vi.mock("@plane/propel/charts/area-chart", () => ({
  AreaChart: ({ data, areas }: { data: unknown[]; areas: { key: string }[] }) => (
    <div data-testid="chart" data-series={areas.map((a) => a.key).join(",")}>
      {JSON.stringify(data)}
    </div>
  ),
}));

const money = (amount: number, currency: string) => `${amount} ${currency}`;

const curve = (over: Partial<TSpendCurve> = {}): TSpendCurve => ({
  currency: "GBP",
  points: [
    { date: "2026-01-01", committed: 0, spent: 0 },
    { date: "2026-06-30", committed: 750_000, spent: 15_000 },
  ],
  allocation: 800_000,
  undated_expenses: 0,
  outside_span: 0,
  unconvertible: [],
  converted: false,
  ...over,
});

const drawn = () => JSON.parse(screen.getByTestId("chart").textContent ?? "[]");

describe("SpendCurve", () => {
  it("draws the series the server computed", () => {
    render(<SpendCurve curve={curve()} money={money} />);
    expect(drawn()).toEqual([
      { name: "2026-01-01", committed: 0, spent: 0, ceiling: 800_000 },
      { name: "2026-06-30", committed: 750_000, spent: 15_000, ceiling: 800_000 },
    ]);
  });

  it("puts labour in the committed line, which is the whole reason the chart is worth reading", () => {
    // £750,000 of human time and £15,000 of parts. The old component drew only
    // the parts and called them "Committed" against the full ceiling.
    render(<SpendCurve curve={curve()} money={money} />);
    const last = drawn().at(-1);
    expect(last.committed).toBe(750_000);
    expect(last.committed / last.ceiling).toBeGreaterThan(0.9);
  });

  it("draws no ceiling when the server withheld one", () => {
    // Which it does when the allocation is in a currency these points are not:
    // a dashed line at 793,764 francs across a sterling curve is a comparison
    // the reader would make and the data does not support.
    render(<SpendCurve curve={curve({ allocation: null })} money={money} />);
    expect(screen.getByTestId("chart").dataset.series).toBe("committed,spent");
    expect(drawn()[0]).not.toHaveProperty("ceiling");
  });

  it("reads in the currency the series is actually in", () => {
    render(<SpendCurve curve={curve({ currency: "EUR", allocation: 900_000 })} money={money} />);
    expect(screen.getByText(/900000 EUR/)).toBeInTheDocument();
  });

  it("marks the figures approximate when anything was converted", () => {
    render(<SpendCurve curve={curve({ converted: true })} money={money} />);
    expect(screen.getByText(/≈/)).toBeInTheDocument();
  });

  it("does not mark an unconverted reading", () => {
    render(<SpendCurve curve={curve()} money={money} />);
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  // --- every omission is named ---------------------------------------------

  it("says how many expenses have no date to place them on", () => {
    render(<SpendCurve curve={curve({ undated_expenses: 3 })} money={money} />);
    expect(screen.getByText(/3 expenses have no date/)).toBeInTheDocument();
  });

  it("says when money sits outside the project's own window", () => {
    render(<SpendCurve curve={curve({ outside_span: 2 })} money={money} />);
    expect(screen.getByText(/outside the project's own window/)).toBeInTheDocument();
  });

  it("names a currency it could not convert rather than dropping it in silence", () => {
    render(<SpendCurve curve={curve({ unconvertible: ["CHF", "USD"] })} money={money} />);
    expect(screen.getByText(/CHF, USD/)).toBeInTheDocument();
  });

  // --- and refuses to draw a direction out of one point --------------------

  it("says nothing is dated rather than drawing a dot", () => {
    render(<SpendCurve curve={curve({ points: [] })} money={money} />);
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.getByText(/needs dates/)).toBeInTheDocument();
  });

  it("refuses a single point, which the eye reads as a flat line", () => {
    render(<SpendCurve curve={curve({ points: [{ date: "2026-01-01", committed: 10, spent: 0 }] })} money={money} />);
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });

  it("survives a server that has no curve to give", () => {
    render(<SpendCurve curve={undefined} money={money} />);
    expect(screen.getByText(/needs dates/)).toBeInTheDocument();
  });
});
