/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A panel that offered every pencil and refused every save.
 *
 * `ProjectWikiDocEndpoint.put` moved to `level="PROJECT"` when the permission
 * class was fixed. This panel's `canEdit` did not move with it: it still asked
 * whether the caller was an ADMIN or MEMBER of the WORKSPACE. So a workspace
 * member who is a guest on the project — or a workspace admin who never joined it
 * — saw every edit control, typed a URL, and got a 403 whose message told them
 * "only workspace members and admins can edit", which they already were.
 *
 * The 403 branch that says it could never fire before the endpoint moved; now it
 * fires, and it says something the reader can only read as the product being
 * broken. Both halves are fixed and pinned here: the gate asks the question the
 * server answers, and the refusal names the level the server decides on.
 *
 * Both tests fail against HEAD.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikiLinksPanel } from "./wiki-links-panel";

const { allowPermissions, getWikiDoc, setWikiDoc, setToast } = vi.hoisted(() => ({
  allowPermissions: vi.fn(),
  getWikiDoc: vi.fn(),
  setWikiDoc: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success", INFO: "info", WARNING: "warning" },
  setToast,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada", projectId: "gps" }) }));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ allowPermissions }) }));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getWikiDoc = getWikiDoc;
    setWikiDoc = setWikiDoc;
    githubSyncNow = vi.fn();
  },
}));

const EMPTY_DOC = {
  doc_id: null,
  workspace_id: null,
  title: null,
  google_drive_url: null,
  chat_url: null,
  github_repo_urls: [],
};

beforeEach(() => {
  for (const spy of [allowPermissions, getWikiDoc, setWikiDoc, setToast]) spy.mockReset();
  getWikiDoc.mockResolvedValue(EMPTY_DOC);
  setWikiDoc.mockResolvedValue(EMPTY_DOC);
});

describe("who is shown the edit controls", () => {
  it("asks about this project, not about the workspace", async () => {
    // The server decides on the caller's role IN THIS PROJECT. Asking a different
    // question is how the pencils came to be drawn for people the PUT refuses.
    allowPermissions.mockReturnValue(true);
    render(<WikiLinksPanel />);
    await screen.findAllByText(/Add link/);

    expect(allowPermissions).toHaveBeenCalled();
    const [, level, slug, projectId] = allowPermissions.mock.calls[0];
    expect(level).toBe("PROJECT");
    expect(slug).toBe("arribada");
    expect(projectId).toBe("gps");
  });

  it("draws no pencil for somebody the endpoint would refuse", async () => {
    // A control that can only 403 is worse than no control: it invites the work
    // and then throws it away.
    allowPermissions.mockReturnValue(false);
    render(<WikiLinksPanel />);
    await screen.findByText(/the project's wiki/i);

    expect(screen.queryByRole("button", { name: /Add link/ })).not.toBeInTheDocument();
  });
});

describe("what a refusal says", () => {
  it("names the level the server actually decides on", async () => {
    // "Only workspace members and admins can edit" was said TO a workspace member.
    allowPermissions.mockReturnValue(true);
    setWikiDoc.mockRejectedValue({ status: 403, offline: false });
    render(<WikiLinksPanel />);

    const buttons = await screen.findAllByRole("button", { name: /Add link/ });
    await userEvent.click(buttons[0]);
    await userEvent.type(screen.getByPlaceholderText("Wiki doc id or URL"), "some-doc-id");
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    const toast = setToast.mock.calls[0][0];
    expect(toast.type).toBe("error");
    expect(toast.message).toMatch(/project/i);
    expect(toast.message).not.toMatch(/workspace/i);
  });
});
