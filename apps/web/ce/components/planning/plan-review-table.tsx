/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The review step shared by the plan modal and the setup wizard: the dates and
 * the owner — a person, or the discipline the work belongs to — that the
 * assistant proposed, one row per work item, every date still editable, both
 * halves of the owner still removable and every row still refusable. Nothing
 * here writes — the caller applies `approved`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { X } from "lucide-react";
import { cn } from "@plane/utils";
import type { TAiPlan, TPlanAssignment } from "@/plane-web/types/arribada";

export type TPlanReviewRow = TPlanAssignment & { checked: boolean };

export type TPlanReview = {
  rows: TPlanReviewRow[];
  allChecked: boolean;
  toggle: (issueId: string) => void;
  toggleAll: () => void;
  setDate: (issueId: string, field: "start_date" | "target_date", value: string) => void;
  /** Drop the proposed person of a row; its dates and its role are still applied. */
  clearAssignee: (issueId: string) => void;
  /** Drop the proposed role of a row; its dates and its person are still applied. */
  clearRole: (issueId: string) => void;
  /** The rows the user kept, in the shape applyPlan expects. */
  approved: {
    issue_id: string;
    start_date: string;
    target_date: string;
    assignee_ids: string[];
    roles: string[];
  }[];
};

type TRowState = {
  checked: boolean;
  start_date: string;
  target_date: string;
  assignee_id: string | null;
  role: string | null;
};

// A stable identity, so callers can pass `plan?.assignments` without a new empty
// array on every render restarting the seeding effect below.
const NO_ASSIGNMENTS: TPlanAssignment[] = [];

// ISO dates compare correctly as strings, so no Date objects are needed.
const datesUsable = (row: { start_date: string; target_date: string }) =>
  !!row.start_date && !!row.target_date && row.target_date >= row.start_date;

export function usePlanReview(assignments: TPlanAssignment[] | undefined): TPlanReview {
  const list = assignments ?? NO_ASSIGNMENTS;
  const [state, setState] = useState<Record<string, TRowState>>({});

  // A new proposal replaces the review wholesale: everything checked, dates,
  // owners and roles as proposed.
  useEffect(() => {
    const seeded: Record<string, TRowState> = {};
    list.forEach((a) => {
      seeded[a.issue_id] = {
        checked: true,
        start_date: a.start_date,
        target_date: a.target_date,
        assignee_id: a.assignee_id ?? null,
        role: a.role ?? null,
      };
    });
    setState(seeded);
  }, [list]);

  const rows = useMemo<TPlanReviewRow[]>(
    () =>
      list.map((a) => ({
        ...a,
        ...(state[a.issue_id] ?? {
          checked: true,
          start_date: a.start_date,
          target_date: a.target_date,
          assignee_id: a.assignee_id ?? null,
          role: a.role ?? null,
        }),
      })),
    [list, state]
  );

  const toggle = useCallback(
    (issueId: string) =>
      setState((s) => (s[issueId] ? { ...s, [issueId]: { ...s[issueId], checked: !s[issueId].checked } } : s)),
    []
  );

  const toggleAll = useCallback(
    () =>
      setState((s) => {
        const checked = !Object.values(s).every((v) => v.checked);
        const updated: Record<string, TRowState> = {};
        Object.entries(s).forEach(([id, v]) => {
          updated[id] = { ...v, checked };
        });
        return updated;
      }),
    []
  );

  const setDate = useCallback(
    (issueId: string, field: "start_date" | "target_date", value: string) =>
      setState((s) => {
        const row = s[issueId];
        if (!row) return s;
        const patch = field === "start_date" ? { start_date: value } : { target_date: value };
        return { ...s, [issueId]: { ...row, ...patch } };
      }),
    []
  );

  // The person and the role are two independent proposals about the same row:
  // dropping one must never take the other with it.
  const clearAssignee = useCallback(
    (issueId: string) => setState((s) => (s[issueId] ? { ...s, [issueId]: { ...s[issueId], assignee_id: null } } : s)),
    []
  );

  const clearRole = useCallback(
    (issueId: string) => setState((s) => (s[issueId] ? { ...s, [issueId]: { ...s[issueId], role: null } } : s)),
    []
  );

  const approved = useMemo(
    () =>
      rows
        .filter((r) => r.checked && datesUsable(r))
        .map((r) => ({
          issue_id: r.issue_id,
          start_date: r.start_date,
          target_date: r.target_date,
          // Empty lists mean "nothing was proposed", never "clear what is on the
          // item" — apply-plan only ever adds the owners and roles it is given.
          assignee_ids: r.assignee_id ? [r.assignee_id] : [],
          roles: r.role ? [r.role] : [],
        })),
    [rows]
  );

  return {
    rows,
    allChecked: rows.length > 0 && rows.every((r) => r.checked),
    toggle,
    toggleAll,
    setDate,
    clearAssignee,
    clearRole,
    approved,
  };
}

