/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The settings that say who may change the project, and the sentences that say
 * where each line is.
 *
 * The help text is under test, not decoration. This permission's whole risk is
 * somebody turning it on and then finding out, from a colleague being refused
 * something, what it actually did. If the description stops naming both sides,
 * what the lead takes and what everyone keeps, the setting has become
 * unpredictable and these tests say so.
 *
 * The other half is the one HANDOVER records three times: a control offered to
 * somebody the server will refuse. Only the LEAD may flip lead-only edits (a
 * workspace admin may fix the plan but not decide who owns it), while external
 * edits admit the lead OR a workspace admin. Each switch reads its own answer
 * from the server (`can_set_governance`, `can_set_external_edits`) rather than
 * working it out.
 *
 * Two switches now, so every query names the one it means. An unnamed
 * `getByRole("switch")` would throw on the pair, and a test that picked "the
 * first switch" would silently start testing the other one the day the order
 * changed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPlanGovernanceSection } from "./plan-governance";

const { getSchedule, updateSchedule, setToast, planLock } = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  updateSchedule: vi.fn(),
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
    updateSchedule = updateSchedule;
  },
}));

const draw = () => render(<ProjectPlanGovernanceSection workspaceSlug="arribada" projectId="gps" />);

const leadSwitch = () => screen.getByRole("switch", { name: /only the project lead edits the plan/i });
const externalSwitch = () => screen.getByRole("switch", { name: /external edits/i });

beforeEach(() => {
  setToast.mockReset();
  getSchedule.mockReset();
  updateSchedule.mockReset();
  planLock.setLeadOnlyEdits.mockReset();
  planLock.setLeadOnlyEdits.mockResolvedValue({ ok: true });
  planLock.leadOnlyEdits = false;
  planLock.loaded = true;
  getSchedule.mockResolvedValue({ can_set_governance: true });
});

describe("what the setting says it does", () => {
  it("names what the lead takes", async () => {
    draw();
    await screen.findByRole("switch", { name: /only the project lead edits the plan/i });
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
    await screen.findByRole("switch", { name: /only the project lead edits the plan/i });
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
    await screen.findByRole("switch", { name: /only the project lead edits the plan/i });
    expect(document.body.textContent).toMatch(/padlock on the timeline/i);
  });
});

describe("who is offered the lead-only switch", () => {
  it("is disabled for anyone the server would refuse", async () => {
    getSchedule.mockResolvedValue({ can_set_governance: false });
    draw();
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    await waitFor(() => expect(leadSwitch()).toBeDisabled());
  });

  it("is live for the lead", async () => {
    draw();
    await waitFor(() => expect(leadSwitch()).toBeEnabled());
  });

  it("stays disabled while the settings are still loading", async () => {
    // "No setting" and "we do not know yet" look identical on screen and are not
    // the same thing; acting on the second writes a value nobody chose.
    planLock.loaded = false;
    draw();
    expect(leadSwitch()).toBeDisabled();
  });
});

describe("turning lead-only on", () => {
  it("sends the flag and says what changed for the team", async () => {
    draw();
    await waitFor(() => expect(leadSwitch()).toBeEnabled());
    await userEvent.click(leadSwitch());

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
    await waitFor(() => expect(leadSwitch()).toBeEnabled());
    await userEvent.click(leadSwitch());

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    const toast = setToast.mock.calls[0][0];
    expect(toast.type).toBe("error");
    expect(toast.title).toMatch(/lead/i);
  });

  it("does not claim success when the connection dropped", async () => {
    // A rejection with no status is an outage, not a refusal, and calling it
    // "only the lead can do this" is a flat lie, the same defect this fork
    // fixed in `arribada.service.ts`.
    planLock.setLeadOnlyEdits.mockResolvedValue({ ok: false, error: undefined });
    draw();
    await waitFor(() => expect(leadSwitch()).toBeEnabled());
    await userEvent.click(leadSwitch());

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    const toast = setToast.mock.calls[0][0];
    expect(toast.type).toBe("error");
    expect(toast.title).not.toMatch(/lead/i);
  });
});

describe("external edits", () => {
  it("is called what the refusals call it", async () => {
    // The wiki sync and the MCP server both refuse with "turn on external
    // edits". A switch under any other name is one the person refused cannot find,
    // which is the report that created this switch.
    draw();
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    expect(externalSwitch()).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/External edits/);
  });

  it("says what an integration may and may not do", async () => {
    draw();
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const named of ["wiki sync", "agents", "create and update work items", "locked timeline"]) {
      expect(text).toContain(named);
    }
  });

  it("shows the saved state", async () => {
    getSchedule.mockResolvedValue({ external_edits: true, can_set_external_edits: true });
    draw();
    await waitFor(() => expect(externalSwitch()).toHaveAttribute("aria-checked", "true"));
  });

  it("is live for a workspace admin who is not the lead", async () => {
    // The decision of 2026-09-25, and the case that made the difference: the
    // lead-only switch stays disabled for the same person on the same screen.
    getSchedule.mockResolvedValue({ can_set_governance: false, can_set_external_edits: true });
    draw();
    await waitFor(() => expect(externalSwitch()).toBeEnabled());
    expect(leadSwitch()).toBeDisabled();
  });

  it("is disabled for anyone the server would refuse", async () => {
    getSchedule.mockResolvedValue({ can_set_governance: false, can_set_external_edits: false });
    draw();
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    await waitFor(() => expect(externalSwitch()).toBeDisabled());
  });

  it("stays disabled when the settings could not be read", async () => {
    // Failing closed: "off" drawn from a failed read looks exactly like a known
    // "off", and a click on it would write a value nobody chose.
    getSchedule.mockRejectedValue({ status: 502, offline: false });
    draw();
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    expect(externalSwitch()).toBeDisabled();
  });

  it("turning it on sends the flag and shows what the server saved", async () => {
    getSchedule.mockResolvedValue({ external_edits: false, can_set_external_edits: true });
    updateSchedule.mockResolvedValue({ external_edits: true });
    draw();
    await waitFor(() => expect(externalSwitch()).toBeEnabled());
    await userEvent.click(externalSwitch());

    expect(updateSchedule).toHaveBeenCalledWith("arribada", "gps", { external_edits: true });
    await waitFor(() => expect(externalSwitch()).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(setToast.mock.calls[0][0].type).toBe("success");
  });

  it("a refusal puts the switch back and says who to ask", async () => {
    getSchedule.mockResolvedValue({ external_edits: false, can_set_external_edits: true });
    updateSchedule.mockRejectedValue({ status: 403, offline: false });
    draw();
    await waitFor(() => expect(externalSwitch()).toBeEnabled());
    await userEvent.click(externalSwitch());

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    const toast = setToast.mock.calls[0][0];
    expect(toast.type).toBe("error");
    expect(toast.title).toMatch(/lead or a workspace admin/i);
    expect(externalSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("a dropped connection is not called a refusal", async () => {
    getSchedule.mockResolvedValue({ external_edits: false, can_set_external_edits: true });
    updateSchedule.mockRejectedValue({ offline: true });
    draw();
    await waitFor(() => expect(externalSwitch()).toBeEnabled());
    await userEvent.click(externalSwitch());

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    const toast = setToast.mock.calls[0][0];
    expect(toast.type).toBe("error");
    expect(toast.title).not.toMatch(/lead/i);
    expect(externalSwitch()).toHaveAttribute("aria-checked", "false");
  });
});
