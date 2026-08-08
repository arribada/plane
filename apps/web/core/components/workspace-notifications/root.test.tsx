/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which panel opens beside the list.
 *
 * `arribada-detail.tsx` was written for exactly two notifications — the overdue
 * reminder and the GitHub triage digest — and had never rendered once. It is
 * reached only when a notification is SELECTED, and the only thing that selects
 * one is a click handler that used to require `data.issue.id`, a field neither
 * of them carries. A whole panel, a per-row project picker and a filing endpoint
 * behind it, all unreachable because of a guard three files away.
 *
 * So this asserts the routing decision itself: given a selected notification of
 * each shape, which of the three panels the pane shows. Upstream's peek is
 * included on purpose — the same decision has to keep sending work items there.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsRoot } from "./root";

const notifications: Record<string, Record<string, unknown>> = {
  "reminder-1": {
    id: "reminder-1",
    title: "Sea Turtle Tag · TAG-42 — overdue since 1 Aug (In progress)",
    message_html: "",
    sender: "in_app:reminder",
    entity_identifier: "issue-9",
    project: "project-1",
    data: { issue: { name: "Fix the antenna mount", identifier: "TAG", sequence_id: 42 } },
  },
  "digest-1": {
    id: "digest-1",
    title: "7 unclassified GitHub tasks",
    message_html: "<p>7 GitHub issue(s) belong to no project yet.</p>",
    sender: "in_app:github_triage_digest",
    entity_identifier: null,
    project: null,
    data: null,
  },
  "activity-1": {
    id: "activity-1",
    title: "updated the state to",
    sender: "in_app:issue-activities",
    project: "project-1",
    data: { issue: { id: "issue-9" } },
  },
};

let selectedId: string | undefined;

vi.mock("swr", () => ({ default: () => ({ isLoading: false, data: undefined }) }));

vi.mock("@/hooks/store/notifications", () => ({
  useWorkspaceNotifications: () => ({
    currentSelectedNotificationId: selectedId,
    setCurrentSelectedNotificationId: vi.fn(),
    notificationLiteByNotificationId: (id: string | undefined) => {
      const row = id ? notifications[id] : undefined;
      if (!row) return {};
      return {
        workspace_slug: "arribada",
        project_id: row.project,
        notification_id: row.id,
        // Exactly what the real store computes, and the whole decision below.
        issue_id: (row.data as { issue?: { id?: string } } | null)?.issue?.id,
        is_inbox_issue: false,
      };
    },
    notificationIdsByWorkspaceId: () => ["reminder-1"],
    getNotifications: vi.fn(),
    notifications,
  }),
}));

vi.mock("@/hooks/store/use-workspace", () => ({
  useWorkspace: () => ({ currentWorkspace: { id: "workspace-1", slug: "arribada" } }),
}));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ fetchUserProjectInfo: vi.fn() }) }));
vi.mock("@/hooks/use-workspace-issue-properties", () => ({ useWorkspaceIssueProperties: () => undefined }));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/plane-web/hooks/use-notification-preview", () => ({
  useNotificationPreview: () => ({
    isWorkItem: false,
    PeekOverviewComponent: () => <div>upstream peek</div>,
    setPeekWorkItem: vi.fn(),
  }),
}));
vi.mock("../inbox/content", () => ({ InboxContentRoot: () => <div>intake</div> }));

// The triage list behind the digest's project picker. Real network, otherwise.
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getGithubUnclassified = () =>
      Promise.resolve({
        items: [
          {
            id: "gh-1",
            name: "Antenna gain is 3 dB low",
            repo: "arribada/linkit-v4-core",
            number: 12,
            html_url: "https://github.com/arribada/linkit-v4-core/issues/12",
          },
        ],
        projects: [{ id: "project-1", name: "Sea Turtle Tag" }],
      });
    fileGithubTriage = () => Promise.resolve({ filed: 1 });
  },
}));

beforeEach(() => {
  selectedId = undefined;
});

describe("the pane beside the notification list", () => {
  it("shows the fork's own panel for an overdue reminder", () => {
    selectedId = "reminder-1";
    render(<NotificationsRoot workspaceSlug="arribada" />);

    expect(screen.getByText(/overdue since 1 Aug/)).toBeTruthy();
    // The panel's own affordance: a reminder knows its work item through
    // `entity_identifier`, even with no `data.issue.id` to peek.
    expect(screen.getByText(/Open the work item/)).toBeTruthy();
    expect(screen.queryByText("upstream peek")).toBeNull();
  });

  it("shows the triage list for the GitHub digest", async () => {
    selectedId = "digest-1";
    render(<NotificationsRoot workspaceSlug="arribada" />);

    expect(screen.getByText(/7 unclassified GitHub tasks/)).toBeTruthy();
    expect(screen.getByText(/File them into a project/)).toBeTruthy();
    // The rows only arrive once the endpoint answers; that they arrive at all is
    // the point — this list has never been on a screen.
    await waitFor(() => expect(screen.getByText(/Antenna gain is 3 dB low/)).toBeTruthy());
    expect(screen.getByLabelText(/Project for Antenna gain is 3 dB low/)).toBeTruthy();
  });

  it("still sends an ordinary work item to upstream's peek", () => {
    selectedId = "activity-1";
    render(<NotificationsRoot workspaceSlug="arribada" />);

    expect(screen.getByText("upstream peek")).toBeTruthy();
  });
});
