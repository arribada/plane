/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Approve is the one button in this fork that spends money, and it had no
 * in-flight guard at all.
 *
 * No `disabled`, no pending state, nothing to look at while the request was
 * out — so two clicks were two POSTs. On the server, the idempotency check was
 * taken from a copy of the request read before its own transaction opened, so
 * both of them saw no expense line and both created one. The project paid twice
 * and the surviving duplicate was unreachable, because reject and delete both
 * clean up through the request's single pointer.
 *
 * The server is fixed and locks. This is the other half: the second request is
 * never sent, and — because a button that silently swallows a click is a button
 * somebody presses harder — it says so on screen.
 *
 * Both tests below fail against pre-fix HEAD, where the click handler is
 * `onClick={() => void decide(...)}` with no state around it.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewBudgetBlock } from "./budget-block";

const { decidePurchase, setToast } = vi.hoisted(() => ({
  decidePurchase: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada", projectId: "gps" }) }));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ getProjectById: () => ({ id: "gps", name: "Sea Turtle Tag GPS", identifier: "GPS" }) }),
}));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ allowPermissions: () => true }) }));
// Neither is under test and both would drag a chart library and a modal in with
// them; what is under test is one button in the purchase queue.
vi.mock("./spend-analysis", () => ({ SpendAnalysis: () => null }));
vi.mock("./spend-curve", () => ({ SpendCurve: () => null }));
vi.mock("@/plane-web/components/workspace/expense-modal", () => ({ ExpenseModal: () => null }));

const BUDGET = {
  display: null,
  span: { start_date: null, target_date: null },
  schedule_from_deliveries: false,
  allocation: {
    amount: 10000,
    currency: "GBP",
    committed: 0,
    remaining: 10000,
    percent: 0,
    excluded_currencies: [],
  },
  labour: { by_role: [], totals: [], unrated_roles: [] },
  expenses: { by_category: [], planned: [], actual: [], count: 0 },
};

const REQUEST = {
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
};

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getBudget = vi.fn(async () => BUDGET);
    getExpenses = vi.fn(async () => ({ expenses: [] }));
    getRoleRates = vi.fn(async () => ({ rates: [], known_roles: [], presets: [] }));
    getCalendar = vi.fn(async () => ({ days: [] }));
    getProcurement = vi.fn(async () => ({ requests: [REQUEST], can_approve: true }));
    getCurrencySettings = vi.fn(async () => null);
    decidePurchase = decidePurchase;
  },
}));

const approveButton = async () => await screen.findByRole("button", { name: /Approve 10 Linkit boards/ });

beforeEach(() => {
  decidePurchase.mockReset();
  setToast.mockReset();
});

describe("approving a purchase", () => {
  it("sends one request however many times the button is pressed", async () => {
    // A decision that never settles: the second and third clicks land while the
    // first is still out, which is exactly the double-click case.
    decidePurchase.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);

    const button = await approveButton();
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(decidePurchase).toHaveBeenCalledTimes(1);
  });

  it("says the decision is in flight rather than swallowing the click in silence", async () => {
    decidePurchase.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);

    const button = await approveButton();
    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent(/Saving/);
  });

  it("lets the next decision through once the first one has landed", async () => {
    // The guard is not a latch. A rule that only proved the first assertion would
    // also pass on a button that disabled itself forever.
    decidePurchase.mockResolvedValue({});
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);

    const button = await approveButton();
    await user.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    await user.click(button);

    expect(decidePurchase).toHaveBeenCalledTimes(2);
  });

  it("re-enables the button when the server refuses", async () => {
    decidePurchase.mockRejectedValue({ status: 403, offline: false });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);

    const button = await approveButton();
    await user.click(button);

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(button).not.toBeDisabled();
  });
});
