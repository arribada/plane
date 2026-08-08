/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Every empty state on these cards is good news, which is why a failed load may
 * never borrow one.
 *
 * All four fetches ended `.catch(() => setRows([]))` and `WidgetShell` had no
 * error state in its props at all, so there was nowhere for a failure to go even
 * if one had been caught. A guest who gets a 403 from `getMyApprovals` was shown
 * "No purchase requests need your decision" on the landing page — the same
 * sentence as somebody with a genuinely clear queue.
 *
 * The failure tests below fail against pre-fix HEAD, which renders the
 * reassurance in every one of them.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictsWidget, MyApprovalsWidget } from "./arribada-widgets";

const { getMyApprovals, getWorkloadTimeline } = vi.hoisted(() => ({
  getMyApprovals: vi.fn(),
  getWorkloadTimeline: vi.fn(),
}));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getMyApprovals = getMyApprovals;
    getWorkloadTimeline = getWorkloadTimeline;
    getWorkspaceDeliverables = vi.fn();
    getPortfolio = vi.fn();
    getGithubInboxGap = vi.fn();
    githubSyncNow = vi.fn();
  },
}));
vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success", INFO: "info" },
  setToast: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));

const APPROVAL = {
  id: "req-1",
  label: "Iridium modems ×4",
  total: 1840,
  currency: "GBP",
  requested_by_name: "Ruby",
  project_id: "gps",
  project_name: "Sea Turtle Tag GPS",
};

/** The two sentences these cards must never say about a request that failed. */
const NOTHING_TO_APPROVE = "No purchase requests need your decision.";
const NOBODY_CLASHING = /Nobody is on two things at once/;

beforeEach(() => {
  getMyApprovals.mockResolvedValue([APPROVAL]);
  getWorkloadTimeline.mockResolvedValue({ people: [] });
});

describe("MyApprovalsWidget", () => {
  it("lists what is waiting on you", async () => {
    render(<MyApprovalsWidget />);
    expect(await screen.findByText("Iridium modems ×4")).toBeInTheDocument();
  });

  it("reassures you only when the queue was actually read and is empty", async () => {
    getMyApprovals.mockResolvedValue([]);
    render(<MyApprovalsWidget />);
    expect(await screen.findByText(NOTHING_TO_APPROVE)).toBeInTheDocument();
  });

  it("does NOT reassure a guest whose request was refused", async () => {
    getMyApprovals.mockRejectedValue({ status: 403, offline: false, error: "Guests cannot see procurement." });
    render(<MyApprovalsWidget />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Guests cannot see procurement.");
    expect(screen.queryByText(NOTHING_TO_APPROVE)).not.toBeInTheDocument();
  });

  it("does NOT reassure somebody whose connection dropped", async () => {
    getMyApprovals.mockRejectedValue({ offline: true, status: undefined });
    render(<MyApprovalsWidget />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.queryByText(NOTHING_TO_APPROVE)).not.toBeInTheDocument();
  });

  it("offers a retry that asks again rather than making you reload the page", async () => {
    const user = userEvent.setup();
    getMyApprovals.mockRejectedValueOnce({ status: 500, offline: false });
    render(<MyApprovalsWidget />);

    await user.click(await screen.findByRole("button", { name: /Try again/ }));

    expect(await screen.findByText("Iridium modems ×4")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ConflictsWidget", () => {
  it("does NOT say nobody is double-booked when the workload call failed", async () => {
    getWorkloadTimeline.mockRejectedValue({ status: 500, offline: false });
    render(<ConflictsWidget />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(NOBODY_CLASHING)).not.toBeInTheDocument();
  });

  it("still says nobody is double-booked when that is what the server answered", async () => {
    render(<ConflictsWidget />);
    expect(await screen.findByText(NOBODY_CLASHING)).toBeInTheDocument();
  });
});
