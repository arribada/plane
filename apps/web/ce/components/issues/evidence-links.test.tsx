/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Two ways the evidence box lied.
 *
 * A failed read ended `.catch(() => setRows([]))`, so a 403 or a dropped
 * connection read "Nothing linked yet" — a claim about the evidence made by a
 * request that never answered. And the remove button was `opacity-0
 * group-hover:opacity-100`: no hover on a touch screen, so a link could never
 * be taken off from a phone. Same class, same fix, as the checklist's button;
 * see panel.test.tsx for why a class-name assertion is allowed here and nowhere
 * else. Every test here fails against pre-fix HEAD.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueEvidenceLinks } from "./evidence-links";

const { getIssueArtifacts, removeIssueArtifact } = vi.hoisted(() => ({
  getIssueArtifacts: vi.fn(),
  removeIssueArtifact: vi.fn(),
}));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getIssueArtifacts = getIssueArtifacts;
    removeIssueArtifact = removeIssueArtifact;
    addIssueArtifact = vi.fn();
  },
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast: vi.fn() }));

const LINK = {
  id: "art-1",
  kind: "wiki" as const,
  url: "https://docs.arribada.org/saltwater-switch-test",
  label: "Saltwater switch test report",
  created_by_name: "Ruby",
};

const NOTHING_LINKED = /Nothing linked yet/;

const renderLinks = () => render(<IssueEvidenceLinks workspaceSlug="arribada" projectId="gps" issueId="issue-9" />);

beforeEach(() => {
  getIssueArtifacts.mockResolvedValue([LINK]);
  removeIssueArtifact.mockResolvedValue({});
});

describe("IssueEvidenceLinks", () => {
  it("says nothing is linked only when the server answered so", async () => {
    getIssueArtifacts.mockResolvedValue([]);
    renderLinks();
    expect(await screen.findByText(NOTHING_LINKED)).toBeInTheDocument();
  });

  it("does NOT say nothing is linked when the read was refused", async () => {
    getIssueArtifacts.mockRejectedValue({ status: 403, offline: false, error: "You cannot see this project." });
    renderLinks();

    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot see this project.");
    expect(screen.queryByText(NOTHING_LINKED)).not.toBeInTheDocument();
  });

  it("offers a retry that asks again", async () => {
    const user = userEvent.setup();
    getIssueArtifacts.mockRejectedValueOnce({ offline: true, status: undefined });
    renderLinks();

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Saltwater switch test report")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes a link when the button is pressed, with no hover first", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderLinks();

    await user.click(await screen.findByRole("button", { name: "Remove the link to Saltwater switch test report" }));

    expect(removeIssueArtifact).toHaveBeenCalledWith("arribada", "gps", "issue-9", "art-1");
  });

  it("does not hide the remove button behind a pointer", async () => {
    renderLinks();
    const button = await screen.findByRole("button", { name: "Remove the link to Saltwater switch test report" });

    // See the file header: a class-name assertion, allowed exactly here.
    expect(button.className).not.toMatch(/\bopacity-0\b/);
    expect(button.className).not.toMatch(/group-hover:opacity-/);
  });
});
