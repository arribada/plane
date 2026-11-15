/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A checklist that would not load is not an empty checklist.
 *
 * The cache wrote `items: []` on a failed read — the same shape as "no
 * checklist" — and its loader took any non-null `items` as "already fetched".
 * So one 500 when the panel opened was "Nothing on it yet" for the rest of the
 * session, nothing asked again, nothing to press. The summary did the same with
 * `{}`, which turned every badge in the project off until a reload.
 *
 * Every test here fails against pre-fix HEAD. The cache is module-level and
 * survives between tests, so each one uses its own work item.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChecklistCount, useIssueChecklist } from "./use-checklist";

const { getIssueChecklist, getChecklistSummary } = vi.hoisted(() => ({
  getIssueChecklist: vi.fn(),
  getChecklistSummary: vi.fn(),
}));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getIssueChecklist = getIssueChecklist;
    getChecklistSummary = getChecklistSummary;
    addToIssueChecklist = vi.fn();
    removeFromIssueChecklist = vi.fn();
  },
}));
vi.mock("@/services/issue", () => ({
  IssueService: class {
    patchIssue = vi.fn();
  },
}));
vi.mock("@/services/project", () => ({
  ProjectStateService: class {
    getStates = vi.fn();
  },
}));
vi.mock("@/hooks/use-issue-layout-store", () => ({
  useIssuesStore: () => ({ issues: { updateIssue: vi.fn() }, issueMap: {} }),
}));

const LINE = {
  id: "line-1",
  issue_id: "member-1",
  name: "Solder the antenna feed",
  sequence_id: 42,
  project_id: "gps",
  project_identifier: "GPS",
  state_id: "state-1",
  done: false,
  target_date: null,
};

beforeEach(() => {
  // Call counts below are per test; `restoreMocks` does not clear history.
  vi.clearAllMocks();
  getIssueChecklist.mockResolvedValue([LINE]);
  getChecklistSummary.mockResolvedValue({});
});

describe("useIssueChecklist after a failed read", () => {
  it("reports the failure instead of an empty checklist", async () => {
    getIssueChecklist.mockRejectedValue({ status: 500, offline: false, error: "The database is away." });

    const { result } = renderHook(() => useIssueChecklist("arribada", "gps", "issue-failed"));

    await waitFor(() => expect(result.current.failed).toBe("The database is away."));
    // Not "loaded and empty" — that is what the panel turns into "Nothing on it yet".
    expect(result.current.loaded).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("asks again on retry, and the lines then replace the failure", async () => {
    getIssueChecklist.mockRejectedValueOnce({ status: 502, offline: false });

    const { result } = renderHook(() => useIssueChecklist("arribada", "gps", "issue-retried"));
    await waitFor(() => expect(result.current.failed).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.items).toEqual([LINE]));
    expect(result.current.failed).toBeNull();
    expect(result.current.loaded).toBe(true);
    expect(getIssueChecklist).toHaveBeenCalledTimes(2);
  });

  it("does not cache the failure: the next reader asks again", async () => {
    getIssueChecklist.mockRejectedValueOnce({ status: 500, offline: false });

    const first = renderHook(() => useIssueChecklist("arribada", "gps", "issue-reopened"));
    await waitFor(() => expect(first.result.current.failed).not.toBeNull());
    first.unmount();

    const second = renderHook(() => useIssueChecklist("arribada", "gps", "issue-reopened"));

    await waitFor(() => expect(second.result.current.items).toEqual([LINE]));
    expect(getIssueChecklist).toHaveBeenCalledTimes(2);
  });
});

describe("useChecklistCount after a failed summary", () => {
  it("asks again for the next reader rather than keeping every badge off for the session", async () => {
    getChecklistSummary.mockRejectedValueOnce({ status: 500, offline: false });

    const first = renderHook(() => useChecklistCount("arribada", "project-failed", "issue-1"));
    await waitFor(() => expect(getChecklistSummary).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBeNull();
    first.unmount();

    getChecklistSummary.mockResolvedValue({ "issue-1": { done: 1, total: 3 } });
    const second = renderHook(() => useChecklistCount("arribada", "project-failed", "issue-1"));

    await waitFor(() => expect(second.result.current).toEqual({ done: 1, total: 3 }));
    expect(getChecklistSummary).toHaveBeenCalledTimes(2);
  });
});
