/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A note that snaps back has to say why.
 *
 * `commit` ended in an empty `.catch`: the store rolled the note back to where
 * it was, and nothing on screen said a word — a drop made offline looked like a
 * drag that had not taken. jsdom cannot perform the pointer drag, so the write
 * is reached the other way the board offers: an arrow-key nudge, whose pending
 * write is flushed when the board unmounts. The test fails against pre-fix HEAD.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StickiesFree } from "./stickies-free";

const { updateStickyLayout, setToast } = vi.hoisted(() => ({
  updateStickyLayout: vi.fn(),
  setToast: vi.fn(),
}));

vi.mock("@/hooks/use-stickies", () => ({
  useSticky: () => ({
    stickies: { "note-1": { id: "note-1", position_x: 10, position_y: 10, width: 200, height: 160 } },
    updateStickyLayout,
  }),
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));
// The editor inside a note has nothing to say about whether a failed save is reported.
vi.mock("../sticky", () => ({ StickyNote: () => <div>note body</div> }));

beforeAll(() => {
  // The board measures itself; jsdom has no ResizeObserver.
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: ResizeObserverStub });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StickiesFree", () => {
  it("says so when a placement could not be saved", async () => {
    updateStickyLayout.mockRejectedValue({ offline: true, status: undefined });
    const { unmount } = render(<StickiesFree workspaceSlug="arribada" stickyIds={["note-1"]} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /Move this sticky/ }), { key: "ArrowRight" });
    // Leaving the board writes whatever the keyboard left pending.
    unmount();

    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
    expect(JSON.stringify(setToast.mock.calls.at(-1))).toMatch(/offline/i);
    expect(updateStickyLayout).toHaveBeenCalledWith("arribada", "note-1", expect.objectContaining({ position_x: 18 }));
  });

  it("stays quiet when the placement was saved", async () => {
    updateStickyLayout.mockResolvedValue(undefined);
    const { unmount } = render(<StickiesFree workspaceSlug="arribada" stickyIds={["note-1"]} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /Move this sticky/ }), { key: "ArrowRight" });
    unmount();

    await waitFor(() => expect(updateStickyLayout).toHaveBeenCalled());
    expect(setToast).not.toHaveBeenCalled();
  });
});
