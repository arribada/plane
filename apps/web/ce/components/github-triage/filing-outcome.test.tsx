/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A refusal reported as good news.
 *
 * The filing endpoint silently counted a project the caller could not write to
 * into `skipped`, and this page explained the whole of `skipped` in a GREEN
 * SUCCESS TOAST as "N were left — they had already been filed elsewhere". It had
 * no way of knowing that, and for a refused project it was simply false. Somebody
 * clearing a morning's backlog was told their work had landed when none of it
 * had, and the only way to discover otherwise was to go and open the project.
 *
 * The endpoint answers 403 now and files nothing, so the refusal arrives in the
 * `catch`. What is left in `skipped` is the honest case — a row that left the
 * queue under us — and even that is not a success: it is a warning that names the
 * number twice, so nobody reads "12 filed" off a toast that filed nine.
 *
 * Both classes are pinned below, and both fail against HEAD.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubTriageRoot } from "./root";

const { getGithubTriageQueue, getGithubTriageArchive, fileGithubTriage, setToast } = vi.hoisted(() => ({
  getGithubTriageQueue: vi.fn(),
  getGithubTriageArchive: vi.fn(),
  fileGithubTriage: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success", INFO: "info", WARNING: "warning" },
  setToast,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));
vi.mock("@plane/ui", () => ({ AlertModalCore: () => null }));
vi.mock("@/components/core/modals/existing-issues-list-modal", () => ({ ExistingIssuesListModal: () => null }));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getGithubTriageQueue = getGithubTriageQueue;
    getGithubTriageArchive = getGithubTriageArchive;
    fileGithubTriage = fileGithubTriage;
    dismissGithubTriage = vi.fn();
    restoreGithubTriage = vi.fn();
    claimGithubRepo = vi.fn();
  },
}));

const PROJECTS = [{ id: "p-gps", name: "Sea Turtle Tag GPS" }];

const ITEMS = [
  {
    id: "row-1",
    repo: "arribada/linkit",
    number: 41,
    title: "Saltwater switch bounces",
    html_url: "https://github.com/arribada/linkit/issues/41",
    labels: [],
    github_assignees: [],
    milestone: "",
    state: "open",
    created_at: null,
    claimed_by: [],
    suggested_project: null,
    suggested_discipline: null,
  },
];

beforeEach(() => {
  for (const spy of [getGithubTriageQueue, getGithubTriageArchive, fileGithubTriage, setToast]) spy.mockReset();
  getGithubTriageQueue.mockResolvedValue({ items: ITEMS, projects: PROJECTS });
  getGithubTriageArchive.mockResolvedValue({ items: [] });
});

/** Choose a destination for the one row, then press File. */
const fileOne = async () => {
  render(<GithubTriageRoot />);
  await screen.findByText(ITEMS[0].title);
  await userEvent.selectOptions(screen.getByRole("combobox"), "p-gps");
  await userEvent.click(screen.getByRole("button", { name: /^File 1$/ }));
};

describe("filing that the server refused", () => {
  it("is an error, not a green tick", async () => {
    // The exact shape the endpoint now answers with: 403, nothing filed.
    fileGithubTriage.mockRejectedValue({
      status: 403,
      offline: false,
      error: "You cannot file work items into Someone else's. Nothing was filed.",
    });
    await fileOne();

    expect(setToast).toHaveBeenCalledTimes(1);
    expect(setToast.mock.calls[0][0].type).toBe("error");
  });

  it("repeats the server's reason instead of inventing one", async () => {
    // "they had already been filed elsewhere" was a guess the page made about a
    // number it did not understand. The server knows why; say that.
    fileGithubTriage.mockRejectedValue({
      status: 403,
      offline: false,
      error: "You cannot file work items into Someone else's. Nothing was filed.",
    });
    await fileOne();

    expect(setToast.mock.calls[0][0].message).toMatch(/Someone else's/);
    expect(setToast.mock.calls[0][0].message).not.toMatch(/already been filed/);
  });

  it("says the request never reached the server when it did not", async () => {
    // A dropped connection used to fall through the same `?? "Nothing was moved."`
    // as a 403 and read as a decision the server had taken.
    fileGithubTriage.mockRejectedValue({ offline: true });
    await fileOne();

    expect(setToast.mock.calls[0][0].type).toBe("error");
    expect(setToast.mock.calls[0][0].message).toMatch(/offline/i);
  });

  it("keeps the choices on screen so the batch can be retried", async () => {
    fileGithubTriage.mockRejectedValue({ status: 403, offline: false, error: "no" });
    await fileOne();

    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("p-gps");
    expect(screen.getByRole("button", { name: /^File 1$/ })).toBeInTheDocument();
  });
});

describe("filing that partly succeeded", () => {
  it("does not announce a partial result as a success", async () => {
    fileGithubTriage.mockResolvedValue({ filed: 9, skipped: 3 });
    await fileOne();

    expect(setToast.mock.calls[0][0].type).not.toBe("success");
  });

  it("names both numbers, so nobody reads only the good one", async () => {
    fileGithubTriage.mockResolvedValue({ filed: 9, skipped: 3 });
    await fileOne();

    expect(setToast.mock.calls[0][0].title).toMatch(/9 filed/);
    expect(setToast.mock.calls[0][0].title).toMatch(/3 not/);
  });

  it("no longer claims to know that the rest were filed elsewhere", async () => {
    fileGithubTriage.mockResolvedValue({ filed: 9, skipped: 3 });
    await fileOne();

    expect(setToast.mock.calls[0][0].message).not.toMatch(/already been filed elsewhere/);
  });

  it("is still a plain success when everything landed", async () => {
    // Without this, every assertion above would also pass on a page that had
    // simply stopped saying anything good ever happened.
    fileGithubTriage.mockResolvedValue({ filed: 1, skipped: 0 });
    await fileOne();

    expect(setToast.mock.calls[0][0].type).toBe("success");
    expect(setToast.mock.calls[0][0].title).toMatch(/^1 filed$/);
  });
});
