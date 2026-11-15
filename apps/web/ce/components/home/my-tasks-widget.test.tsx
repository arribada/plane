/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Nothing assigned to you. Enjoy the calm." is good news, and the only load
 * this card makes used to fall to `setItems([])` on any failure — so a 403, a
 * 500 or a dropped connection landed everybody on the calm. The failure tests
 * below fail against pre-fix HEAD, which renders the reassurance in each.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyTasksWidget } from "./my-tasks-widget";

const { getMyWork } = vi.hoisted(() => ({ getMyWork: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getMyWork = getMyWork;
  },
}));
vi.mock("@/services/issue/issue.service", () => ({
  IssueService: class {
    patchIssue = vi.fn();
  },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({ setPeekIssue: vi.fn(), peekIssue: undefined }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ getProjectById: () => ({ name: "Sea Turtle Tag GPS" }) }),
}));
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({ data: { id: "user-1" } }) }));
// The create modal and the calendar reach for stores this card is not about.
vi.mock("@/components/issues/issue-modal/modal", () => ({ CreateUpdateIssueModal: () => null }));
vi.mock("./my-tasks-calendar", () => ({ MyTasksCalendar: () => null }));

const TASK = {
  id: "i-1",
  name: "Fit the saltwater switch",
  target_date: null,
  priority: "high" as const,
  sequence_id: 11,
  project_id: "gps",
  project_identifier: "GPS",
  project_name: "Sea Turtle Tag GPS",
};

const CALM = "Nothing assigned to you. Enjoy the calm.";

beforeEach(() => {
  getMyWork.mockResolvedValue([TASK]);
});

describe("MyTasksWidget", () => {
  it("lists what is assigned to you", async () => {
    render(<MyTasksWidget />);
    expect(await screen.findByText("Fit the saltwater switch")).toBeInTheDocument();
  });

  it("reassures you only when the list was actually read and is empty", async () => {
    getMyWork.mockResolvedValue([]);
    render(<MyTasksWidget />);
    expect(await screen.findByText(CALM)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does NOT reassure somebody whose request was refused", async () => {
    getMyWork.mockRejectedValue({ status: 403, offline: false, error: "Guests cannot see assignments." });
    render(<MyTasksWidget />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Guests cannot see assignments.");
    expect(screen.queryByText(CALM)).not.toBeInTheDocument();
  });

  it("does NOT reassure somebody whose connection dropped", async () => {
    getMyWork.mockRejectedValue({ offline: true, status: undefined });
    render(<MyTasksWidget />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.queryByText(CALM)).not.toBeInTheDocument();
  });

  it("offers a retry that asks again rather than making you reload the page", async () => {
    const user = userEvent.setup();
    getMyWork.mockRejectedValueOnce({ status: 500, offline: false });
    render(<MyTasksWidget />);

    await user.click(await screen.findByRole("button", { name: /Try again/ }));

    expect(await screen.findByText("Fit the saltwater switch")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
