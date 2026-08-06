/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The projects table has to know that folders nest.
 *
 * It read `parent_id` off the payload and threw it away, so a subfolder became a
 * section heading indistinguishable from a top-level one: "Turtles" beside
 * "Tracker" rather than inside it, sorted by its own initial to wherever the
 * alphabet put it. The sidebar tree and the portfolio swimlanes both carry the
 * hierarchy; this page was the one surface that did not, and a project moved into
 * a subfolder appeared to leave its mission.
 *
 * Sections here are a flat list on purpose — a table cannot indent inside itself
 * and stay readable — so the hierarchy lives in the heading text, which is what
 * these tests read.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectListView } from "./project-list-view";

const { getFolders, getPortfolio } = vi.hoisted(() => ({ getFolders: vi.fn(), getPortfolio: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getFolders = getFolders;
    getPortfolio = getPortfolio;
    assignProjectToFolder = vi.fn();
    createFolder = vi.fn();
  },
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error" }, setToast: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));

const project = (id: string, name: string) => ({
  id,
  name,
  identifier: name.slice(0, 3).toUpperCase(),
  start_date: null,
  target_date: null,
  derived_target_date: null,
  item_count: 0,
  completed_item_count: 0,
  undated_item_count: 0,
});

beforeEach(() => {
  getFolders.mockResolvedValue([
    { id: "tracker", name: "Tracker", parent_id: null, sort_order: 0, project_ids: ["gps"] },
    // Named to sort BEFORE its parent on its own, so a flat pass would file it
    // above "Tracker" and the path is the only thing that can put it back.
    { id: "turtles", name: "Adult turtles", parent_id: "tracker", sort_order: 1, project_ids: ["camera"] },
  ]);
  getPortfolio.mockResolvedValue([project("gps", "Sea Turtle Tag GPS"), project("camera", "Sea Turtle Tag Camera")]);
});

const headings = () =>
  screen.getAllByRole("button", { expanded: true }).map((b) => b.textContent?.replace(/\s*·\s*\d+$/, "").trim());

describe("ProjectListView folder sections", () => {
  it("names a subfolder's section by its path", async () => {
    render(<ProjectListView projectIds={["gps", "camera"]} />);

    // Not "Adult turtles" on its own, which says nothing about which mission it
    // belongs to.
    await waitFor(() => expect(screen.getByText("Tracker / Adult turtles")).toBeInTheDocument());
  });

  it("puts a subfolder's section under its parent's, not where its initial falls", async () => {
    render(<ProjectListView projectIds={["gps", "camera"]} />);
    await waitFor(() => expect(screen.getByText("Tracker / Adult turtles")).toBeInTheDocument());

    expect(headings()).toEqual(["Tracker", "Tracker / Adult turtles"]);
  });
});
