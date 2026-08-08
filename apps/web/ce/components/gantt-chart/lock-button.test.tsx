/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A toast that told a lead they were not the lead.
 *
 * `usePlanLock` answered every write with a bare boolean, so a permission
 * refusal and a dropped connection reached this button as the identical `false`
 * — and it announced "Only the project lead can change this." for both. On a
 * lock whose entire premise is that it applies to the lead too (see the file's
 * own docstring), that message was not merely wrong, it contradicted the
 * feature: the one person it is guaranteed not to be about is the one most
 * likely to be pressing the button.
 *
 * The offline and 500 tests below fail against pre-fix HEAD, where every failure
 * produces the permission wording.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GanttLockButton } from "./lock-button";
import type { TPlanLock, TPlanLockWrite } from "./use-plan-lock";

const { setToast } = vi.hoisted(() => ({ setToast: vi.fn() }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", SUCCESS: "success" }, setToast }));

const REFUSED = "Only the project lead can change this.";

const lockWith = (setLocked: (next: boolean) => Promise<TPlanLockWrite>): TPlanLock => ({
  locked: false,
  allowEditOthers: true,
  allowAddItems: true,
  loaded: true,
  setLocked,
  setAllowEditOthers: vi.fn(async () => ({ ok: true }) as TPlanLockWrite),
  setAllowAddItems: vi.fn(async () => ({ ok: true }) as TPlanLockWrite),
});

const press = async (lock: TPlanLock) => {
  const user = userEvent.setup();
  render(<GanttLockButton lock={lock} />);
  await user.click(screen.getByRole("button", { name: /Lock/ }));
};

/** The message of whatever the last toast was. */
const lastMessage = () => (setToast.mock.calls.at(-1)?.[0] as { message?: string } | undefined)?.message ?? "";

beforeEach(() => {
  setToast.mockClear();
});

describe("GanttLockButton", () => {
  it("says nothing when the write goes through", async () => {
    await press(lockWith(async () => ({ ok: true })));
    expect(setToast).not.toHaveBeenCalled();
  });

  it("blames permissions when the server actually refused on permissions", async () => {
    await press(lockWith(async () => ({ ok: false, error: { status: 403, offline: false } })));
    expect(lastMessage()).toBe(REFUSED);
  });

  it("does NOT tell a lead they are not the lead when the connection dropped", async () => {
    await press(lockWith(async () => ({ ok: false, error: { offline: true, status: undefined } })));

    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(lastMessage()).not.toBe(REFUSED);
    expect(lastMessage()).toMatch(/offline/i);
  });

  it("does NOT blame permissions for a server error either", async () => {
    await press(lockWith(async () => ({ ok: false, error: { status: 500, offline: false } })));
    expect(lastMessage()).not.toBe(REFUSED);
    expect(lastMessage()).toMatch(/left as it was/i);
  });

  it("repeats the server's own explanation when it gave one", async () => {
    await press(
      lockWith(async () => ({
        ok: false,
        error: { status: 409, offline: false, error: "The plan is being reflowed." },
      }))
    );
    expect(lastMessage()).toBe("The plan is being reflowed.");
  });
});
