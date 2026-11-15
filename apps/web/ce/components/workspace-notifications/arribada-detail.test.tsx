/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The digest's panel may not say the inbox is clear on a request that failed.
 *
 * A failed read of the unclassified queue fell to `setItems([])`, and the empty
 * state then said "Nothing is unclassified any more — everything in the inbox
 * belongs to a project": the one sentence that tells somebody to stop looking,
 * raised by a 500. The triage page already told failed from empty; this panel
 * now does the same. The routing to this panel is pinned in
 * core/components/workspace-notifications/root.test.tsx; this file is about
 * what the panel says once it is reached. The failure tests fail against
 * pre-fix HEAD.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArribadaNotificationDetail } from "./arribada-detail";

const { getGithubUnclassified } = vi.hoisted(() => ({ getGithubUnclassified: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getGithubUnclassified = getGithubUnclassified;
    fileGithubTriage = vi.fn();
  },
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast: vi.fn() }));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ push: vi.fn() }) }));

const QUEUE = {
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
};

const ALL_CLEAR = /Nothing is unclassified any more/;

const renderDigest = () =>
  render(
    <ArribadaNotificationDetail
      workspaceSlug="arribada"
      title="7 unclassified GitHub tasks"
      sender="in_app:github_triage_digest"
    />
  );

beforeEach(() => {
  getGithubUnclassified.mockResolvedValue(QUEUE);
});

describe("ArribadaNotificationDetail for the GitHub digest", () => {
  it("lists the queue with a project picker per row", async () => {
    renderDigest();
    expect(await screen.findByText("Antenna gain is 3 dB low")).toBeInTheDocument();
    expect(screen.getByLabelText("Project for Antenna gain is 3 dB low")).toBeInTheDocument();
  });

  it("says the inbox is clear only when the server answered so", async () => {
    getGithubUnclassified.mockResolvedValue({ items: [], projects: [] });
    renderDigest();
    expect(await screen.findByText(ALL_CLEAR)).toBeInTheDocument();
  });

  it("does NOT say the inbox is clear when the read failed", async () => {
    getGithubUnclassified.mockRejectedValue({ status: 500, offline: false, error: "GitHub sync is down." });
    renderDigest();

    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub sync is down.");
    expect(screen.queryByText(ALL_CLEAR)).not.toBeInTheDocument();
  });

  it("offers a retry that asks again", async () => {
    const user = userEvent.setup();
    getGithubUnclassified.mockRejectedValueOnce({ offline: true, status: undefined });
    renderDigest();
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Antenna gain is 3 dB low")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
