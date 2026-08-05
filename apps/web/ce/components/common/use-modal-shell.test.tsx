/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The regression nobody could see, and the one that only showed up mid-save.
 *
 * The hook's effect used to list `busy` and `onClose` alongside `open` in its
 * deps. Every re-run tears the shell down and builds it again, and teardown
 * restores focus to the opener while setup drags it back to the first focusable
 * thing in the panel. A caller passing an inline `onClose` — which is all of
 * them — hands the effect a new function identity on every single render, so
 * "every re-run" meant every keystroke: type one character into a field and the
 * caret was gone. `busy` flipping did the same thing at the worst possible
 * moment, halfway through a save.
 *
 * Both are invisible in a screenshot and invisible in a diff, and five dialogs
 * had them. They are visible here: type two characters and count them.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useModalShell } from "./use-modal-shell";

/**
 * `onClose` is written inline on purpose — a `useCallback` here would hide the
 * exact thing under test. So is the local state: a controlled input re-renders
 * its owner on every keystroke, which is what turns a stale dep into a bug.
 */
const Fixture = ({ busy = false }: { busy?: boolean }) => {
  const [open, setOpen] = useState(true);
  const [hours, setHours] = useState("");
  const { panelProps, backdropProps } = useModalShell({
    open,
    onClose: () => setOpen(false),
    busy,
    label: "Time spent",
  });

  if (!open) return null;
  return (
    <div>
      <div {...backdropProps} />
      <div {...panelProps}>
        {/* First in the panel, so it is where a re-running effect would dump the
            caret — which makes it the witness. */}
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
        <input aria-label="Hours" value={hours} onChange={(event) => setHours(event.target.value)} />
      </div>
    </div>
  );
};

describe("useModalShell", () => {
  it("leaves the caret where it is while you type into the dialog", async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    const field = screen.getByRole("textbox", { name: "Hours" });
    await user.click(field);
    await user.type(field, "12");

    // Both halves matter. If focus is stolen after the first character, the
    // second one is typed into whatever caught it — so the field holding "1" and
    // the caret sitting on the Close button are the same failure seen twice.
    expect(field).toHaveFocus();
    expect(field).toHaveValue("12");
  });

  it("leaves the caret where it is when a save starts", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Fixture />);

    const field = screen.getByRole("textbox", { name: "Hours" });
    await user.click(field);
    expect(field).toHaveFocus();

    // What pressing Save does: the same tree, one prop different.
    rerender(<Fixture busy />);

    expect(field).toHaveFocus();
  });
});
