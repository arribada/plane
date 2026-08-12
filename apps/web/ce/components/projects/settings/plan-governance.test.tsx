/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The setting that says the plan is the lead's — and the sentence that says where
 * the line is.
 *
 * The help text is under test, not decoration. This permission's whole risk is
 * somebody turning it on and then finding out, from a colleague being refused
 * something, what it actually did. If the description stops naming both sides —
 * what the lead takes, and what everyone keeps — the setting has become
 * unpredictable and these tests say so.
 *
 * The other half is the one HANDOVER records three times: a control offered to
 * somebody the server will refuse. Only the LEAD may flip this (a workspace
 * admin may fix the plan but not decide who owns it), so the switch reads
 * `can_set_governance` from the server rather than working the answer out.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPlanGovernanceSection } from "./plan-governance";

const { getSchedule, setToast, planLock } = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  setToast: vi.fn(),
  planLock: {
    locked: false,
    allowEditOthers: true,
    allowAddItems: true,
    leadOnlyEdits: false,
    canEditPlan: true,
    loaded: true,
    setLocked: vi.fn(),
    setAllowEditOthers: vi.fn(),
    setAllowAddItems: vi.fn(),
    setLeadOnlyEdits: vi.fn(),
  },
}));

vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { ERROR: "error", SUCCESS: "success", INFO: "info", WARNING: "warning" },
  setToast,
}));
vi.mock("@/plane-web/components/gantt-chart/use-plan-lock", () => ({ usePlanLock: () => planLock }));
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getSchedule = getSchedule;
  },
}));

const draw = () => render(<ProjectPlanGovernanceSection workspaceSlug="arribada" projectId="gps" />);

beforeEach(() => {
  setToast.mockReset();
  getSchedule.mockReset();
  planLock.setLeadOnlyEdits.mockReset();
  planLock.setLeadOnlyEdits.mockResolvedValue({ ok: true });
  planLock.leadOnlyEdits = false;
  planLock.loaded = true;
  getSchedule.mockResolvedValue({ can_set_governance: true });
});

describe("what the setting says it does", () => {
  it("names what the lead takes", async () => {
    draw();
    await screen.findByRole("switch");
    const text = (document.body.textContent ?? "").toLowerCase();
    // Every category the guard actually enforces. A list that drifts from the
    // server's is worse than no list: it teaches the reader the wrong rule.
    for (const named of [
      "dates",
      "effort estimates",
      "disciplines",
      "parents",
      "dependencies",
      "sprint and module membership",
      "auto-schedule",
      "baselines",
    ]) {
      expect(text).toContain(named);
    }
    // And the repair path, which is the surprise if it goes unsaid: a workspace
    // admin passes this guard and does not pass `_lead_guard`.
    expect(text).toContain("workspace admin");
  });

  it("names what everyone else keeps, which is the part people ask about", async () => {
    draw();
    await screen.findByRole("switch");
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const kept of ["state", "commenting", "checklist", "effort they actually spent"]) {
      expect(text).toContain(kept);
    }
  });

  it("says it is a permission, so nobody reaches for it to freeze a plan", async () => {
    // `timeline_locked` is the control for "this plan is agreed" and it applies
    // to the lead too. Confusing the two is how somebody ends up with an
    // unfrozen plan and an annoyed team.
    draw();
    await screen.findByRole("switch");
    expect(document.body.textContent).toMatch(/padlock on the timeline/i);
  });
});

describe("who is offered the switch", () => {
  it("is disabled for anyone the server would refuse", async () => {
    getSchedule.mockResolvedValue({ can_set_governance: false });
    draw();
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("switch")).toBeDisabled());
  });

  it("is live for the lead", async () => {
    draw();
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  });

  it("stays disabled while the settings are still loading", async () => {
    // "No setting" and "we do not know yet" look identical on screen and are not
    // the same thing; acting on the second writes a value nobody chose.
    planLock.loaded = false;
    draw();
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});

describe("turning it on", () => {
  it("sends the flag and says what changed for the team", async () => {
    draw();
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    await userEvent.click(screen.getByRole("switch"));

    expect(planLock.setLeadOnlyEdits).toHaveBeenCalledWith(true);
    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(setToast.mock.calls[0][0].type).toBe("success");
  });

  it("says who to ask when the server refuses", async () => {
    // The refusal a workspace admin gets: they can repair the plan, they cannot
    // decide who owns it. Telling them "something went wrong" would send them
    // looking for an outage.
    planLock.setLeadOnlyEdits.mockResolvedValue({ ok: false, error: { status: 403 } });
    draw();
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    await userEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    const toast = setToast.mock.calls[0][0];
    expect(toast.type).toBe("error");
    expect(toast.title).toMatch(/lead/i);
  });

  it("does not claim success when the connection dropped", async () => {
    // A rejection with no status is an outage, not a refusal, and calling it
    // "only the lead can do this" is a flat lie — the same defect this fork
    // fixed in `arribada.service.ts`.
    planLock.setLeadOnlyEdits.mockResolvedValue({ ok: false, error: undefined });
    draw();
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    await userEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    const toast = setToast.mock.calls[0][0];
    expect(toast.type).toBe("error");
    expect(toast.title).not.toMatch(/lead/i);
  });
});
