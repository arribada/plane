/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Three places the Finance sheet said less than it was about to do.
 *
 * Removing a decided purchase request deletes the expense line its approval
 * wrote — money, not paperwork — and the confirm named only "the audit trail".
 * Rejecting a request fired on the click, so the requester learned "no" and
 * never why, while the server had a `decision_note` nobody could fill. And the
 * currency toggle pressed itself before the read it asked for, so a failed read
 * left it naming one currency over figures in another.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewBudgetBlock, removalConfirmText } from "./budget-block";
import type { TProcurementRequest } from "@/plane-web/types/arribada";

const { decidePurchase, withdrawPurchase, getProcurement, getBudget, getCurrencySettings, setToast } = vi.hoisted(
  () => ({
    decidePurchase: vi.fn(),
    withdrawPurchase: vi.fn(),
    getProcurement: vi.fn(),
    getBudget: vi.fn(),
    getCurrencySettings: vi.fn(),
    setToast: vi.fn(),
  })
);

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

/** The same budget read in sterling, which is what makes the toggle appear. */
const BUDGET_READ_IN_GBP = {
  ...BUDGET,
  display: {
    currency: "GBP",
    rate: 0.85,
    rate_captured_on: null,
    rate_configured: true,
    converted: false,
    allocation: 10000,
    committed: 0,
    remaining: 10000,
    percent: 0,
    labour_total: 0,
    expenses_planned: 0,
    expenses_actual: 0,
    unconvertible: [],
  },
};

const request = (over: Partial<TProcurementRequest>): TProcurementRequest => ({
  id: "req-1",
  label: "10 Linkit boards",
  amount: 250,
  quantity: 10,
  total: 2500,
  currency: "GBP",
  category: "hardware",
  status: "pending",
  supplier: "",
  justification: "",
  needed_by: null,
  requested_by: "u-1",
  requested_by_name: "Grant",
  decided_by_name: null,
  decided_at: null,
  decision_note: "",
  expense_id: null,
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getBudget = getBudget;
    getExpenses = vi.fn(async () => ({ expenses: [] }));
    getRoleRates = vi.fn(async () => ({ rates: [], known_roles: [], presets: [] }));
    getCalendar = vi.fn(async () => ({ days: [] }));
    getProcurement = getProcurement;
    getCurrencySettings = getCurrencySettings;
    decidePurchase = decidePurchase;
    withdrawPurchase = withdrawPurchase;
  },
}));

/** The figure exactly as the sheet prints it, whatever locale the runner has. */
const gbp = (amount: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(amount);

beforeEach(() => {
  decidePurchase.mockReset();
  withdrawPurchase.mockReset();
  getProcurement.mockReset();
  getBudget.mockReset();
  getCurrencySettings.mockReset();
  setToast.mockReset();
  decidePurchase.mockResolvedValue({});
  withdrawPurchase.mockResolvedValue({ deleted: true });
  getBudget.mockResolvedValue(BUDGET);
  getCurrencySettings.mockResolvedValue(null);
  getProcurement.mockResolvedValue({ requests: [request({})], can_approve: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const openDecided = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByText(/decided purchase request/));
};

describe("removing a decided purchase request", () => {
  it("names the expense line that goes with an approved request", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    getProcurement.mockResolvedValue({
      requests: [request({ status: "approved", expense_id: "exp-1", decided_by_name: "Nadia" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    const asked = confirm.mock.calls[0][0] as string;
    expect(asked).toContain(`the ${gbp(2500)} expense line it created`);
    expect(asked).toMatch(/Both go/);
    // Saying no is honoured.
    expect(withdrawPurchase).not.toHaveBeenCalled();
  });

  it("says the expense line is kept once the purchase was ordered", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    getProcurement.mockResolvedValue({
      requests: [request({ status: "ordered", ordered_on: "2027-03-02", expense_id: "exp-1" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const asked = confirm.mock.calls[0][0] as string;
    expect(asked).toContain(`The ${gbp(2500)} expense line it created is kept on the sheet`);
    expect(asked).not.toMatch(/Both go/);
  });

  it("names no money on a request that never created a line", () => {
    const text = removalConfirmText(request({ status: "rejected", expense_id: null }));
    expect(text).not.toMatch(/expense line/);
    expect(text).toMatch(/audit trail for it goes with it/);
  });
});

describe("rejecting a purchase request", () => {
  it("asks for a reason before the decision goes out, and sends it", async () => {
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await user.click(await screen.findByRole("button", { name: "Reject 10 Linkit boards" }));

    // Nothing has been decided yet.
    expect(decidePurchase).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason for rejecting 10 Linkit boards"), {
      target: { value: "Over budget this quarter" },
    });
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    await waitFor(() => expect(decidePurchase).toHaveBeenCalledTimes(1));
    expect(decidePurchase).toHaveBeenCalledWith("arribada", "gps", "req-1", "rejected", "Over budget this quarter");
  });

  it("can be backed out of without deciding anything", async () => {
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await user.click(await screen.findByRole("button", { name: "Reject 10 Linkit boards" }));
    await user.click(screen.getByRole("button", { name: "Keep it pending" }));

    expect(decidePurchase).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Reason for rejecting 10 Linkit boards")).not.toBeInTheDocument();
  });

  it("shows the requester the reason on the decided list", async () => {
    getProcurement.mockResolvedValue({
      requests: [
        request({
          status: "rejected",
          decided_by_name: "Nadia",
          decided_at: "2026-08-02T00:00:00Z",
          decision_note: "Over budget this quarter",
        }),
      ],
      // The requester, who cannot approve, is the reader this is for.
      can_approve: false,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);

    expect(await screen.findByText(/Over budget this quarter/)).toBeInTheDocument();
    expect(screen.getByText(/Reason:/)).toBeInTheDocument();
  });
});

describe("the currency toggle", () => {
  it("goes back to the currency the figures are in when the read fails", async () => {
    getBudget.mockResolvedValueOnce(BUDGET_READ_IN_GBP).mockRejectedValue({ status: 500, offline: false });
    getCurrencySettings.mockResolvedValue({
      display_currency: "GBP",
      eur_gbp_rate: 0.85,
      rate_captured_on: null,
      configured: true,
      available: ["EUR", "GBP"],
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);

    const sterling = await screen.findByRole("button", { name: "GBP", pressed: true });
    await user.click(screen.getByRole("button", { name: "EUR" }));

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(setToast.mock.calls[0][0]).toMatchObject({ type: "error" });
    expect(sterling).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "EUR" })).toHaveAttribute("aria-pressed", "false");
  });
});
