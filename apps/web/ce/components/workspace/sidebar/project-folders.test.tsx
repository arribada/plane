/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Dropping a project on a folder has to actually file it.
 *
 * The bug this pins: `dropAction` returned `() => assign(dragProjectId!, targetId)`
 * — a closure that re-read the module-level drag source when it ran — and `onDrop`
 * called `clearDrag()` first. So every project dropped on a folder reached the
 * service with a null project id, the server answered 400, nothing caught it, and
 * the sidebar redrew unchanged. It was reported as "nested folders don't accept
 * drops", which is why the top-level case below is here too: it fails against the
 * same pre-fix code, and that is the evidence the depth had nothing to do with it.
 *
 * WHAT THESE TESTS DO NOT COVER. jsdom has no drag-and-drop: there is no drag
 * image, no pointer physics, no hit-testing, and `dataTransfer` here is a stub, so
 * nothing below proves a real mouse can pick a row up. What they do prove is
 * everything downstream of the gesture — that a dragstart on the row and a drop on
 * the target reach the handlers, that the handler reads the drag source BEFORE
 * clearing it, and that the id it sends is the one that was dragged and the target
 * that was dropped on. The one browser behaviour that cannot be checked here is
 * `preventDefault` in dragOver (without it a real browser never fires drop at all);
 * it is exercised only in the sense that the handler runs.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROOT_DROP, resolveDrop, SidebarProjectFolders } from "./project-folders";

const { getFolders, assignProjectToFolder, moveFolder, createFolder, renameFolder, deleteFolder, setToast } =
  vi.hoisted(() => ({
    getFolders: vi.fn(),
    assignProjectToFolder: vi.fn(),
    moveFolder: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    setToast: vi.fn(),
  }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getFolders = getFolders;
    assignProjectToFolder = assignProjectToFolder;
    moveFolder = moveFolder;
    createFolder = createFolder;
    renameFolder = renameFolder;
    deleteFolder = deleteFolder;
  },
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "arribada" }) }));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ push: vi.fn() }) }));

const PROJECTS: Record<string, string> = {
  gps: "Sea Turtle Tag GPS",
  camera: "Sea Turtle Tag Camera",
  doppler: "Sea Turtle Tag Doppler",
};

vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    joinedProjectIds: Object.keys(PROJECTS),
    getProjectById: (id: string) => (PROJECTS[id] ? { id, name: PROJECTS[id] } : undefined),
  }),
}));

/** The tree from the report: two subfolders under Tracker, the three loose
 *  projects filed in Tracker itself, and one unrelated folder at the top level. */
const TREE = () => [
  { id: "tracker", name: "Tracker", parent_id: null, sort_order: 0, project_ids: ["gps", "camera", "doppler"] },
  { id: "turtles", name: "Turtles", parent_id: "tracker", sort_order: 1, project_ids: [] },
  { id: "avian", name: "Avian", parent_id: "tracker", sort_order: 2, project_ids: [] },
  { id: "ops", name: "Field ops", parent_id: null, sort_order: 3, project_ids: [] },
];

beforeEach(() => {
  // `restoreMocks` in vitest.config.ts strips implementations between tests, so
  // these are stated per test rather than at the module top. It does NOT clear
  // the call history of a `vi.hoisted` mock — which is how a test asserting that
  // NOTHING was reported reads the four toasts raised by the tests before it.
  vi.clearAllMocks();
  getFolders.mockResolvedValue(TREE());
  assignProjectToFolder.mockResolvedValue({});
  moveFolder.mockResolvedValue({});
  createFolder.mockResolvedValue({});
  renameFolder.mockResolvedValue({});
  deleteFolder.mockResolvedValue({});
});

/** A stand-in for the real thing, which jsdom does not implement. Only `setData`
 *  is ever called, and only so Firefox will start a drag at all. */
const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: "" });

/** The draggable row a piece of text sits in — the element the browser would fire
 *  dragstart on, rather than the button the text is inside. */
const rowFor = (text: string): HTMLElement => {
  const row = screen.getByText(text).closest('[draggable="true"]');
  if (!row) throw new Error(`no draggable row around "${text}"`);
  return row as HTMLElement;
};

