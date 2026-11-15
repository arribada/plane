/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Three ways this card misreported a project.
 *
 * The tasks view swallowed its failure and drew zeros; nothing reset `counts`
 * or `budget` on a change of project, so A's numbers sat under B's name when
 * B's call failed; and every money rejection — a 500, a dropped connection —
 * became "Budget is not available to you", which told a lead with a money role
 * that they had none. Every failure test here fails against pre-fix HEAD.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSpotlightWidget } from "./project-spotlight-widget";

const { getProjectAnalyticsCount, getBudget } = vi.hoisted(() => ({
  getProjectAnalyticsCount: vi.fn(),
  getBudget: vi.fn(),
}));

vi.mock("@/services/project", () => ({
  ProjectService: class {
    getProjectAnalyticsCount = getProjectAnalyticsCount;
  },
}));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getBudget = getBudget;
  },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));

const PROJECTS: Record<string, string> = { gps: "Sea Turtle Tag GPS", camera: "Sea Turtle Tag Camera" };
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    joinedProjectIds: Object.keys(PROJECTS),
    getProjectById: (id: string) => (PROJECTS[id] ? { id, name: PROJECTS[id] } : undefined),
  }),
}));

const NOT_AVAILABLE = /Budget is not available to you/;

beforeEach(() => {
  // The chosen project and view are remembered per browser; forget between tests.
  window.localStorage.clear();
  getProjectAnalyticsCount.mockResolvedValue([{ id: "gps", total_issues: 12, completed_issues: 3 }]);
  getBudget.mockResolvedValue({ display: { allocation: 1000, committed: 250, remaining: 750, currency: "GBP" } });
});

describe("ProjectSpotlightWidget", () => {
  it("shows the first project's task counts", async () => {
    render(<ProjectSpotlightWidget />);
    expect(await screen.findByText("12")).toBeInTheDocument();
  });

  it("does not leave project A's numbers under project B's name when B's call fails", async () => {
    const user = userEvent.setup();
    getProjectAnalyticsCount.mockImplementation((_slug: string, params: { project_ids: string }) =>
      params.project_ids === "gps"
        ? Promise.resolve([{ id: "gps", total_issues: 12, completed_issues: 3 }])
        : Promise.reject({ status: 500, offline: false })
    );
    render(<ProjectSpotlightWidget />);
    expect(await screen.findByText("12")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "camera");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Sea Turtle Tag Camera/);
    expect(screen.queryByText("12")).not.toBeInTheDocument();
  });

  it("says the budget is not available to you only when the server refused (403)", async () => {
    const user = userEvent.setup();
    getBudget.mockRejectedValue({ status: 403, offline: false, error: "You do not have a money role." });
    render(<ProjectSpotlightWidget />);

    await user.click(await screen.findByRole("button", { name: "Budget" }));

    expect(await screen.findByText(NOT_AVAILABLE)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does NOT tell a lead the budget is not theirs when the server fell over", async () => {
    const user = userEvent.setup();
    getBudget.mockRejectedValue({ status: 500, offline: false });
    render(<ProjectSpotlightWidget />);

    await user.click(await screen.findByRole("button", { name: "Budget" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(NOT_AVAILABLE)).not.toBeInTheDocument();
  });

  it("says a dropped connection is a dropped connection, and offers a retry", async () => {
    const user = userEvent.setup();
    getBudget.mockRejectedValueOnce({ offline: true, status: undefined });
    render(<ProjectSpotlightWidget />);

    await user.click(await screen.findByRole("button", { name: "Budget" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.queryByText(NOT_AVAILABLE)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Allocated")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
