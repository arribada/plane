/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One click on one row is one row's business.
 *
 * This page is a list of independent decisions that behaved like a single one.
 * `choice`, `owner` and `busyRows` all lived in the root, the row markup was
 * inline, and the `<option>` list — one per workspace project — was rebuilt
 * INSIDE every row on every render. So choosing a project on one row re-rendered
 * every row and re-created every option: about 2,900 elements on today's data,
 * and 300 rows × 540 projects — 168,000 — at the size this workspace is growing
 * towards.
 *
 * The fix is a memoised row, stable handlers and one shared option list. Two
 * things are worth pinning, and they are different things:
 *
 * * that the row is still memoised, and that the handlers it is given are stable
 *   — a fresh closure per render defeats `memo` silently, and the page looks
 *   exactly the same when it happens;
 * * that pulling the markup out of the parent did not change what the page does.
 *   A refactor this size is only safe if the behaviour is nailed down beside it.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubTriageRoot, TriageRow } from "./root";

const { getGithubTriageQueue, getGithubTriageArchive, fileGithubTriage, dismissGithubTriage } = vi.hoisted(() => ({
  getGithubTriageQueue: vi.fn(),
  getGithubTriageArchive: vi.fn(),
  fileGithubTriage: vi.fn(),
  dismissGithubTriage: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success" },
  setToast: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));
vi.mock("@plane/ui", () => ({ AlertModalCore: () => null }));
vi.mock("@/components/core/modals/existing-issues-list-modal", () => ({ ExistingIssuesListModal: () => null }));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getGithubTriageQueue = getGithubTriageQueue;
    getGithubTriageArchive = getGithubTriageArchive;
    fileGithubTriage = fileGithubTriage;
    dismissGithubTriage = dismissGithubTriage;
    restoreGithubTriage = vi.fn();
    claimGithubRepo = vi.fn();
  },
}));

const PROJECTS = [
  { id: "p-gps", name: "Sea Turtle Tag GPS" },
  { id: "p-cam", name: "Camera" },
  { id: "p-lora", name: "Sea Turtle Tag LoRa" },
];

const row = (n: number) => ({
  id: `row-${n}`,
  repo: "arribada/linkit",
  number: n,
  title: `Saltwater switch misreads #${n}`,
  html_url: `https://github.com/arribada/linkit/issues/${n}`,
  labels: [],
  github_assignees: [],
  milestone: "",
  state: "open",
  created_at: null,
  claimed_by: [],
  suggested_project: null,
  suggested_discipline: null,
});

const ITEMS = [row(1), row(2), row(3)];

beforeEach(() => {
  // `restoreMocks` only restores spies; a bare `vi.fn()` keeps its call log.
  for (const spy of [getGithubTriageQueue, getGithubTriageArchive, fileGithubTriage, dismissGithubTriage])
    spy.mockReset();
  getGithubTriageQueue.mockResolvedValue({ items: ITEMS, projects: PROJECTS });
  getGithubTriageArchive.mockResolvedValue({ items: [] });
  fileGithubTriage.mockResolvedValue({ filed: 1, skipped: 0 });
});

/** Every row's project `<select>`, in page order. */
const selects = () => screen.getAllByRole("combobox");

describe("the row is a component, not markup in a loop", () => {
  it("is memoised", () => {
    // Structural, and deliberately so: this is the property that makes the whole
    // change worth anything, and it is invisible from the DOM. Un-memoising it
    // leaves a page that renders identically and 60× more work per click.
    expect((TriageRow as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("takes its options as a prop rather than building them", async () => {
    // The parent builds the list once and hands the SAME elements to every row.
    // A row that maps `projects` itself cannot be given them, so this is the
    // shape assertion for "built once".
    const onChoose = vi.fn();
    render(
      <ul>
        <TriageRow
          item={row(1)}
          choiceId=""
          busy={false}
          projectOptions={<option value="p-gps">Sea Turtle Tag GPS</option>}
          onChoose={onChoose}
          onForget={vi.fn()}
          onPick={vi.fn()}
          onDismiss={vi.fn()}
          onSettle={vi.fn()}
        />
      </ul>
    );
    const select = screen.getByRole("combobox");
    expect(within(select).getAllByRole("option")).toHaveLength(2); // "Leave it here" + the one given
    await userEvent.selectOptions(select, "p-gps");
    expect(onChoose).toHaveBeenCalledWith("row-1", "p-gps");
  });
});

describe("the page still does what it did", () => {
  it("gives every row the whole project list", async () => {
    render(<GithubTriageRoot />);
    await screen.findByText(ITEMS[0].title);
    for (const select of selects()) {
      // "Leave it here" plus one per project.
      expect(within(select).getAllByRole("option")).toHaveLength(PROJECTS.length + 1);
    }
  });

  it("keeps one row's choice to itself", async () => {
    render(<GithubTriageRoot />);
    await screen.findByText(ITEMS[0].title);

    const [first, second, third] = selects();
    await userEvent.selectOptions(first, "p-gps");
    await userEvent.selectOptions(second, "p-cam");

    expect((first as HTMLSelectElement).value).toBe("p-gps");
    expect((second as HTMLSelectElement).value).toBe("p-cam");
    expect((third as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(/3 waiting · 2 chosen/)).toBeTruthy();
  });

  it("files exactly the rows that were chosen", async () => {
    render(<GithubTriageRoot />);
    await screen.findByText(ITEMS[0].title);

    await userEvent.selectOptions(selects()[0], "p-gps");
    await userEvent.selectOptions(selects()[2], "p-lora");
    await userEvent.click(screen.getByRole("button", { name: /^File 2$/ }));

    expect(fileGithubTriage).toHaveBeenCalledWith("arribada", [
      { id: "row-1", project_id: "p-gps", checklist_owner_id: undefined },
      { id: "row-3", project_id: "p-lora", checklist_owner_id: undefined },
    ]);
  });

  it("clears a row's checklist target when the project is taken back off it", async () => {
    render(<GithubTriageRoot />);
    await screen.findByText(ITEMS[0].title);

    const select = selects()[0];
    await userEvent.selectOptions(select, "p-gps");
    // With a project chosen the checklist button is live; with none it is not,
    // which is the state `onForget` exists to restore.
    expect(screen.getAllByRole("button", { name: /Its own work item/ })[0].hasAttribute("disabled")).toBe(false);

    await userEvent.selectOptions(select, "");
    expect(screen.getAllByRole("button", { name: /Its own work item/ })[0].hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/3 waiting · 0 chosen/)).toBeTruthy();
  });

  it("archives only the row whose button was pressed", async () => {
    dismissGithubTriage.mockResolvedValue({});
    render(<GithubTriageRoot />);
    await screen.findByText(ITEMS[1].title);

    await userEvent.click(screen.getByRole("button", { name: `Archive ${ITEMS[1].title} without filing it` }));

    expect(dismissGithubTriage).toHaveBeenCalledWith("arribada", ["row-2"]);
    expect(screen.queryByText(ITEMS[1].title)).toBeNull();
    expect(screen.getByText(ITEMS[0].title)).toBeTruthy();
  });
});
