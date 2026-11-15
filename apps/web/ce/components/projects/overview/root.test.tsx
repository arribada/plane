/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which of the Overview's controls are offered to whom.
 *
 * "Clean project" erases a project's items and was offered to every role; the
 * endpoint behind it is project ADMIN. A member got a confirm dialog about
 * erasing the project and then a 403 — the shape HANDOVER records three times:
 * a control the client draws that the server will refuse.
 *
 * Every section of the page is stubbed: what is under test is one button's
 * presence, decided by the same permission helper the money block uses.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { ProjectOverviewRoot } from "./root";

const { allowPermissions, getProjectOverview } = vi.hoisted(() => ({
  allowPermissions: vi.fn(),
  getProjectOverview: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada", projectId: "gps" }) }));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ allowPermissions }) }));
vi.mock("@/plane-web/components/pages/wiki-links-panel", () => ({ WikiLinksPanel: () => null }));
vi.mock("@/plane-web/components/planning/ai-plan-modal", () => ({ AiPlanModal: () => null }));
vi.mock("@/plane-web/components/planning/ai-settings-modal", () => ({ AiSettingsModal: () => null }));
vi.mock("@/plane-web/components/planning/project-setup-wizard", () => ({ ProjectSetupWizard: () => null }));
vi.mock("./clean-project-modal", () => ({ CleanProjectModal: () => null }));
vi.mock("./jump-bar", () => ({ OverviewJumpBar: () => null }));
vi.mock("./budget-block", () => ({ OverviewBudgetBlock: () => null }));
vi.mock("./kpi-tiles", () => ({ OverviewKpiTiles: () => null }));
vi.mock("./progress-sections", () => ({ OverviewProgressSections: () => null }));
vi.mock("./print-annex", () => ({ OverviewPrintAnnex: () => null }));
vi.mock("./public-link-block", () => ({ OverviewPublicLinkBlock: () => null }));
vi.mock("./recent-pages", () => ({ OverviewRecentPages: () => null }));
vi.mock("./section", () => ({
  OverviewSection: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./summary", () => ({ OverviewSummary: () => null }));
vi.mock("./team-block", () => ({ OverviewTeamBlock: () => null }));
vi.mock("./warnings-panel", () => ({ ProjectWarningsPanel: () => null }));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getProjectOverview = getProjectOverview;
  },
}));

const OVERVIEW = {
  project: { id: "gps", name: "Sea Turtle Tag GPS", identifier: "GPS", page_view: false },
  schedule: { start_date: null, target_date: null },
  derived: { start_date: null, target_date: null },
  items: { total: 0, completed: 0, started: 0, overdue: 0, undated: 0 },
  cycles: [],
  modules: [],
  pages: { count: 0, recent: [] },
  links: { wiki_url: null, drive_url: null, chat_url: null, github_repo_urls: [] },
  status: null,
  team: [],
  member_count: 0,
  warnings: [],
};

/** Grant everything except, optionally, project admin — the clean gate. */
const grant = (projectAdmin: boolean) =>
  allowPermissions.mockImplementation((roles: number[], level: string) => {
    const asksForProjectAdmin =
      level === EUserPermissionsLevel.PROJECT && roles.length === 1 && roles[0] === EUserPermissions.ADMIN;
    return asksForProjectAdmin ? projectAdmin : true;
  });

beforeEach(() => {
  allowPermissions.mockReset();
  getProjectOverview.mockReset();
  getProjectOverview.mockResolvedValue(OVERVIEW);
});

describe("the Clean project button", () => {
  it("is offered to a project admin", async () => {
    grant(true);
    render(<ProjectOverviewRoot />);
    expect(await screen.findByRole("button", { name: /Clean project/ })).toBeInTheDocument();
  });

  it("is not offered to anyone the endpoint would refuse", async () => {
    grant(false);
    render(<ProjectOverviewRoot />);
    // The page rendered — this is a hidden button, not a blank page.
    await screen.findByRole("button", { name: /Project setup wizard/ });
    expect(screen.queryByRole("button", { name: /Clean project/ })).not.toBeInTheDocument();
  });
});
