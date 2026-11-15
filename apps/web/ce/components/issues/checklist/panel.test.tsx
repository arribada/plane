/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Taking a line off a checklist, without a mouse pointer.
 *
 * The remove button carried `opacity-0 group-hover:opacity-100`. There is no
 * hover on a touch screen, and this button is the only way a line ever comes off
 * a checklist, so on a phone the feature did not exist. Fixed in 193ec34dfc by
 * drawing it always.
 *
 * READ THIS BEFORE COPYING THE PATTERN. The last assertion inspects a class name,
 * which this repo's tests otherwise refuse to do, and the reason it is allowed
 * here is narrow: jsdom loads no stylesheet, so the button is in the document and
 * clickable either way, and there is no computed opacity to read. The class IS
 * the whole mechanism of the bug and there is nothing else to look at. It is a
 * proxy — it pins this specific regression coming back and it proves nothing
 * about how the button actually paints. Anything about size, spacing or overlap
 * needs a real browser; do not reach for a class name to fake it.
 */
import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TIssueChecklistItem } from "@/plane-web/services/arribada.service";
import { IssueChecklistPanel } from "./panel";
import type { TChecklistHandle } from "./use-checklist";

const { setToast } = vi.hoisted(() => ({ setToast: vi.fn() }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));

const line: TIssueChecklistItem = {
  id: "line-1",
  issue_id: "issue-9",
  name: "Solder the antenna feed",
  sequence_id: 42,
  project_id: "project-1",
  project_identifier: "TAG",
  state_id: "state-1",
  done: false,
  target_date: null,
};

const remove = vi.fn(() => Promise.resolve());
const retry = vi.fn();
const toggle = vi.fn(() => Promise.resolve());

const handle: TChecklistHandle = {
  items: [line],
  loaded: true,
  loading: false,
  failed: null,
  retry,
  addByName: () => Promise.resolve(),
  addExisting: () => Promise.resolve(),
  remove,
  toggle,
};

/** What the hook answers for the test at hand; `handle` unless a test says otherwise. */
let current: TChecklistHandle = handle;

// The real hook reaches for a MobX store and three services over HTTP; none of
// that has anything to say about whether a button is on the screen.
vi.mock("./use-checklist", () => ({ useIssueChecklist: () => current }));

beforeEach(() => {
  current = handle;
  vi.clearAllMocks();
  toggle.mockResolvedValue(undefined);
});

const renderPanel = () =>
  render(
    <MemoryRouter>
      <IssueChecklistPanel workspaceSlug="arribada" projectId="project-1" issueId="issue-9" />
    </MemoryRouter>
  );

describe("IssueChecklistPanel", () => {
  it("removes a line when the button is pressed, with no hover first", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();

    // `user.click` does not hover first — it dispatches pointer and mouse events
    // straight at the target, which is what a finger does.
    await user.click(screen.getByRole("button", { name: "Take Solder the antenna feed off this checklist" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("line-1");
  });

  it("does not hide the remove button behind a pointer", () => {
    renderPanel();

    const button = screen.getByRole("button", { name: "Take Solder the antenna feed off this checklist" });

    // See the file header: a class-name assertion, allowed exactly here.
    expect(button.className).not.toMatch(/\bopacity-0\b/);
    expect(button.className).not.toMatch(/group-hover:opacity-/);
  });
});

/**
 * A read that failed is not an empty checklist.
 *
 * The cache used to hand the panel `items: []` after a failed read — exactly
 * what "no checklist" looks like — and the panel said "Nothing on it yet" on
 * the strength of a request that never answered. The first two tests fail
 * against pre-fix HEAD; so does the third, where the one useful message a tick
 * can fail with was being read from the wrong field and replaced by a generic one.
 */
describe("IssueChecklistPanel when the read failed", () => {
  const NOTHING_YET = /Nothing on it yet/;

  it("says the read failed rather than that the checklist is empty", () => {
    current = { ...handle, items: [], loaded: false, failed: "The server did not answer." };
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer.");
    expect(screen.queryByText(NOTHING_YET)).not.toBeInTheDocument();
  });

  it("offers to ask again", async () => {
    const user = userEvent.setup();
    current = { ...handle, items: [], loaded: false, failed: "The server did not answer." };
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it("still says the checklist is empty when that is what the server answered", () => {
    current = { ...handle, items: [] };
    renderPanel();

    expect(screen.getByText(NOTHING_YET)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("passes on WHY a tick was refused — a plain Error's message, not a generic line", async () => {
    const user = userEvent.setup();
    toggle.mockRejectedValue(new Error("No completed state in that project"));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Complete Solder the antenna feed" }));

    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: "No completed state in that project" })
    );
  });
});
