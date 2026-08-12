/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "That start date is after the end date. Move both?"
 *
 * The question the date pickers used to answer by themselves, silently and in the
 * negative: they clamped each other, so the day you wanted was greyed out with no
 * explanation. Almost nobody means "a task that ends before it begins"; what they
 * mean is that the whole thing moved. So the picker takes the date and this asks.
 *
 * Yes moves BOTH ends and keeps the duration. No changes nothing at all — not the
 * field, not the other end, no half-applied state. There is deliberately no third
 * option to clamp the date to the boundary: silently writing a date somebody did
 * not choose is how this feature got its reputation in the first place.
 *
 * `useModalShell` supplies Escape, the focus trap, initial focus, focus restore
 * and the scroll lock; four dialogs in this fork got those wrong by hand.
 */
import { observer } from "mobx-react";
import { CalendarRange } from "lucide-react";
import { renderFormattedDate } from "@plane/utils";
import { useModalShell } from "@/plane-web/components/common/use-modal-shell";
import type { TDatePairEdit } from "@/plane-web/components/gantt-chart/date-pair";

type Props = {
  /** The `shift` decision from `resolveDatePairEdit`, or null when nothing is asked. */
  edit: (TDatePairEdit & { kind: "shift" }) | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TITLE = "Move both dates?";

export const DateShiftDialog = observer(function DateShiftDialog(props: Props) {
  const { edit, busy = false, onConfirm, onCancel } = props;
  const { panelProps, backdropProps } = useModalShell({
    open: !!edit,
    onClose: onCancel,
    busy,
    label: TITLE,
  });

  if (!edit) return null;

  const settingStart = edit.moving === "target_date";
  const days = edit.duration;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" {...backdropProps} />
      <div
        className="shadow-xl relative w-full max-w-md rounded-lg border border-subtle bg-surface-1 p-4"
        {...panelProps}
      >
        <div className="flex items-start gap-3">
          <CalendarRange className="mt-0.5 size-5 flex-shrink-0 text-accent-primary" />
          <div className="min-w-0">
            <h2 className="text-14 font-medium text-primary">{TITLE}</h2>
            <p className="mt-1 text-12 text-secondary">
              {settingStart ? "That start date is after the end date." : "That end date is before the start date."}{" "}
              Moving both keeps this item {days} working {days === 1 ? "day" : "days"} long — the{" "}
              {settingStart ? "end" : "start"} date moves from {renderFormattedDate(edit.movingFrom)} to{" "}
              {renderFormattedDate(settingStart ? edit.patch.target_date : edit.patch.start_date)}.
            </p>
            <p className="mt-2 text-11 text-tertiary">
              {renderFormattedDate(edit.patch.start_date)} → {renderFormattedDate(edit.patch.target_date)}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-subtle px-3 py-1.5 text-12 text-secondary hover:bg-layer-2 hover:text-primary disabled:opacity-50"
          >
            Leave the dates alone
          </button>
          <button
            type="button"
            data-modal-initial-focus
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-accent-primary px-3 py-1.5 text-12 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Moving…" : "Move both"}
          </button>
        </div>
      </div>
    </div>
  );
});
