/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Taking somebody off a project roster used to be something the payload IMPLIED.
 *
 * The PUT was a full replace, so dropping a row from the draft deleted the
 * person. The draft is a snapshot taken when the editor opens — so a second
 * person editing the team, or one tab left open since this morning, and Save
 * silently removed everybody added in between. A roster row holds the only copy
 * of that person's leave, working pattern and holiday calendar; nothing else in
 * the product stores them, and there is no undo.
 *
 * So the request now names its removals, and the server asks the lead for them.
 * These tests are about what the editor SENDS. What the server does with it is
 * `plane/arribada/test_roster_removal.py`.
 *
 * Every test below fails against pre-fix HEAD, where `setProjectTeam` takes one
 * argument and removal is expressed by absence.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewTeamBlock } from "./team-block";
import type { TTeamMember } from "@/plane-web/types/arribada";

const { setProjectTeam, getProjectTeam, getWorkspaceDirectory, setToast } = vi.hoisted(() => ({
  setProjectTeam: vi.fn(),
  getProjectTeam: vi.fn(),
  getWorkspaceDirectory: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada", projectId: "gps" }) }));
vi.mock("@/hooks/store/use-member", () => ({
  useMember: () => ({
    project: { getProjectMemberIds: () => [], getProjectMemberDetails: () => null },
    workspace: { workspaceMemberIds: [], getWorkspaceMemberDetails: () => null },
  }),
}));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getProjectTeam = getProjectTeam;
    setProjectTeam = setProjectTeam;
    getWorkspaceDirectory = getWorkspaceDirectory;
  },
}));

const TEAM: TTeamMember[] = [
  {
    id: "row-ruby",
    member_id: null,
    name: "Ruby",
    email: "ruby@arribada.test",
    roles: ["firmware"],
    is_lead: true,
    in_plane: false,
    assignable: false,
  } as TTeamMember,
  {
    id: "row-grant",
    member_id: null,
    name: "Grant",
    email: "grant@arribada.test",
    roles: ["hardware"],
    is_lead: false,
    in_plane: false,
    assignable: false,
  } as TTeamMember,
];

/** Open the editor and wait for the roster round trip the editor makes. */
const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<OverviewTeamBlock projectId="gps" team={TEAM} />);
  await user.click(screen.getByRole("button", { name: /Edit team/i }));
  await waitFor(() => expect(getProjectTeam).toHaveBeenCalled());
  await screen.findByDisplayValue("Grant");
};

const save = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /Save team/i }));
  await waitFor(() => expect(setProjectTeam).toHaveBeenCalled());
};

/** The `remove` argument of the last PUT. */
const removedIds = () => setProjectTeam.mock.calls.at(-1)?.[3] ?? [];
/** The `team` argument of the last PUT. */
const sentNames = () => (setProjectTeam.mock.calls.at(-1)?.[2] ?? []).map((row: { name: string }) => row.name);

beforeEach(() => {
  setProjectTeam.mockReset();
  getProjectTeam.mockReset();
  getWorkspaceDirectory.mockReset();
  setToast.mockReset();
  getWorkspaceDirectory.mockResolvedValue({ people: [] });
  getProjectTeam.mockResolvedValue({ roles_vocabulary: [], team: TEAM });
  setProjectTeam.mockResolvedValue({ roles_vocabulary: [], team: TEAM });
});

describe("editing a project roster", () => {
  it("names the person it is removing rather than leaving them out", async () => {
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: /Remove Grant/i }));
    await save(user);

    expect(removedIds()).toEqual(["row-grant"]);
  });

  it("asks for no removals when nobody was removed", async () => {
    // The everyday save. A client that always sent a removal list built from
    // "who is not in the draft" would be the old bug wearing a new parameter.
    const user = userEvent.setup();
    await openEditor(user);
    await save(user);

    expect(removedIds()).toEqual([]);
    expect(sentNames()).toEqual(["Ruby", "Grant"]);
  });

  it("does not ask the server to remove a row that was never saved", async () => {
    // A blank row added and then thought better of has no id: there is nothing
    // for the server to remove, and sending an empty id would be asking it to
    // guess.
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: /Add someone by name/i }));
    const rows = screen.getAllByRole("button", { name: /^Remove /i });
    await user.click(rows[rows.length - 1]);
    await save(user);

    expect(removedIds()).toEqual([]);
  });

  it("tells the person what a 403 actually means", async () => {
    // Removals are the lead's. "Please try again" to that sends somebody round
    // the same loop forever.
    setProjectTeam.mockRejectedValue({ status: 403, offline: false });
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: /Remove Grant/i }));
    await save(user);

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(setToast.mock.calls.at(-1)?.[0].title).toMatch(/only the project lead/i);
  });

  it("keeps the editor open when the save fails, so nothing typed is lost", async () => {
    setProjectTeam.mockRejectedValue({ status: 500, offline: false });
    const user = userEvent.setup();
    await openEditor(user);
    await save(user);

    expect(screen.getByDisplayValue("Grant")).toBeInTheDocument();
  });
});
