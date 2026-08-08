/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The worst shape of the silent-failure class, pinned.
 *
 * This modal answers one question — "which of our schedules can be read without
 * a login?" — and the service behind it ended `.catch(() => [])`. So a 500, a
 * 403 or a phone losing signal produced an empty list, and an empty list renders
 * "Nothing is published. No project schedule in this workspace can be read
 * without an account.": a categorical claim about what this organisation is
 * exposing to the internet, made from a request nobody ever saw fail.
 *
 * The third test below fails against pre-fix HEAD, where it renders exactly that
 * reassurance.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishedLinksModal } from "./published-links-modal";

const { getWorkspacePublicTimelines } = vi.hoisted(() => ({ getWorkspacePublicTimelines: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getWorkspacePublicTimelines = getWorkspacePublicTimelines;
  },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));

const LINKS = [
  {
    anchor: "abc123",
    project_name: "Sea Turtle Tag GPS",
    created_by_name: "Ruby",
    created_at: "2026-05-04T09:00:00Z",
  },
];

beforeEach(() => {
  getWorkspacePublicTimelines.mockResolvedValue(LINKS);
});

/** The claim this modal must never make on the strength of a failed request. */
const REASSURANCE = /Nothing is published/;

describe("PublishedLinksModal", () => {
  it("lists what is readable without a login", async () => {
    render(<PublishedLinksModal isOpen onClose={vi.fn()} />);
    expect(await screen.findByText("Sea Turtle Tag GPS")).toBeInTheDocument();
  });

  it("says nothing is published when the workspace genuinely publishes nothing", async () => {
    getWorkspacePublicTimelines.mockResolvedValue([]);
    render(<PublishedLinksModal isOpen onClose={vi.fn()} />);
    // The reassurance is correct HERE, and only here: the list was read.
    expect(await screen.findByText(REASSURANCE)).toBeInTheDocument();
  });

  it("does NOT claim nothing is published when the request failed", async () => {
    getWorkspacePublicTimelines.mockRejectedValue({ status: 500, offline: false });
    render(<PublishedLinksModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't read the published list/);
    expect(screen.queryByText(REASSURANCE)).not.toBeInTheDocument();
  });

  it("names a dropped connection rather than blaming the workspace", async () => {
    getWorkspacePublicTimelines.mockRejectedValue({ offline: true, status: undefined });
    render(<PublishedLinksModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.queryByText(REASSURANCE)).not.toBeInTheDocument();
  });

  it("shows the server's own explanation when it gave one", async () => {
    getWorkspacePublicTimelines.mockRejectedValue({
      status: 403,
      offline: false,
      error: "Only workspace members can see this.",
    });
    render(<PublishedLinksModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Only workspace members can see this.");
  });
});
