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
  google_drive_links: [],
  chat_url: null,
  github_repo_urls: [],
};

const THREE_FOLDERS = {
  ...EMPTY_DOC,
  google_drive_url: "https://drive.google.com/drive/folders/field",
  google_drive_links: [
    { url: "https://drive.google.com/drive/folders/field", label: "Field data" },
    { url: "https://drive.google.com/drive/folders/cad", label: "CAD" },
    // The shape every link migrated from the old single column has: no label,
    // because nobody was ever asked for one.
    { url: "https://drive.google.com/drive/folders/legacy", label: "" },
  ],
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

describe("several Google Drive folders", () => {
  it("draws every one of them, not just the first", async () => {
    // The whole feature. One project's files are field data, CAD and the reports
    // a funder reads — and the panel used to render exactly one link.
    allowPermissions.mockReturnValue(true);
    getWikiDoc.mockResolvedValue(THREE_FOLDERS);
    render(<WikiLinksPanel />);

    expect(await screen.findByRole("link", { name: /Field data/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /CAD/ })).toBeInTheDocument();
  });

  it("gives an unlabelled link something to be told apart by", async () => {
    // Three bare Drive URLs all reading "Open the Drive folder" is a list nobody
    // can use, which is the state every migrated row starts in.
    allowPermissions.mockReturnValue(true);
    getWikiDoc.mockResolvedValue(THREE_FOLDERS);
    render(<WikiLinksPanel />);

    await screen.findByRole("link", { name: /Field data/ });
    expect(screen.getByRole("link", { name: /folders\/legacy/ })).toBeInTheDocument();
  });

  it("adds a link with its label, and keeps the ones already there", async () => {
    // Sent as the whole list. Sending only the new entry would be the obvious
    // implementation and it deletes the other two.
    allowPermissions.mockReturnValue(true);
    getWikiDoc.mockResolvedValue(THREE_FOLDERS);
    setWikiDoc.mockResolvedValue(THREE_FOLDERS);
    render(<WikiLinksPanel />);

    await userEvent.click(await screen.findByRole("button", { name: /Add Drive link/ }));
    await userEvent.type(screen.getByPlaceholderText(/Label/), "Reports");
    await userEvent.type(screen.getByPlaceholderText(/drive\.google\.com/), "https://drive.google.com/r");
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(setWikiDoc).toHaveBeenCalled());
    const sent = setWikiDoc.mock.calls[0][2];
    expect(sent.google_drive_links).toHaveLength(4);
    expect(sent.google_drive_links[3]).toEqual({ url: "https://drive.google.com/r", label: "Reports" });
    expect(sent.google_drive_links[0].label).toBe("Field data");
  });

  it("removes only the link that was asked for", async () => {
    allowPermissions.mockReturnValue(true);
    getWikiDoc.mockResolvedValue(THREE_FOLDERS);
    setWikiDoc.mockResolvedValue(THREE_FOLDERS);
    render(<WikiLinksPanel />);

    await screen.findByRole("link", { name: /Field data/ });
    const removeButtons = screen.getAllByRole("button", { name: /Remove/ });
    await userEvent.click(removeButtons[0]);

    await waitFor(() => expect(setWikiDoc).toHaveBeenCalled());
    const sent = setWikiDoc.mock.calls[0][2];
    expect(sent.google_drive_links.map((l: { url: string }) => l.url)).toEqual([
      "https://drive.google.com/drive/folders/cad",
      "https://drive.google.com/drive/folders/legacy",
    ]);
  });

  it("offers no remove button to somebody the endpoint would refuse", async () => {
    allowPermissions.mockReturnValue(false);
    getWikiDoc.mockResolvedValue(THREE_FOLDERS);
    render(<WikiLinksPanel />);

    await screen.findByRole("link", { name: /Field data/ });
    expect(screen.queryByRole("button", { name: /Add Drive link/ })).not.toBeInTheDocument();
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
