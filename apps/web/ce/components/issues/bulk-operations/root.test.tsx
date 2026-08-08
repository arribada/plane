/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A bulk action has to say what it did to each item.
 *
 * This file was the only write surface in the fork containing neither a
 * `setToast` nor any error state. Delete used `Promise.allSettled` for the right
 * reason — one failing item must not abandon the other eleven — and then
 * discarded the results by construction: `await Promise.allSettled(...)` with no
 * binding. Five rejections out of twelve cleared the selection and left five rows
 * on the board, which reads as "the delete didn't take", and the natural response
 * is to select them and press delete again on work that is already gone.
 *
 * Every test below fails against pre-fix HEAD, where nothing is reported at all.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { IssueBulkOperationsRoot } from "./root";

const { setToast, removeIssue, updateIssue, bulkArchiveIssues, adoptIssues, clearSelection } = vi.hoisted(() => ({
  setToast: vi.fn(),
  removeIssue: vi.fn(),
  updateIssue: vi.fn(),
  bulkArchiveIssues: vi.fn(),
  adoptIssues: vi.fn(),
  clearSelection: vi.fn(),
}));

/** Three work items in one project, the way a board hands them over. */
const ISSUES: Record<string, { id: string; name: string; project_id: string; sequence_id: number }> = {
  "i-1": { id: "i-1", name: "Fit the saltwater switch", project_id: "gps", sequence_id: 11 },
  "i-2": { id: "i-2", name: "Pot the enclosure", project_id: "gps", sequence_id: 12 },
  "i-3": { id: "i-3", name: "Field trial, Príncipe", project_id: "gps", sequence_id: 13 },
};

vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada", projectId: "gps" }) }));
vi.mock("@/hooks/store/use-multiple-select-store", () => ({
  useMultipleSelectStore: () => ({
    isSelectionActive: true,
    selectedEntityIds: ["i-1", "i-2", "i-3"],
    clearSelection,
  }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    joinedProjectIds: ["gps", "camera"],
    getProjectById: (id: string) =>
      id === "gps" ? { id, name: "Sea Turtle Tag GPS", identifier: "GPS" } : { id, name: "Camera", identifier: "CAM" },
  }),
}));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({
    updateIssue,
    removeIssue,
    issue: { getIssueById: (id: string) => ISSUES[id] },
  }),
}));
vi.mock("@/services/issue/issue.service", () => ({
  IssueService: class {
    bulkArchiveIssues = bulkArchiveIssues;
  },
}));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    adoptIssues = adoptIssues;
  },
}));
// The planner modal fetches workspace AI settings on mount and is not what these
// tests are about.
vi.mock("@/plane-web/components/planning/ai-plan-modal", () => ({ AiPlanModal: () => null }));

const helpers = { isSelectionDisabled: false } as unknown as TSelectionHelper;

/** Every toast raised, as one string, so an assertion can ask what was reported
 *  without caring which of title or message carried it. */
const reported = () => setToast.mock.calls.map((call) => JSON.stringify(call[0])).join(" | ");

beforeEach(() => {
  // `restoreMocks` strips implementations but not call history, and half the
  // assertions here are about what was NOT reported.
  vi.clearAllMocks();
  removeIssue.mockResolvedValue(undefined);
  updateIssue.mockResolvedValue(undefined);
  bulkArchiveIssues.mockResolvedValue({});
  adoptIssues.mockResolvedValue({ adopted: 3, parent_id: null, issues: [] });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // Archive and adopt refresh the view by reloading, which jsdom answers with a
  // "Not implemented: navigation" error. Neither is what is under test here.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "http://localhost/", origin: "http://localhost", reload: vi.fn() },
  });
});

const pressDelete = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<IssueBulkOperationsRoot selectionHelpers={helpers} />);
  await user.click(screen.getByRole("button", { name: /Delete/ }));
};

describe("bulk delete", () => {
  it("reports how many were deleted when every one succeeded", async () => {
    await pressDelete(userEvent.setup());
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    expect(reported()).toContain("Deleted 3");
  });

  it("names the items a PARTIAL failure left behind", async () => {
    // The shape of the real complaint: some of the batch is gone, some is not,
    // and the list on screen cannot tell you which.
    removeIssue.mockImplementation((_ws: string, _pid: string, id: string) =>
      id === "i-2"
        ? Promise.reject({ status: 403, offline: false, error: "You cannot delete that one." })
        : Promise.resolve()
    );

    await pressDelete(userEvent.setup());

    const said = reported();
    expect(said).toContain("Deleted 2 of 3");
    expect(said).toContain("1 failed");
    // By its key, so somebody can go and look at it.
    expect(said).toContain("GPS-12");
    expect(said).toContain("You cannot delete that one.");
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("still clears the selection on a partial failure — but no longer silently", async () => {
    removeIssue.mockRejectedValue({ status: 500, offline: false });
    await pressDelete(userEvent.setup());

    expect(clearSelection).toHaveBeenCalled();
    expect(reported()).toContain("Deleted 0 of 3");
  });

  it("says a dropped connection is a dropped connection", async () => {
    removeIssue.mockRejectedValue({ offline: true, status: undefined });
    await pressDelete(userEvent.setup());
    expect(reported()).toMatch(/offline/i);
  });

  it("deletes nothing and reports nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await pressDelete(userEvent.setup());

    expect(removeIssue).not.toHaveBeenCalled();
    expect(setToast).not.toHaveBeenCalled();
  });
});

describe("bulk archive", () => {
  it("says nothing was archived when the one request for the batch is refused", async () => {
    const user = userEvent.setup();
    bulkArchiveIssues.mockRejectedValue({ status: 500, offline: false });
    render(<IssueBulkOperationsRoot selectionHelpers={helpers} />);

    await user.click(screen.getByRole("button", { name: /Archive/ }));

    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(reported()).toContain("Nothing was archived");
  });
});

describe("bulk priority", () => {
  it("reports the items whose new priority is only on screen", async () => {
    // The store update is optimistic, so a rejected item shows the NEW priority
    // in the list while the server still holds the old one. Saying nothing means
    // the board and the database disagree and neither of them says so.
    const user = userEvent.setup();
    updateIssue.mockImplementation((_ws: string, _pid: string, id: string) =>
      id === "i-3" ? Promise.reject({ status: 500, offline: false }) : Promise.resolve()
    );
    render(<IssueBulkOperationsRoot selectionHelpers={helpers} />);

    await user.click(screen.getByRole("button", { name: /Priority/ }));
    await user.click(screen.getByRole("button", { name: "Urgent" }));

    const said = reported();
    expect(said).toContain("2 of 3");
    expect(said).toContain("GPS-13");
  });
});

describe("bulk adopt", () => {
  it("says so when the endpoint adopted only some of the selection", async () => {
    const user = userEvent.setup();
    adoptIssues.mockResolvedValue({ adopted: 1, parent_id: null, issues: [] });
    render(<IssueBulkOperationsRoot selectionHelpers={helpers} />);

    await user.click(screen.getByRole("button", { name: /Move to project/ }));
    await user.click(screen.getByRole("button", { name: "Camera" }));

    expect(reported()).toContain("Adopted 1 of 3");
  });
});
