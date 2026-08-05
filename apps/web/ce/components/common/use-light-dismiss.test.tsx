/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A menu you can get out of.
 *
 * A comment in this fork claimed a bare <details>/<summary> pair "closes on
 * Escape and on an outside click for free". It does not — <details> is a
 * disclosure widget and only its own <summary> toggles it — so the toolbar menu
 * built on one stayed open over everything you clicked next. The hook under test
 * did not exist before 3fda8b5476, so every case here fails against that commit's
 * parent with an unresolved import.
 *
 * The fixture is a <details> because that is what the one caller uses and
 * because the Escape branch reads a `summary` out of the subtree by tag name —
 * a fixture built from plain divs would pass while the real menu did not.
 *
 * `toBeVisible`, never `toBeInTheDocument`: jsdom draws nothing, so a closed
 * <details> still has all of its contents in the document and the weaker matcher
 * would pass whether the menu closed or not. jest-dom's `toBeVisible` knows the
 * <details> rule specifically, which is the one piece of layout it can be trusted
 * on here.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useLightDismiss } from "./use-light-dismiss";

const Fixture = () => {
  const [open, setOpen] = useState(false);
  const ref = useLightDismiss<HTMLDetailsElement>({ open, onDismiss: () => setOpen(false) });

  return (
    <div>
      <button type="button">Somewhere else</button>
      <details ref={ref} open={open}>
        <summary
          onClick={(event) => {
            // What the real menu does: <details> toggling itself would fight the
            // state that decides whether the listeners are bound at all.
            event.preventDefault();
            setOpen((wasOpen) => !wasOpen);
          }}
        >
          Saved orders
        </summary>
        <button type="button">Restore Tuesday</button>
      </details>
    </div>
  );
};

const menuItem = () => screen.getByRole("button", { name: "Restore Tuesday" });

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText("Saved orders"));
  expect(menuItem()).toBeVisible();
};

describe("useLightDismiss", () => {
  it("closes when you press somewhere else", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Somewhere else" }));

    expect(menuItem()).not.toBeVisible();
  });

  it("stays open when you press inside it", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openMenu(user);

    await user.click(menuItem());

    // The counterpart the outside-click test needs to mean anything: a hook that
    // closed on every pointerdown would pass that one just as happily.
    expect(menuItem()).toBeVisible();
  });

  it("closes on Escape and puts the caret back on the trigger", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openMenu(user);

    menuItem().focus();
    await user.keyboard("{Escape}");

    expect(menuItem()).not.toBeVisible();
    // Dismissing a menu that holds the caret and leaving the caret on the element
    // that just vanished is how the next Tab starts from the top of the page.
    expect(screen.getByText("Saved orders")).toHaveFocus();
  });
});