/** Render, wait for the fetch, and open Tracker so its projects and subfolders are
 *  on screen — the state the screenshot in the report shows. */
const openTracker = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<SidebarProjectFolders />);
  await user.click(await screen.findByRole("button", { name: /Tracker/ }));
};

/** Pick a row up and let it go over `target`. */
const dragOnto = (row: HTMLElement, target: HTMLElement) => {
  fireEvent.dragStart(row, { dataTransfer: dataTransfer() });
  fireEvent.dragOver(target, { dataTransfer: dataTransfer() });
  fireEvent.drop(target, { dataTransfer: dataTransfer() });
};

describe("SidebarProjectFolders drops", () => {
  it("files a project into a NESTED folder", async () => {
    const user = userEvent.setup();
    await openTracker(user);

    dragOnto(rowFor("Sea Turtle Tag Camera"), rowFor("Turtles"));

    // The id that was dragged, and the folder it was dropped on. Pre-fix this was
    // called with `null` as the project id.
    await waitFor(() => expect(assignProjectToFolder).toHaveBeenCalledWith("arribada", "camera", "turtles"));
  });

  it("files a project into a TOP-LEVEL folder — the depth was never the problem", async () => {
    const user = userEvent.setup();
    await openTracker(user);

    dragOnto(rowFor("Sea Turtle Tag Camera"), rowFor("Field ops"));

    await waitFor(() => expect(assignProjectToFolder).toHaveBeenCalledWith("arribada", "camera", "ops"));
  });

  it("unfiles a project dropped on the FOLDERS header", async () => {
    const user = userEvent.setup();
    await openTracker(user);
    const header = screen.getByText("Folders").parentElement as HTMLElement;

    dragOnto(rowFor("Sea Turtle Tag Camera"), header);

    // The header used to test the folder transient alone and ignore a project
    // entirely, so dragging one out of a folder did nothing at all.
    await waitFor(() => expect(assignProjectToFolder).toHaveBeenCalledWith("arribada", "camera", null));
  });

  it("says so when the server refuses the move", async () => {
    const user = userEvent.setup();
    assignProjectToFolder.mockRejectedValue({ error: "project not found" });
    await openTracker(user);

    dragOnto(rowFor("Sea Turtle Tag Camera"), rowFor("Turtles"));

    // Silence is how the original bug stayed invisible for a whole release: the
    // write was rejected on every single drop and nothing on screen said a word.
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
  });

  it("re-parents a folder dropped on another folder", async () => {
    const user = userEvent.setup();
    await openTracker(user);

    dragOnto(rowFor("Turtles"), rowFor("Field ops"));

    await waitFor(() => expect(moveFolder).toHaveBeenCalledWith("arribada", "turtles", "ops"));
  });
});

/**
 * The other three writes in this file.
 *
 * The commit that added a `catch` to `assign` — for the drop bug the tests above
 * pin — walked straight past `createFolder`, `rename` and `del`, which were bare
 * `await`s with no error path at all. Same file, same service, same silence: a
 * rejected create left the name somebody had just typed nowhere at all, and the
 * sidebar redrew exactly as it was.
 *
 * Every test here fails against pre-fix HEAD, where nothing is reported.
 */
