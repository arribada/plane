/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The roster cache behind the disciplines in an assignee dropdown.
 *
 * `invalidateProjectRoles` was exported and called from nowhere in the repository,
 * so saving a roster left every dropdown in the tab labelling people with the roles
 * they had before the save — for the rest of the session, because the cache is at
 * module scope and survives client-side navigation. And the failure path cached the
 * EMPTY answer, so one 502 meant no disciplines anywhere until a reload; its four
 * siblings all drop the entry and retry on the next mount.
 *
 * Each test uses its own project id: the cache and the revision counter are module
 * scope by design, which is the whole point of them, and sharing an id between two
 * tests would make one of them depend on the other having run.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjectTeam } = vi.hoisted(() => ({ getProjectTeam: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getProjectTeam = getProjectTeam;
  },
}));

const { invalidateProjectRoles, useProjectRoles } = await import("./use-project-roles");

const roster = (roles: string[]) => ({
  roles_vocabulary: [],
  team: [{ id: "row-1", member_id: "u1", name: "Ruby", email: "", roles, is_lead: false }],
});

/** Renders the label an assignee dropdown draws under a name. */
const Dropdown = ({ project }: { project: string }) => {
  const roles = useProjectRoles("arribada", project);
  return <span data-testid="roles">{roles.get("u1")?.join(", ") ?? "—"}</span>;
};

beforeEach(() => {
  getProjectTeam.mockReset();
});

describe("useProjectRoles", () => {
  it("costs one request however many dropdowns are on screen", async () => {
    getProjectTeam.mockResolvedValue(roster(["Firmware"]));
    render(
      <>
        <Dropdown project="p-shared" />
        <Dropdown project="p-shared" />
        <Dropdown project="p-shared" />
      </>
    );
    await waitFor(() => expect(screen.getAllByTestId("roles")[0]).toHaveTextContent("Firmware"));
    expect(getProjectTeam).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure as an empty roster", async () => {
    getProjectTeam.mockRejectedValueOnce(new Error("502"));
    const first = render(<Dropdown project="p-flaky" />);
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("—"));
    first.unmount();

    getProjectTeam.mockResolvedValue(roster(["H.C.C"]));
    render(<Dropdown project="p-flaky" />);
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("H.C.C"));
    expect(getProjectTeam).toHaveBeenCalledTimes(2);
  });

  it("keeps two projects' rosters apart", async () => {
    getProjectTeam.mockImplementation((_slug: string, projectId: string) =>
      Promise.resolve(roster([projectId === "p-a" ? "Firmware" : "Enclosure"]))
    );
    render(
      <>
        <Dropdown project="p-a" />
        <Dropdown project="p-b" />
      </>
    );
    await waitFor(() => {
      const [a, b] = screen.getAllByTestId("roles");
      expect(a).toHaveTextContent("Firmware");
      expect(b).toHaveTextContent("Enclosure");
    });
    expect(getProjectTeam).toHaveBeenCalledTimes(2);
  });
});

describe("invalidateProjectRoles", () => {
  it("relabels a dropdown that is already open", async () => {
    getProjectTeam.mockResolvedValue(roster(["Firmware"]));
    render(<Dropdown project="p-saved" />);
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("Firmware"));

    // What `team-block.tsx` does after a roster save.
    getProjectTeam.mockResolvedValue(roster(["Firmware", "H.C.C"]));
    await act(async () => {
      invalidateProjectRoles("arribada", "p-saved");
    });

    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("Firmware, H.C.C"));
    expect(getProjectTeam).toHaveBeenCalledTimes(2);
  });

  it("leaves another project's roster alone", async () => {
    getProjectTeam.mockImplementation((_slug: string, projectId: string) =>
      Promise.resolve(roster([projectId === "p-one" ? "Firmware" : "Enclosure"]))
    );
    render(
      <>
        <Dropdown project="p-one" />
        <Dropdown project="p-two" />
      </>
    );
    await waitFor(() => expect(screen.getAllByTestId("roles")[1]).toHaveTextContent("Enclosure"));
    expect(getProjectTeam).toHaveBeenCalledTimes(2);

    await act(async () => {
      invalidateProjectRoles("arribada", "p-one");
    });

    await waitFor(() => expect(getProjectTeam).toHaveBeenCalledTimes(3));
    expect(getProjectTeam).toHaveBeenLastCalledWith("arribada", "p-one");
  });
});
