/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The control that did not exist, in the list that lied about it.
 *
 * `service.trackPurchase` had zero call sites. The backend PATCH, the four model
 * fields, the `ordered`/`received` statuses and their migrations were all in
 * place — only the thing a person presses was missing. So an approved purchase
 * could never be marked ordered or received; the decided list drew both of those
 * states as "Rejected", in red, because it decided with a two-way ternary; and
 * "Let the schedule wait for deliveries" could not do anything at all, since
 * auto-schedule builds its floors from `expected_on`/`received_on` and nothing in
 * the product could write them.
 *
 * `helpers.test.ts` pins the pill's rule in isolation. This file pins it where a
 * reader actually meets it — rendered, in the audit list — and pins the control
 * that fills the dates in.
 *
 * Every test here fails against HEAD: there is no tracking control to find, and
 * the `ordered` row renders as "Rejected".
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewBudgetBlock } from "./budget-block";

const { trackPurchase, getProcurement, setToast } = vi.hoisted(() => ({
  trackPurchase: vi.fn(),
  getProcurement: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success", WARNING: "warning" },
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
  schedule_from_deliveries: true,
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

const request = (over: Record<string, unknown>) => ({
  id: "req-1",
  label: "10 Linkit boards",
  amount: 250,
  quantity: 10,
  total: 2500,
  currency: "GBP",
  category: "hardware",
  status: "approved",
  supplier: "",
  justification: "",
  needed_by: null,
  order_reference: "",
  ordered_on: null,
  expected_on: null,
  received_on: null,
  issue_id: "issue-1",
  requested_by: "u-1",
  requested_by_name: "Grant",
  decided_by_name: "Nadia",
  decided_at: "2026-08-02T00:00:00Z",
  decision_note: "",
  expense_id: "exp-1",
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getBudget = vi.fn(async () => BUDGET);
    getExpenses = vi.fn(async () => ({ expenses: [] }));
    getRoleRates = vi.fn(async () => ({ rates: [], known_roles: [], presets: [] }));
    getCalendar = vi.fn(async () => ({ days: [] }));
    getProcurement = getProcurement;
    getCurrencySettings = vi.fn(async () => null);
    trackPurchase = trackPurchase;
    decidePurchase = vi.fn();
  },
}));

beforeEach(() => {
  trackPurchase.mockReset();
  getProcurement.mockReset();
  setToast.mockReset();
  trackPurchase.mockResolvedValue({});
  getProcurement.mockResolvedValue({ requests: [request({})], can_approve: true });
});

/**
 * Set one field of the order form.
 *
 * `fireEvent.change` rather than `userEvent.type`: typing a date character by
 * character is ~10 events per field and made these the slowest tests in the web
 * suite — slow enough to breach vitest's 5 s default under a loaded CI runner,
 * which is a failure about the runner and not about the code. Nothing here is
 * testing the keyboard; what is under test is what the form sends.
 */
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** The decided list is behind a `<details>`; open it the way a reader would. */
const openDecided = async (user: ReturnType<typeof userEvent.setup>) => {
  const summary = await screen.findByText(/decided purchase request/);
  await user.click(summary);
};

const trackButton = async () => await screen.findByRole("button", { name: /the order for 10 Linkit boards/ });

describe("the decided-purchase list", () => {
  it("does not call an ordered purchase a rejected one", async () => {
    // The bug as a grant reviewer met it: a purchase the organisation placed,
    // drawn in red under the word "Rejected".
    getProcurement.mockResolvedValue({
      requests: [request({ status: "ordered", ordered_on: "2027-03-02" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);

    expect(await screen.findByText("Ordered")).toBeInTheDocument();
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument();
  });

  it("does not call a received purchase a rejected one either", async () => {
    getProcurement.mockResolvedValue({
      requests: [request({ status: "received", received_on: "2027-03-20" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);

    expect(await screen.findByText("Received")).toBeInTheDocument();
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument();
  });

  it("still calls a rejected purchase rejected", async () => {
    // Otherwise both tests above would pass on a list that had stopped saying it.
    getProcurement.mockResolvedValue({
      requests: [request({ status: "rejected", expense_id: null })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);

    expect(await screen.findByText("Rejected")).toBeInTheDocument();
  });

  it("credits the decision to whoever took it, whatever happened afterwards", async () => {
    // "ordered by Nadia" would be wrong — the lead approved it, somebody else
    // placed the order.
    getProcurement.mockResolvedValue({
      requests: [request({ status: "received", received_on: "2027-03-20" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);

    expect(await screen.findByText(/approved by Nadia/)).toBeInTheDocument();
  });

  it("offers no order tracking on a request that was refused", async () => {
    getProcurement.mockResolvedValue({
      requests: [request({ status: "rejected", expense_id: null })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);

    await screen.findByText("Rejected");
    expect(screen.queryByRole("button", { name: /the order for/ })).not.toBeInTheDocument();
  });
});

describe("recording what happened to an approved purchase", () => {
  it("sends the order details the schedule reads", async () => {
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);
    await user.click(await trackButton());

    fill("Order reference", "PO-2026-014");
    fill("Ordered on", "2027-03-02");
    fill("Expected", "2027-04-12");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(trackPurchase).toHaveBeenCalledTimes(1));
    expect(trackPurchase).toHaveBeenCalledWith("arribada", "gps", "req-1", {
      status: "ordered",
      order_reference: "PO-2026-014",
      ordered_on: "2027-03-02",
      expected_on: "2027-04-12",
      received_on: null,
    });
  });

  it("moves the request to received once the parts are on the bench", async () => {
    // Derived from the dates rather than picked separately: a dropdown saying
    // "ordered" beside a date saying the parts arrived is two answers to one
    // question, and the scheduler reads the dates.
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);
    await user.click(await trackButton());

    fill("Ordered on", "2027-03-02");
    fill("Arrived", "2027-03-20");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(trackPurchase).toHaveBeenCalled());
    expect(trackPurchase.mock.calls[0][3]).toMatchObject({ status: "received", received_on: "2027-03-20" });
  });

  it("sends an emptied date as null rather than as an empty string", async () => {
    // The server parses YYYY-MM-DD and silently ignores anything else, so ""
    // would leave yesterday's promised date sitting in the schedule's floor.
    getProcurement.mockResolvedValue({
      requests: [request({ status: "ordered", ordered_on: "2027-03-02", expected_on: "2027-04-12" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);
    await user.click(await trackButton());

    fill("Expected", "");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(trackPurchase).toHaveBeenCalled());
    expect(trackPurchase.mock.calls[0][3].expected_on).toBeNull();
  });

  it("seeds the form with what is already recorded", async () => {
    // An edit form that opens empty reads as "nothing was ever saved", and the
    // save that follows wipes the fields the reader did not retype.
    getProcurement.mockResolvedValue({
      requests: [request({ status: "ordered", order_reference: "PO-2026-014", ordered_on: "2027-03-02" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);
    await user.click(await trackButton());

    expect(screen.getByLabelText("Order reference")).toHaveValue("PO-2026-014");
    expect(screen.getByLabelText("Ordered on")).toHaveValue("2027-03-02");
  });

  it("keeps the typed dates on screen when the server refuses", async () => {
    // The one thing worse than not saving is not saving quietly and then losing
    // what was typed, so the reader cannot even retry without re-deriving it.
    trackPurchase.mockRejectedValue({ status: 403, offline: false, error: "Not your project" });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);
    await user.click(await trackButton());

    fill("Ordered on", "2027-03-02");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(setToast.mock.calls[0][0]).toMatchObject({ type: "error" });
    expect(screen.getByLabelText("Ordered on")).toHaveValue("2027-03-02");
  });

  it("shows what was recorded without opening the form", async () => {
    // The dates are the reason the row exists. Hiding them behind an edit control
    // means a reader has to enter edit mode to read a fact.
    getProcurement.mockResolvedValue({
      requests: [request({ status: "ordered", order_reference: "PO-2026-014", expected_on: "2027-04-12" })],
      can_approve: true,
    });
    const user = userEvent.setup();
    render(<OverviewBudgetBlock />);
    await openDecided(user);

    const list = await screen.findByRole("list", { name: undefined });
    expect(within(list).getByText(/PO-2026-014/)).toBeInTheDocument();
  });
});
