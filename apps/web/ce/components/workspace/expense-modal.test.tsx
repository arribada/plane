/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The date an expense line carries, and whether the form sends one at all.
 *
 * No form ever set `incurred_on`, so every expense in the instance was
 * "undated". The spend curve and the monthly rhythm place a line by that date
 * and leave undated lines out — which was 100 % of the non-labour spend. The
 * Finance chart's "Spent" line sat flat at zero under a caption saying N
 * expenses had no date, where N was all of them.
 *
 * These tests are about what the form SENDS. Every one of them fails against
 * the pre-fix form, whose payload had no `incurred_on` key.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenseModal, localIsoDay } from "./expense-modal";
import type { TProjectExpense } from "@/plane-web/types/arribada";

const { addExpense, updateExpense, requestPurchase, setToast } = vi.hoisted(() => ({
  addExpense: vi.fn(),
  updateExpense: vi.fn(),
  requestPurchase: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));
// The dialog chrome is headless-ui with transitions; none of it is under test
// and a portal would only make the form harder to find.
vi.mock("@plane/ui", () => ({
  EModalWidth: { XXL: "xxl" },
  ModalCore: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}));
// Stable references, as the mobx store gives: the modal's reset effect depends
// on `getProjectById`, and a mock that minted a new function per render would
// re-run it on every render — a loop the store never produces.
const PROJECT_STORE = {
  joinedProjectIds: ["gps"],
  getProjectById: (id: string) => ({ id, name: "Sea Turtle Tag GPS", identifier: "GPS" }),
};
vi.mock("@/hooks/store/use-project", () => ({ useProject: () => PROJECT_STORE }));
vi.mock("@/services/project", () => ({
  ProjectService: class {
    projectIssuesSearch = vi.fn(async () => []);
  },
}));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    addExpense = addExpense;
    updateExpense = updateExpense;
    requestPurchase = requestPurchase;
  },
}));

const LINE: TProjectExpense = {
  id: "exp-1",
  category: "hardware",
  label: "10 Linkit boards",
  amount: 250,
  quantity: 10,
  total: 2500,
  currency: "GBP",
  planned: false,
  incurred_on: "2026-03-04",
  notes: "",
  url: "",
  manufacturer_part_number: "",
};

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Enough of a line to be submittable. */
const describeLine = () => {
  fill("What do you need?", "10 Linkit boards");
  fill("Unit price", "250");
};

beforeEach(() => {
  addExpense.mockReset();
  updateExpense.mockReset();
  requestPurchase.mockReset();
  setToast.mockReset();
  addExpense.mockResolvedValue(LINE);
  updateExpense.mockResolvedValue(LINE);
  requestPurchase.mockResolvedValue({});
});

const draw = (over: Partial<React.ComponentProps<typeof ExpenseModal>> = {}) =>
  render(<ExpenseModal isOpen onClose={vi.fn()} workspaceSlug="arribada" projectId="gps" mode="record" {...over} />);

describe("the date on a recorded line", () => {
  it("dates a line marked spent with today when no date was typed", async () => {
    const user = userEvent.setup();
    draw();
    describeLine();
    await user.click(screen.getByRole("checkbox", { name: /Already spent/ }));
    await user.click(screen.getByRole("button", { name: "Add the line" }));

    await waitFor(() => expect(addExpense).toHaveBeenCalledTimes(1));
    expect(addExpense.mock.calls[0][2]).toMatchObject({ planned: false, incurred_on: localIsoDay() });
  });

  it("uses the reader's own calendar day, not the UTC one", () => {
    // 23:30 on 4 March in Los Angeles (the suite's pinned zone) is 5 March UTC.
    // A receipt is dated where it was written.
    expect(localIsoDay(new Date(2026, 2, 4, 23, 30))).toBe("2026-03-04");
  });

  it("sends a typed date rather than today", async () => {
    const user = userEvent.setup();
    draw();
    describeLine();
    fill("Incurred on", "2026-03-04");
    await user.click(screen.getByRole("checkbox", { name: /Already spent/ }));
    await user.click(screen.getByRole("button", { name: "Add the line" }));

    await waitFor(() => expect(addExpense).toHaveBeenCalled());
    expect(addExpense.mock.calls[0][2].incurred_on).toBe("2026-03-04");
  });

  it("sends null, not an empty string, for a budgeted line with no date", async () => {
    // The server parses YYYY-MM-DD and ignores anything else; "" would be a
    // silent no-op, and `undefined` would mean the key is missing — which is the
    // bug this file exists for.
    const user = userEvent.setup();
    draw();
    describeLine();
    await user.click(screen.getByRole("button", { name: "Add the line" }));

    await waitFor(() => expect(addExpense).toHaveBeenCalled());
    const sent = addExpense.mock.calls[0][2];
    expect(sent.planned).toBe(true);
    expect("incurred_on" in sent).toBe(true);
    expect(sent.incurred_on).toBeNull();
  });

  it("prefills the date when editing and sends it back on save", async () => {
    const user = userEvent.setup();
    draw({ expense: LINE });

    expect(screen.getByLabelText("Incurred on")).toHaveValue("2026-03-04");
    fill("Incurred on", "2026-03-09");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
    expect(updateExpense.mock.calls[0][3]).toMatchObject({ incurred_on: "2026-03-09", planned: false });
  });

  it("does not offer the field on a purchase request", () => {
    // A request is dated by the decision that approves it, on the server.
    draw({ mode: "request" });
    expect(screen.queryByLabelText("Incurred on")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Needed by")).toBeInTheDocument();
  });
});
