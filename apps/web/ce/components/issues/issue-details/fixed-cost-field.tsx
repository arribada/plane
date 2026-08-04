/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A work item that is bought rather than done: a price, a supplier, a wait.
 *
 * "Hardware production — six weeks, £4,000 to the supplier" is not our labour.
 * Its calendar window is the supplier's lead time, not effort, and nobody here
 * is occupied by it. Costed as person-days it billed the project twice: once for
 * time nobody spent, once for the invoice somebody had already recorded.
 *
 * The figure is a line in the ordinary expense ledger — the same one the Finance
 * page reads — so there is exactly one number and it lives in one place. What
 * this field adds is the link back to the item, and the flag that takes the item
 * out of the labour estimate and out of everybody's capacity.
 *
 * The suggested target is OFFERED, never applied. Same contract as the effort
 * field: a bar that redrew itself the moment somebody typed a lead time is a bar
 * they stop trusting.
 */
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Banknote, Loader2 } from "lucide-react";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TIssueFixedCost } from "@/plane-web/types/arribada";

const service = new ArribadaService();

/** The two this organisation is funded in, plus whatever a line already holds. */
const CURRENCIES = ["EUR", "GBP", "USD"];

/** Grouped digits and the currency's own symbol where the browser knows one. */
const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // An unknown or malformed currency code must not blank the figure.
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
};

/** "42 days" as the weeks a supplier actually quoted, when it divides cleanly. */
const leadTimeLabel = (days: number) => {
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
};

const input =
  "rounded border border-subtle bg-layer-1 px-1.5 py-1 text-body-xs-regular text-primary outline-none focus:border-accent-strong";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isEditable: boolean;
};