type Props = { plan: TAiPlan; review: TPlanReview };

export const PlanReviewTable = observer(function PlanReviewTable({ plan, review }: Props) {
  const { rows, allChecked, toggle, toggleAll, setDate, clearAssignee, clearRole } = review;
  const dateInput =
    "w-full rounded border border-subtle bg-layer-1 px-1.5 py-1 text-12 text-primary outline-none focus:border-accent-strong";
  const roleChip =
    "inline-flex min-w-0 items-center rounded-full border border-subtle bg-layer-2 px-2 py-0.5 text-11 text-secondary";
  // What the assistant was actually asked to place: the selection when one was
  // sent, the undated items otherwise.
  const scope = plan.requested_count ?? plan.undated_count;

  return (
    <div className="space-y-2">
      {plan.notes && <p className="rounded bg-layer-2 px-3 py-2 text-12 text-secondary">{plan.notes}</p>}

      {rows.length === 0 ? (
        <p className="py-4 text-center text-13 text-secondary">
          {scope === 0
            ? "Every work item already has dates — nothing to schedule."
            : "The assistant returned no usable dates. Try again, or reflow along dependencies."}
        </p>
      ) : (
        <div className="max-h-[45vh] overflow-auto rounded border border-subtle">
          <table className="w-full border-collapse text-13">
            <thead className="sticky top-0 bg-layer-2">
              <tr className="text-left text-11 tracking-wide text-secondary uppercase">
                <th className="w-8 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="accent-blue-500 size-4"
                    aria-label="Select every proposed row"
                  />
                </th>
                <th className="px-2 py-1.5 font-medium">Work item</th>
                <th className="w-36 px-2 py-1.5 font-medium">Start</th>
                <th className="w-36 px-2 py-1.5 font-medium">Target</th>
                <th className="w-40 px-2 py-1.5 font-medium">Owner / role</th>
                <th className="px-2 py-1.5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const usable = datesUsable(r);
                return (
                  <tr key={r.issue_id} className={cn("border-t border-subtle", !r.checked && "opacity-50")}>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={() => toggle(r.issue_id)}
                        className="accent-blue-500 mt-1 size-4"
                        aria-label={`Apply dates to ${r.name}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <span className="font-mono mr-1.5 text-11 text-placeholder">#{r.sequence_id}</span>
                      <span className="text-primary">{r.name}</span>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="date"
                        value={r.start_date}
                        onChange={(e) => setDate(r.issue_id, "start_date", e.target.value)}
                        className={cn(dateInput, !usable && "border-red-500")}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="date"
                        value={r.target_date}
                        onChange={(e) => setDate(r.issue_id, "target_date", e.target.value)}
                        className={cn(dateInput, !usable && "border-red-500")}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      {/* A named person is the concrete answer, so it takes the cell.
                          Clearing it uncovers the discipline the assistant picked,
                          which is still worth applying on its own. */}
                      {r.assignee_id && (
                        <span className="flex items-center gap-1">
                          <span className="min-w-0 truncate text-12 text-primary">
                            {r.assignee_name ?? "Proposed owner"}
                          </span>
                          <button
                            type="button"
                            onClick={() => clearAssignee(r.issue_id)}
                            className="shrink-0 text-tertiary hover:text-primary"
                            title="Apply the dates without an owner"
                            aria-label={`Remove the proposed owner of ${r.name}`}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      )}
                      {!r.assignee_id && r.role && (
                        <span className="flex items-center gap-1">
                          <span className={roleChip} title={`Tagged for ${r.role}`}>
                            <span className="min-w-0 truncate">{r.role}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => clearRole(r.issue_id)}
                            className="shrink-0 text-tertiary hover:text-primary"
                            title="Apply the dates without a role"
                            aria-label={`Remove the proposed role of ${r.name}`}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      )}
                      {!r.assignee_id && !r.role && <span className="text-12 text-tertiary">unassigned</span>}
                    </td>
                    <td className="px-2 py-1.5 align-top text-12 text-secondary">{r.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-11 text-tertiary">
        Proposed by {plan.provider}
        {plan.model ? ` · ${plan.model}` : ""} for {scope} work item(s).
        {plan.skipped.length > 0 &&
          ` Ignored ${plan.skipped.length} suggestion(s) that did not match an undated item: ${plan.skipped.join(", ")}.`}
      </p>
    </div>
  );
});
