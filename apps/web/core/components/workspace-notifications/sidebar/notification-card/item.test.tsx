/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A notification you cannot click is a number you cannot clear.
 *
 * Two guards used to sit on this component and both assumed every notification
 * comes from Plane's issue-activity pipeline. The render guard required
 * `notification.project`, which the GitHub triage warnings are raised WITHOUT on
 * purpose — no project has claimed the repo, that is the complaint. The click
 * guard required `data.issue.id`, which nothing this fork raises has ever
 * carried. So the triage rows drew nothing while still counting toward the
 * badge, and a click on an overdue reminder did not select it, did not open the
 * pane, and did not mark it read.
 *
 * These tests are written from the outside: render a row, click it, assert what
 * a person would see and what the store was told. They pin both directions —
 * that a notification with no work item is still clickable, AND that one with a
 * work item still peeks it.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationItem } from "./item";

const setCurrentSelectedNotificationId = vi.fn();
const markNotificationAsRead = vi.fn(() => Promise.resolve());
const setPeekIssue = vi.fn();

/** The row under test, swapped per case. */
let current: Record<string, unknown>;

vi.mock("@/hooks/store/notifications", () => ({
  useWorkspaceNotifications: () => ({
    currentSelectedNotificationId: undefined,
    setCurrentSelectedNotificationId,
  }),
}));

vi.mock("@/hooks/store/notifications/use-notification", () => ({
  useNotification: () => ({ asJson: current, markNotificationAsRead }),
}));

vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({ getIsIssuePeeked: () => false, setPeekIssue }),
}));

vi.mock("@/hooks/store/use-workspace", () => ({
  useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "workspace-1", slug: "arribada" }) }),
}));

// The snooze menu reaches for four more stores and a portal; none of it has
// anything to say about whether a row is on the screen or what clicking it does.
vi.mock("./options", () => ({ NotificationOption: () => null }));

// A ProseMirror instance for a card that is not rendering a comment.
vi.mock("@/components/editor/lite-text", () => ({ LiteTextEditor: () => null }));

const renderItem = () => render(<NotificationItem workspaceSlug="arribada" notificationId="n-1" />);

beforeEach(() => {
  setCurrentSelectedNotificationId.mockClear();
  markNotificationAsRead.mockClear();
  setPeekIssue.mockClear();
});

/** The daily "N unclassified GitHub tasks" digest, exactly as the task writes it:
 *  no project, no entity, no `data`. */
const digest = {
  id: "n-1",
  title: "7 unclassified GitHub tasks",
  message_html: "<p><b>7</b> GitHub issue(s) belong to no project yet.</p>",
  message: null,
  data: null,
  project: null,
  sender: "in_app:github_triage_digest",
  entity_identifier: null,
  read_at: null,
  snoozed_till: null,
  archived_at: null,
  created_at: "2026-08-01T06:30:00Z",
  is_inbox_issue: false,
  triggered_by_details: null,
};

/** The overdue reminder, as the task writes it now: a project and a work item,
 *  but no `data.issue.id` — the pane is this fork's own panel, not a peek. */
const reminder = {
  ...digest,
  title: "Sea Turtle Tag · TAG-42 — overdue since 1 Aug (In progress)",
  message_html: "",
  message: { reminder: "overdue", target_date: "2026-08-01", project: "Sea Turtle Tag" },
  data: { issue: { name: "Fix the antenna mount", identifier: "TAG", sequence_id: 42, state_name: "In progress" } },
  project: "project-1",
  sender: "in_app:reminder",
  entity_identifier: "issue-9",
};

/** An ordinary upstream activity notification, which peeks. */
const activity = {
  ...digest,
  title: "updated the state to",
  project: "project-1",
  sender: "in_app:issue-activities",
  data: {
    issue: { id: "issue-9", name: "Fix the antenna mount", identifier: "TAG", sequence_id: 42 },
    issue_activity: { field: "state", verb: "updated", new_value: "In progress", old_value: "Backlog" },
  },
};

describe("a notification with no project", () => {
  it("is on the screen at all", () => {
    current = digest;
    renderItem();
    expect(screen.getByText(/7 unclassified GitHub tasks/)).toBeTruthy();
  });

  it("selects itself and marks itself read when clicked", async () => {
    current = digest;
    renderItem();

    await userEvent.click(screen.getByText(/7 unclassified GitHub tasks/));

    expect(setCurrentSelectedNotificationId).toHaveBeenCalledWith("n-1");
    expect(markNotificationAsRead).toHaveBeenCalledWith("arribada");
    // Nothing to peek, and asking for one would open a blank overlay.
    expect(setPeekIssue).not.toHaveBeenCalledWith(expect.objectContaining({ issueId: expect.anything() }));
  });
});

describe("the overdue reminder", () => {
  it("is clickable even though it carries no work item id", async () => {
    current = reminder;
    renderItem();

    await userEvent.click(screen.getByText(/overdue since 1 Aug/));

    expect(setCurrentSelectedNotificationId).toHaveBeenCalledWith("n-1");
    expect(markNotificationAsRead).toHaveBeenCalledWith("arribada");
  });

  it("says project, work item and status", () => {
    current = reminder;
    const { container } = renderItem();

    expect(screen.getByText(/Sea Turtle Tag · TAG-42 — overdue since 1 Aug \(In progress\)/)).toBeTruthy();
    // The subtitle line, from `data.issue`.
    expect(container.textContent).toContain("TAG-42");
    expect(container.textContent).toContain("Fix the antenna mount");
  });

  it("never renders its JSON `message` as a body", () => {
    // `message` is a JSONField and the reminder task puts a dict in it. Handed to
    // dangerouslySetInnerHTML that paints the literal text "[object Object]".
    current = reminder;
    const { container } = renderItem();
    expect(container.textContent).not.toContain("[object Object]");
  });
});

describe("a notification with no `data` at all", () => {
  it("does not render a bare hyphen where the work item reference goes", () => {
    // The subtitle interpolated `identifier`-`sequence_id` unconditionally, so a
    // notification without `data` wore a lone "-" under its title.
    //
    // This fixture keeps its project on purpose. The digest has none, and before
    // the render guard was lifted it drew nothing at all — so asserting the
    // subtitle on THAT row would pass against the broken version by inspecting an
    // empty document, which is the trap this whole file exists to avoid.
    current = { ...reminder, data: null };
    const { container } = renderItem();
    expect(container.textContent).not.toMatch(/undefined/);
    const subtitle = container.querySelectorAll("div.line-clamp-1");
    const last = subtitle[subtitle.length - 1];
    expect((last?.textContent ?? "").replace(/\s| /g, "")).toBe("");
  });
});

describe("an ordinary upstream activity", () => {
  it("still peeks its work item — the fix must not cost the behaviour it had", async () => {
    current = activity;
    const { container } = renderItem();

    await userEvent.click(container.querySelector(".group") as Element);

    expect(setCurrentSelectedNotificationId).toHaveBeenCalledWith("n-1");
    expect(setPeekIssue).toHaveBeenCalledWith({
      workspaceSlug: "arribada",
      projectId: "project-1",
      issueId: "issue-9",
    });
  });
});