export const IssueFixedCostField = observer(function IssueFixedCostField(props: Props) {
  const { workspaceSlug, projectId, issueId, isEditable } = props;
  const { updateIssue } = useIssueDetail();
  const [state, setState] = useState<TIssueFixedCost | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    amount: "",
    currency: "EUR",
    supplier: "",
    leadTime: "",
    replacesLabour: true,
  });

  // The load is keyed on the item, and a panel switched between two work items
  // reuses the component — so a reply that arrives after the switch must not
  // paint the previous item's price onto the current one.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    setOpen(false);
    const load = async () => {
      try {
        const data = await service.getIssueFixedCost(workspaceSlug, projectId, issueId);
        if (!live.current) return;
        setState(data);
        setDraft({
          amount: data.amount == null ? "" : String(data.amount),
          currency: data.currency,
          supplier: data.supplier,
          leadTime: data.lead_time_days == null ? "" : String(data.lead_time_days),
          replacesLabour: data.replaces_labour,
        });
      } catch {
        // A field that will not load must not break the panel it sits in.
        if (live.current) setState(null);
      }
    };
    if (workspaceSlug && projectId && issueId) void load();
    return () => {
      live.current = false;
    };
  }, [workspaceSlug, projectId, issueId]);

  if (!state) return null;

  // Two separate rights. `isEditable` is Plane's — can this person touch the work
  // item at all — and `can_edit` is the budget's: the expense sheet belongs to
  // the project lead, because a budget nobody owns is a budget nobody can defend.
  const canWrite = isEditable && state.can_edit !== false;
  const recorded = state.expense_id != null && state.total != null;

  const save = async () => {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setToast({ type: TOAST_TYPE.ERROR, title: "That is not a price" });
      return;
    }
    const lead = draft.leadTime.trim() === "" ? null : Number(draft.leadTime);
    if (lead !== null && (!Number.isInteger(lead) || lead <= 0)) {
      setToast({ type: TOAST_TYPE.ERROR, title: "The lead time has to be a whole number of days" });
      return;
    }
    setBusy(true);
    try {
      const saved = await service.setIssueFixedCost(workspaceSlug, projectId, issueId, {
        amount,
        currency: draft.currency,
        supplier: draft.supplier.trim(),
        lead_time_days: lead,
        replaces_labour: draft.replacesLabour,
      });
      // `can_edit` and `other_lines` only come back on a read, so they are carried
      // over rather than dropped — losing `can_edit` would grey the field out for
      // the very person who just used it.
      setState({ ...state, ...saved });
      setOpen(false);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save the cost",
        message: (error as { error?: string })?.error ?? "Nothing was changed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    // This deletes a recorded amount out of the ledger a grant is reconciled
    // against, and there is no undo. Naming the figure is what makes a misfire
    // recoverable by simply saying no.
    if (
      state.total != null &&
      !window.confirm(`Remove ${money(state.total, state.currency)} from the budget? This cannot be undone.`)
    )
      return;
    setBusy(true);
    try {
      const saved = await service.setIssueFixedCost(workspaceSlug, projectId, issueId, { remove: true });
      setState({ ...state, ...saved });
      setDraft({ amount: "", currency: "EUR", supplier: "", leadTime: "", replacesLabour: true });
      setOpen(false);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't remove it",
        message: (error as { error?: string })?.error ?? "The line is still there.",
      });
    } finally {
      setBusy(false);
    }
  };

  const applySuggestion = async () => {
    const target = state.suggested_target;
    if (!target) return;
    setBusy(true);
    try {
      await updateIssue(workspaceSlug, projectId, issueId, { target_date: target });
      // Once taken, the offer has to go: leaving it proposes to re-apply what is
      // already on the item.
      setState({ ...state, suggested_target: null });
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Target set from the lead time" });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't set the target date" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidebarPropertyListItem icon={Banknote} label="Supplier cost">
      <div className="flex w-full flex-col gap-1 py-1">
        {!open && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {recorded ? (
              <>
                <span className="text-body-xs-medium text-primary tabular-nums">
                  {money(state.total as number, state.currency)}
                </span>
                {state.supplier && <span className="text-11 text-tertiary">{state.supplier}</span>}
                {state.lead_time_days != null && (
                  <span className="text-11 text-tertiary" title="What the supplier quoted, in calendar days">
                    {leadTimeLabel(state.lead_time_days)}
                  </span>
                )}
                {!state.planned && <span className="text-11 text-success-primary">spent</span>}
              </>
            ) : (
              <span className="text-body-xs-regular text-tertiary">—</span>
            )}
            {canWrite && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-11 text-accent-primary hover:underline"
              >
                {recorded ? "Edit" : "Add a fixed cost"}
              </button>
            )}
            {busy && <Loader2 className="size-3 animate-spin text-tertiary" />}
          </div>
        )}

        {/* Why the item shows no person-days anywhere else. Said here rather than
            left to be discovered on the Finance page: this is the screen where
            somebody wonders where the effort went. */}
        {recorded && state.replaces_labour && (
          <p className="text-11 text-tertiary">
            Bought, not built here — it costs no person-days and books nobody&apos;s time.
          </p>
        )}
        {recorded && !state.replaces_labour && (
          <p className="text-11 text-tertiary">Recorded beside our own time on this item, not instead of it.</p>
        )}

        {state.suggested_target && canWrite && !open && (
          <button
            type="button"
            onClick={() => void applySuggestion()}
            disabled={busy}
            className="self-start text-11 text-accent-primary hover:underline"
          >
            Set the target to {renderFormattedDate(state.suggested_target)}
          </button>
        )}

        {/* Other lines against this same item — an approved purchase request
            leaves one. The panel edits a single line, so it has to say the sheet
            holds more rather than passing off the part as the whole. */}
        {(state.other_lines ?? 0) > 0 && (
          <p className="text-11 text-tertiary">
            {state.other_lines} more line{state.other_lines === 1 ? "" : "s"} on this item, on the Finance page.
          </p>
        )}

        {!canWrite && !recorded && isEditable && (
          <p className="text-11 text-tertiary">The project lead records what a purchase costs.</p>
        )}

        {open && (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="number"
                min={0}
                step="0.01"
                // The form only exists because a button was just pressed, so the
                // caret belongs in its first field; there is nothing to steal
                // focus from.
                // oxlint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="4000"
                aria-label="What the supplier charges"
                className={cn(input, "w-24")}
              />
              <select
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                aria-label="Currency"
                className={cn(input, "w-20")}
              >
                {/* A stored currency the list does not offer still has to render,
                    or the select would silently change the line's currency. */}
                {[...new Set([...CURRENCIES, draft.currency])].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={draft.supplier}
              onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              placeholder="Supplier — JLCPCB"
              aria-label="Supplier"
              className={cn(input, "w-full")}
            />
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                step="1"
                value={draft.leadTime}
                onChange={(e) => setDraft({ ...draft, leadTime: e.target.value })}
                placeholder="42"
                aria-label="Lead time in calendar days"
                className={cn(input, "w-20")}
              />
              {/* Calendar days, and it says so: a factory does not observe our
                  weekends, so six weeks is forty-two days whatever our calendar
                  thinks. Everywhere else in this fork a number of days means
                  WORKING days, which is exactly why this one has to be labelled. */}
              <span className="text-11 text-tertiary">calendar days&apos; lead time</span>
            </div>
            <label className="flex items-start gap-1.5">
              <input
                type="checkbox"
                checked={draft.replacesLabour}
                onChange={(e) => setDraft({ ...draft, replacesLabour: e.target.checked })}
                className="mt-0.5 size-3.5 shrink-0 text-accent-primary accent-current"
              />
              <span className="text-11 text-secondary">
                This is the whole cost — don&apos;t also count our time on it
                <span className="block text-tertiary">Untick for parts bought for work we still do ourselves.</span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !(Number(draft.amount) > 0)}
                className="rounded bg-accent-primary px-2 py-0.5 text-11 text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setDraft({
                    amount: state.amount == null ? "" : String(state.amount),
                    currency: state.currency,
                    supplier: state.supplier,
                    leadTime: state.lead_time_days == null ? "" : String(state.lead_time_days),
                    replacesLabour: state.replaces_labour,
                  });
                }}
                className="text-11 text-secondary hover:text-primary"
              >
                Cancel
              </button>
              {recorded && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="ml-auto text-11 text-tertiary hover:text-danger-primary"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </SidebarPropertyListItem>
  );
});
