/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The printed annex costs nothing until somebody prints.
 *
 * It used to fetch on mount: up to five hundred work items — of which it reads
 * four fields — and a second full budget computation the block above the fold had
 * already made, on EVERY view of the Overview, to fill a `hidden` div. Two of the
 * heaviest requests on the route, spent on a page nobody had asked to print.
 *
 * The awkward part is that `window.print()` is synchronous, so "fetch it later"
 * is only correct if the Print button WAITS. That is the contract these tests
 * pin: nothing before it is armed, and `onSettled` afterwards — including when
 * the fetch fails, or the button would spin forever on a bad day.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewPrintAnnex } from "./print-annex";

const { getProjectItems, getBudget } = vi.hoisted(() => ({
  getProjectItems: vi.fn(),
  getBudget: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada", projectId: "gps" }) }));
vi.mock("@/hooks/store/use-project-state", () => ({
  useProjectState: () => ({ getStateById: () => ({ group: "started" }) }),
}));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getProjectItems = getProjectItems;
    getBudget = getBudget;
  },
}));

const ITEMS = [
  { id: "i-1", name: "Fit the saltwater switch", state_id: "s-1", start_date: "2026-08-03", target_date: "2026-08-07" },
];

/**
 * A figure as the annex prints it, in whatever locale the runner has — with the
 * group separator reduced to a plain space, because testing-library's default
 * normaliser does the same to the DOM side (a French narrow no-break space is
 * `\s` too) and an un-normalised expectation never matches it.
 */
const grouped = (n: number) => n.toLocaleString().replace(/\s+/g, " ");

beforeEach(() => {
  // `restoreMocks` only restores spies; a bare `vi.fn()` carries its call log
  // between tests, and half of what this file asserts is a call COUNT.
  getProjectItems.mockReset();
  getBudget.mockReset();
  getProjectItems.mockResolvedValue(ITEMS);
  getBudget.mockResolvedValue(null);
});

describe("the annex", () => {
  it("fetches nothing until it is armed", async () => {
    render(<OverviewPrintAnnex overview={null} armed={false} onSettled={vi.fn()} />);
    // A microtask turn is enough: the old version fired its effect on mount.
    await Promise.resolve();
    expect(getProjectItems).not.toHaveBeenCalled();
    expect(getBudget).not.toHaveBeenCalled();
    expect(screen.queryAllByText(ITEMS[0].name)).toHaveLength(0);
  });

  it("fetches once armed, and says when it is on the page", async () => {
    const onSettled = vi.fn();
    render(<OverviewPrintAnnex overview={null} armed onSettled={onSettled} />);

    // The name appears twice on the printed page: once in the condensed
    // timeline, once in its status group.
    await screen.findAllByText(ITEMS[0].name);
    expect(getProjectItems).toHaveBeenCalledWith("arribada", "gps");
    expect(getBudget).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  it("releases the print button even when the fetch fails", async () => {
    // Otherwise a failing request leaves the button reading "Preparing…" for good.
    getProjectItems.mockRejectedValue(new Error("502"));
    const onSettled = vi.fn();
    render(<OverviewPrintAnnex overview={null} armed onSettled={onSettled} />);
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  it("prints the cost section as the funder report does: both halves, flagged, currency said once", async () => {
    // It used to print labour in each rate's currency with no word about it,
    // and categories as the converted `actual` alone — `planned` dropped and
    // nothing marked "≈" — so the annex and the funder report disagreed.
    getBudget.mockResolvedValue({
      labour: {
        by_role: [{ role: "firmware", days: 10, hours: 70, cost: 5600, currency: "GBP", rated: true }],
        totals: [],
        unrated_roles: [],
      },
      expenses: {
        by_category: [{ category: "hardware", planned: 1200, actual: 300, currency: "EUR" }],
        by_category_converted: true,
        planned: [],
        actual: [],
        count: 1,
      },
    });
    const view = render(<OverviewPrintAnnex overview={null} armed onSettled={vi.fn()} />);
    await screen.findAllByText(ITEMS[0].name);

    expect(screen.getByText(`10 d · ${grouped(5600)} GBP`)).toBeInTheDocument();
    expect(screen.getByText(/currency its rate is recorded in/)).toBeInTheDocument();
    expect(screen.getByText(/by category, in EUR/)).toBeInTheDocument();
    expect(screen.getByText(`≈ ${grouped(1200)} budgeted · ≈ ${grouped(300)} spent`)).toBeInTheDocument();
    expect(view.container.textContent).toContain("≈ marks a figure");
  });

  it("marks nothing as approximate when nothing was converted", async () => {
    getBudget.mockResolvedValue({
      labour: { by_role: [], totals: [], unrated_roles: [] },
      expenses: {
        by_category: [{ category: "hardware", planned: 1200, actual: 300, currency: "EUR" }],
        by_category_converted: false,
        planned: [],
        actual: [],
        count: 1,
      },
    });
    const view = render(<OverviewPrintAnnex overview={null} armed onSettled={vi.fn()} />);
    await screen.findAllByText(ITEMS[0].name);

    expect(screen.getByText(`${grouped(1200)} budgeted · ${grouped(300)} spent`)).toBeInTheDocument();
    expect(view.container.textContent).not.toContain("≈");
  });

  it("does not fetch again when it is armed a second time", async () => {
    const onSettled = vi.fn();
    const view = render(<OverviewPrintAnnex overview={null} armed onSettled={onSettled} />);
    // The name appears twice on the printed page: once in the condensed
    // timeline, once in its status group.
    await screen.findAllByText(ITEMS[0].name);
    view.rerender(<OverviewPrintAnnex overview={null} armed onSettled={onSettled} />);
    await Promise.resolve();
    expect(getProjectItems).toHaveBeenCalledTimes(1);
  });
});
