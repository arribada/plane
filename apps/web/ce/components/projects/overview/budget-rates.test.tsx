/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Two ways the hourly-rate panel lied about what was stored.
 *
 * A rate, once recorded, could never be removed: the save dropped every blank
 * or zero row from the PUT, so the server never heard about the emptied box and
 * kept the old figure — under a sentence promising "an empty box stays empty".
 * And a refused save kept its optimistic figures as the page's idea of the
 * stored ones, so a lead without workspace admin saw rates the server had just
 * declined to record.
 *
 * The server side of the first fix — a `hourly_rate` of 0 deletes the row — is
 * the backend's; what is pinned here is that the row is SENT.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewBudgetBlock } from "./budget-block";

const { saveRoleRates, getRoleRates, setToast } = vi.hoisted(() => ({
  saveRoleRates: vi.fn(),
  getRoleRates: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success", WARNING: "warning", INFO: "info" },
  setToast,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada", projectId: "gps" }) }));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ getProjectById: () => ({ id: "gps", name: "Sea Turtle Tag GPS", identifier: "GPS" }) }),
}));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ allowPermissions: () => true }) }));
vi.mock("./spend-analysis", () => ({ SpendAnalysis: () => null }));
vi.mock("./spend-curve", () => ({ SpendCurve: () => null }));
vi.mock("@/plane-web/components/workspace/expense-modal", () => ({ ExpenseModal: () => null }));

const BUDGET = {
  display: null,
  span: { start_date: null, target_date: null },
  schedule_from_deliveries: false,
  allocation: { amount: 10000, currency: "GBP", committed: 0, remaining: 10000, percent: 0, excluded_currencies: [] },
  labour: { by_role: [], totals: [], unrated_roles: [] },
  expenses: { by_category: [], planned: [], actual: [], count: 0 },
};

const RATES = {
  rates: [{ role: "firmware", hourly_rate: 80, hours_per_day: 7, currency: "GBP" }],
  known_roles: [
    { value: "firmware", label: "Firmware engineer" },
    { value: "hardware", label: "Hardware engineer" },
  ],
  presets: [
    {
      country: "uk",
      label: "UK",
      currency: "GBP",
      hours_per_day: 7.5,
      rates: { firmware: 75 },
      source: "Indicative.",
      captured_on: "2026-01-01",
    },
  ],
};

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getBudget = vi.fn(async () => BUDGET);
    getExpenses = vi.fn(async () => ({ expenses: [] }));
    getRoleRates = getRoleRates;
    getCalendar = vi.fn(async () => ({ days: [] }));
    getProcurement = vi.fn(async () => ({ requests: [], can_approve: true }));
    getCurrencySettings = vi.fn(async () => null);
    saveRoleRates = saveRoleRates;
  },
}));

beforeEach(() => {
  saveRoleRates.mockReset();
  getRoleRates.mockReset();
  setToast.mockReset();
  saveRoleRates.mockResolvedValue({ rates: [] });
  getRoleRates.mockResolvedValue(RATES);
});

/** The hourly box of one discipline: the first number input inside its row. */
const rateBox = (label: string) =>
  within(screen.getByText(label).closest("label") as HTMLElement).getAllByRole("spinbutton")[0];

const panelButton = () => screen.findByRole("button", { name: /Hourly rates/ });

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await panelButton());
  await screen.findByText("Firmware engineer");
};

describe("removing a recorded rate", () => {
  it("sends an emptied box as zero so the server removes the rate", async () => {
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openPanel(user);

    fireEvent.change(rateBox("Firmware engineer"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    await waitFor(() => expect(saveRoleRates).toHaveBeenCalledTimes(1));
    expect(saveRoleRates.mock.calls[0][1]).toContainEqual({
      role: "firmware",
      hourly_rate: 0,
      hours_per_day: 7,
      currency: "GBP",
    });
  });

  it("still sends nothing for a discipline that never had a rate", async () => {
    // A blank box on an unrated role is an honest gap, not a request to store
    // a rate of nothing.
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    await waitFor(() => expect(saveRoleRates).toHaveBeenCalled());
    const sent: { role: string }[] = saveRoleRates.mock.calls[0][1];
    expect(sent.map((r) => r.role)).toEqual(["firmware"]);
  });

  it("says that an emptied box removes the rate", async () => {
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openPanel(user);

    expect(screen.getByText(/Emptying a box removes that rate when you save/)).toBeInTheDocument();
    expect(screen.queryByText(/An empty box stays empty/)).not.toBeInTheDocument();
  });
});

describe("a save the server refuses", () => {
  it("puts the stored rates back rather than keeping the refused ones", async () => {
    saveRoleRates.mockRejectedValue({ status: 403, offline: false });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openPanel(user);

    fireEvent.change(rateBox("Firmware engineer"), { target: { value: "90" } });
    await user.click(screen.getByRole("button", { name: "Save rates" }));
    await waitFor(() => expect(setToast).toHaveBeenCalled());

    // Closed and reopened: the panel seeds its boxes from what the page holds
    // as stored. Before the fix that was the refused 90.
    await user.click(await panelButton());
    await user.click(await panelButton());
    await screen.findByText("Firmware engineer");
    expect(rateBox("Firmware engineer")).toHaveValue(80);
  });
});
