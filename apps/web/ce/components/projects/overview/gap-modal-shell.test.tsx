/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What this shell owes a keyboard.
 *
 * It is shared by the discipline, assignee and dates modals, so it went three
 * dialogs' worth of missing when it was skipped by `useModalShell`: no Escape, no
 * focus moved in, no focus given back.
 *
 * Everything here is behaviour a keyboard can observe — which key closes it,
 * where the caret is afterwards. Nothing asserts on a class name or a size,
 * because jsdom has no layout engine and would happily agree with either.
 *
 * `openIt` finds the dialog by its heading and not by `role="dialog"` on purpose.
 * The role was missing before 3fda8b5476 too, so a shared helper that queried it
 * would make all four cases below fail on the same line and none of them would be
 * evidence of the thing it names.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GapModalShell } from "./gap-modal-shell";

/** A trigger and the dialog it opens, which is the only way the "focus goes back
 *  to whatever opened it" half can be observed at all. */
const Fixture = ({ saving = false }: { saving?: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Fix the undated work
      </button>
      <GapModalShell
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Undated work"
        count={1}
        emptyMessage="Nothing is undated."
        filled={0}
        saving={saving}
        onSave={() => {}}
      >
        <input aria-label="Start date" defaultValue="" />
      </GapModalShell>
    </>
  );
};

const trigger = () => screen.getByRole("button", { name: "Fix the undated work" });
const heading = () => screen.queryByRole("heading", { name: "Undated work" });

const openIt = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(trigger());
  expect(heading()).toBeInTheDocument();
};

describe("GapModalShell", () => {
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openIt(user);

    await user.keyboard("{Escape}");

    expect(heading()).not.toBeInTheDocument();
  });

  it("ignores Escape while a save is in flight", async () => {
    const user = userEvent.setup();
    render(<Fixture saving />);
    await openIt(user);

    await user.keyboard("{Escape}");

    // Escape discards; a save already on the wire is not the caller's to discard.
    //
    // Unlike its neighbours this one also passes against the pre-fix code, where
    // Escape did nothing under any circumstances. It is here because the fix
    // moved `busy` behind a ref to keep it out of the effect's deps, and a stale
    // closure over `busy` would look exactly like this test going red.
    expect(heading()).toBeInTheDocument();
  });

  it("puts the focus inside the panel when it opens", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openIt(user);

    // The caret must have crossed the backdrop, rather than being left on the
    // button an overlay has just covered. Asserted first because it is the whole
    // claim; the panel lookup below only says where it landed.
    expect(trigger()).not.toHaveFocus();
    // Deliberately not "focus is on element X": which control comes first is a
    // markup detail this test has no business freezing.
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });

  it("gives the focus back to whatever opened it", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const opener = trigger();
    await openIt(user);
    expect(opener).not.toHaveFocus();

    await user.keyboard("{Escape}");

    // Landing on <body> instead means the next Tab restarts from the top of the
    // page, which is the whole complaint.
    expect(opener).toHaveFocus();
  });
});
