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
 * This panel used to be where that price was TYPED, and it no longer is. Money
 * is entered in the expense form and nowhere else: two places to enter a cost is
 * two sets of fields, two sets of validation and two answers to what a project
 * has spent, and this one had already grown its own opinion about which of an
 * item's several ledger lines it was editing.
 *
 * What stays is the reading. A work item whose cost is a supplier's invoice has
 * to SAY so on the screen somebody opens it from — otherwise "hardware
 * production" shows no effort, no cost and no explanation, and the only
 * available conclusion is that it is free. So: the figure, who is supplying it,
 * how long they said, and a link to the sheet where it lives.
 *
 * The one thing here that still writes is the suggested target date, and it
 * writes to the work item's own field rather than to any budget. A supplier's
 * lead time implies where the bar should end, and this is the only screen where
 * that can be acted on. Offered, never applied — the same contract as the effort
 * field: a bar that redrew itself the moment somebody typed a lead time is a bar
 * they stop trusting.
 */
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Banknote, Loader2 } from "lucide-react";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { apiErrorMessage } from "@/plane-web/services/api-error";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TIssueFixedCost } from "@/plane-web/types/arribada";

const service = new ArribadaService();

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
  const [busy, setBusy] = useState(false);
  // A supplier's invoice that will not load is the one thing on this panel whose
  // absence is read as a fact: the docstring above says so — an item showing no
  // effort, no cost and no explanation leaves "it is free" as the only available
  // conclusion. A failed request must not be allowed to make that argument.
  const [failure, setFailure] = useState<string | null>(null);

  // The load is keyed on the item, and a panel switched between two work items
  // reuses the component — so a reply that arrives after the switch must not
  // paint the previous item's price onto the current one.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const load = async () => {
      try {
        const data = await service.getIssueFixedCost(workspaceSlug, projectId, issueId);
        if (live.current) {
          setState(data);
          setFailure(null);
        }
      } catch (error) {
        // A field that will not load must not break the panel it sits in — nor
        // disappear from it without a word.
        if (live.current) {
          setState(null);
          setFailure(apiErrorMessage(error, "The supplier cost could not be read."));
        }
      }
    };
    if (workspaceSlug && projectId && issueId) void load();
    return () => {
      live.current = false;
    };
  }, [workspaceSlug, projectId, issueId]);

  const recorded = !!state && state.expense_id != null && state.total != null;

  if (failure)
    return (
      <SidebarPropertyListItem icon={Banknote} label="Supplier cost">
        <p role="alert" className="py-1 text-11 text-danger-primary">
          Couldn&apos;t load it. {failure} Do not read this item as costing nothing — check the Finance page.
        </p>
      </SidebarPropertyListItem>
    );

  // Nothing recorded and nothing to suggest is nothing to say. The row used to
  // render an em dash and an "Add a fixed cost" button; with the button gone, an
  // em dash on every work item in the instance is a line of furniture.
  if (!state || (!recorded && !state.suggested_target)) return null;

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
        {recorded && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
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

        {state.suggested_target && isEditable && (
          <button
            type="button"
            onClick={() => void applySuggestion()}
            disabled={busy}
            className="self-start text-11 text-accent-primary hover:underline"
          >
            Set the target to {renderFormattedDate(state.suggested_target)}
          </button>
        )}

        {/* Read-only, and it says where to go instead. Somebody who opens this
            item to change the figure must be able to find the one screen that
            can — otherwise the field reads as broken rather than as elsewhere. */}
        {recorded && (
          <p className="text-11 text-tertiary">
            {(state.other_lines ?? 0) > 0 && (
              <>
                {state.other_lines} more line{state.other_lines === 1 ? "" : "s"} on this item.{" "}
              </>
            )}
            Entered and changed on the{" "}
            <Link href={`/${workspaceSlug}/projects/${projectId}/finance`} className="text-accent-primary underline">
              Finance page
            </Link>
            .
          </p>
        )}
      </div>
    </SidebarPropertyListItem>
  );
});
