/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One place that knows what to do when a date would cross its partner.
 *
 * A work item's window is edited from at least five surfaces — the peek panel,
 * the full work item page, the inline properties on the list and board layouts,
 * the sub-item rows and the spreadsheet columns. Every one of them clamped the
 * two pickers against each other and every one of them therefore refused in
 * silence. Fixing that per call site would mean five copies of the same decision
 * and five chances for them to drift, so the decision lives in
 * `date-pair.ts` and the wiring lives here: a caller replaces its `onChange` and
 * renders `dialog`, and it is done.
 *
 * The clamp itself (`minDate` / `maxDate`) has to come OFF at the call site as
 * well — a picker that will not let the day be clicked never reaches this hook.
 */
import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import type { TDateField, TDatePairEdit } from "@/plane-web/components/gantt-chart/date-pair";
import { resolveDatePairEdit } from "@/plane-web/components/gantt-chart/date-pair";
import { useWorkspaceHolidays } from "@/plane-web/components/gantt-chart/use-workspace-holidays";
import { DateShiftDialog } from "./date-shift-dialog";

type TPatch = { start_date?: string | null; target_date?: string | null };

type Options = {
  /** The item's dates right now. */
  current: { start_date?: string | null; target_date?: string | null };
  /** Write the patch. Whatever the caller already did on a date change. */
  apply: (patch: TPatch) => void | Promise<void>;
};

export const useDatePairEdit = ({ current, apply }: Options) => {
  const { workspaceSlug } = useParams();
  const [pending, setPending] = useState<(TDatePairEdit & { kind: "shift" }) | null>(null);
  const [busy, setBusy] = useState(false);
  // The same closures the gantt shades and the push steps over. Without them
  // "keeps the same duration" would mean something different here from what the
  // bar draws, and the two halves of the product would disagree about what a
  // working day is. One shared fetch per workspace; free after the first chart.
  const holidays = useWorkspaceHolidays(workspaceSlug?.toString());

  const onDateChange = useCallback(
    (field: TDateField, next: string | null | undefined) => {
      // `renderFormattedPayloadDate` answers undefined for a date it cannot
      // format; treated as a clear, which is what the pickers already did.
      const decision = resolveDatePairEdit(field, next ?? null, current, (iso) => !!holidays[iso]);
      // Only the inverting case asks. Everything else is the write it always was.
      if (decision.kind === "shift") {
        setPending(decision);
        return;
      }
      void apply(decision.patch);
    },
    [current, apply, holidays]
  );

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await apply(pending.patch);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }, [pending, apply]);

  return {
    onDateChange,
    /** Render this next to the pickers. Null until a date would cross its partner. */
    dialog: (
      <DateShiftDialog edit={pending} busy={busy} onConfirm={() => void confirm()} onCancel={() => setPending(null)} />
    ),
  };
};