describe("SidebarProjectFolders writes", () => {
  const answerPrompt = (value: string | null) => vi.spyOn(window, "prompt").mockReturnValue(value);

  it("says so when a folder could not be created", async () => {
    const user = userEvent.setup();
    answerPrompt("Marine");
    createFolder.mockRejectedValue({ status: 400, offline: false, error: "A folder by that name exists." });
    render(<SidebarProjectFolders />);

    await user.click(await screen.findByRole("button", { name: "New folder" }));

    await waitFor(() =>
      expect(setToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", message: "A folder by that name exists." })
      )
    );
  });

  it("says so when a subfolder could not be created", async () => {
    const user = userEvent.setup();
    answerPrompt("Hawksbill");
    createFolder.mockRejectedValue({ offline: true, status: undefined });
    render(<SidebarProjectFolders />);

    await user.click((await screen.findAllByRole("button", { name: "New subfolder" }))[0] as HTMLElement);

    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
    expect(JSON.stringify(setToast.mock.calls.at(-1))).toMatch(/offline/i);
  });

  it("says so when a rename was refused", async () => {
    const user = userEvent.setup();
    answerPrompt("Trackers");
    renameFolder.mockRejectedValue({ status: 403, offline: false });
    render(<SidebarProjectFolders />);

    await user.click((await screen.findAllByRole("button", { name: "Rename" }))[0] as HTMLElement);

    // Naming what the folder is still called, because the row on screen already
    // shows the old name and looks like the rename simply did not register.
    await waitFor(() =>
      expect(setToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", message: 'It is still called "Tracker".' })
      )
    );
  });

  it("says so when a delete was refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteFolder.mockRejectedValue({ status: 500, offline: false });
    render(<SidebarProjectFolders />);

    await user.click((await screen.findAllByRole("button", { name: "Delete folder" }))[0] as HTMLElement);

    await waitFor(() =>
      expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: "It is still there." }))
    );
  });

  it("stays quiet when the write goes through", async () => {
    const user = userEvent.setup();
    answerPrompt("Marine");
    render(<SidebarProjectFolders />);

    await user.click(await screen.findByRole("button", { name: "New folder" }));

    await waitFor(() => expect(createFolder).toHaveBeenCalledWith("arribada", "Marine", null));
    expect(setToast).not.toHaveBeenCalled();
  });
});

/** The decision itself, with no DOM in the way. */
describe("resolveDrop", () => {
  // tracker ── turtles ── hawksbill;  ops (unrelated root)
  const PARENTS = new Map<string, string | null>([
    ["tracker", null],
    ["turtles", "tracker"],
    ["hawksbill", "turtles"],
    ["ops", null],
  ]);

  it("takes a project into a folder at any depth", () => {
    for (const target of ["tracker", "turtles", "hawksbill", "ops"]) {
      expect(resolveDrop({ kind: "project", id: "camera" }, target, PARENTS)).toEqual({
        kind: "assign",
        projectId: "camera",
        folderId: target,
      });
    }
  });

  it("reads the header as 'out of every folder'", () => {
    expect(resolveDrop({ kind: "project", id: "camera" }, ROOT_DROP, PARENTS)).toEqual({
      kind: "assign",
      projectId: "camera",
      folderId: null,
    });
    expect(resolveDrop({ kind: "folder", id: "turtles" }, ROOT_DROP, PARENTS)).toEqual({
      kind: "nest",
      folderId: "turtles",
      parentId: null,
    });
  });

  it("refuses a folder dropped inside its own subtree", () => {
    // Onto itself, onto its child, and onto its grandchild — the last is the one
    // a single-level check would wave through, and it detaches the whole subtree.
    expect(resolveDrop({ kind: "folder", id: "turtles" }, "turtles", PARENTS)).toBeNull();
    expect(resolveDrop({ kind: "folder", id: "turtles" }, "hawksbill", PARENTS)).toBeNull();
    expect(resolveDrop({ kind: "folder", id: "tracker" }, "hawksbill", PARENTS)).toBeNull();
  });

  it("allows a folder to move down a branch it is not part of", () => {
    expect(resolveDrop({ kind: "folder", id: "ops" }, "hawksbill", PARENTS)).toEqual({
      kind: "nest",
      folderId: "ops",
      parentId: "hawksbill",
    });
  });

  it("decides nothing when nothing is being dragged", () => {
    expect(resolveDrop(null, "turtles", PARENTS)).toBeNull();
  });

  it("survives a parent that has gone missing", () => {
    // The renderer shows an orphan at the top level rather than dropping it, so
    // the walk has to terminate on one instead of looping.
    expect(resolveDrop({ kind: "folder", id: "x" }, "orphan", new Map([["orphan", "gone"]]))).toEqual({
      kind: "nest",
      folderId: "x",
      parentId: "orphan",
    });
  });
});
