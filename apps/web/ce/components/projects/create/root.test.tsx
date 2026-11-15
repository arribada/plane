/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The extras the create-project wizard writes once the project exists.
 *
 * It offered USD, which the server refuses — and refuses BEFORE it writes
 * anything else in the same PATCH. One request carried the status, the dates
 * and the budget, so picking dollars lost the plan as well as the money, and
 * the warning collapsed the loss into "budget/dates". Now the plan and the
 * budget travel separately, the dropdown offers only what the server keeps
 * (`DISPLAY_CURRENCIES`), and a refusal names the half that was refused.
 *
 * Everything around the form — the name and identifier fields, the member
 * picker, the cover image — is somebody else's and is stubbed; under test is
 * what reaches the schedule endpoint.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectForm } from "./root";

const { createProject, updateProject, updateSchedule, setToast } = vi.hoisted(() => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  updateSchedule: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success", WARNING: "warning", INFO: "info" },
  setToast,
}));
vi.mock("@/components/project/create/common-attributes", () => ({ default: () => null }));
vi.mock("@/components/project/create/header", () => ({ default: () => null }));
vi.mock("@/components/project/create/project-create-buttons", () => ({
  default: () => <button type="submit">Create project</button>,
}));
vi.mock("@/components/dropdowns/member/dropdown", () => ({ MemberDropdown: () => null }));
vi.mock("./attributes", () => ({ ProjectAttributes: () => null }));
vi.mock("@/helpers/cover-image.helper", () => ({
  getRandomCoverImage: () => "https://images.example/cover.jpg",
  getCoverImageType: () => "unsplash",
  uploadCoverImage: vi.fn(),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ addProjectToFavorites: vi.fn(), createProject, updateProject }),
}));
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({ data: { id: "u-1" } }) }));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("@/services/project/project-member.service", () => ({
  ProjectMemberService: class {
    bulkAddMembersToProject = vi.fn(async () => ({}));
  },
}));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    updateSchedule = updateSchedule;
  },
}));

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const draw = () => {
  const handleNextStep = vi.fn();
  render(
    <CreateProjectForm
      workspaceSlug="arribada"
      onClose={vi.fn()}
      handleNextStep={handleNextStep}
      updateCoverImageStatus={vi.fn(async () => undefined)}
    />
  );
  return { handleNextStep };
};

beforeEach(() => {
  createProject.mockReset();
  updateProject.mockReset();
  updateSchedule.mockReset();
  setToast.mockReset();
  createProject.mockResolvedValue({ id: "p-new" });
  updateProject.mockResolvedValue({});
  updateSchedule.mockResolvedValue({});
});

describe("the extras a new project is given", () => {
  it("offers only the currencies the server will hold a budget in", () => {
    draw();
    const offered = within(screen.getByLabelText("Budget currency"))
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(offered).toEqual(["EUR", "GBP"]);
  });

  it("sends the plan and the budget as two requests", async () => {
    const user = userEvent.setup();
    const { handleNextStep } = draw();
    fill("Start date", "2026-01-05");
    fill("Budget amount", "5000");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(handleNextStep).toHaveBeenCalledWith("p-new"));
    expect(updateSchedule).toHaveBeenCalledTimes(2);
    expect(updateSchedule.mock.calls[0].slice(0, 3)).toEqual([
      "arribada",
      "p-new",
      { lifecycle_status: "active", start_date: "2026-01-05" },
    ]);
    expect(updateSchedule.mock.calls[1].slice(0, 3)).toEqual([
      "arribada",
      "p-new",
      { budget_amount: 5000, budget_currency: "EUR" },
    ]);
  });

  it("keeps the plan when the budget is refused, and says which half was", async () => {
    updateSchedule.mockResolvedValueOnce({}).mockRejectedValueOnce({ status: 400, offline: false });
    const user = userEvent.setup();
    const { handleNextStep } = draw();
    fill("Start date", "2026-01-05");
    fill("Budget amount", "5000");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(handleNextStep).toHaveBeenCalled());
    const warning = setToast.mock.calls.map((call) => call[0]).find((toast) => toast.type === "warning");
    expect(warning?.message).toMatch(/budget/);
    expect(warning?.message).not.toMatch(/dates/);
  });

  it("sends nothing to the schedule when no extra was filled in", async () => {
    // A plain create stays a plain create.
    const user = userEvent.setup();
    const { handleNextStep } = draw();
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(handleNextStep).toHaveBeenCalled());
    expect(updateSchedule).not.toHaveBeenCalled();
  });
});
