/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Asks what a task actually took, the moment it is marked finished.
 *
 * The one instant somebody knows the answer is the instant they close the item;
 * a week later it is a guess, and a form nobody is looking at never gets filled.
 * So it appears there, pre-filled with the estimate, and dismissing it costs one
 * key — an unanswered prompt must not be a blocked workflow.
 *
 * It is kept apart from the estimate on purpose. Overwriting the estimate with
 * the outcome would leave the project unable to answer the only question an
 * estimate is for afterwards: were we any good at estimating? And the budget
 * reads the actual in preference to the estimate, so answering this makes the
 * cost of the work true rather than planned.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Loader2, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueName: string;
  onClose: () => void;
};

export const ActualEffortPrompt = observer(function ActualEffortPrompt(props: Props) {
  const { workspaceSlug, projectId, issueId, issueName, onClose } = props;
  const [value, setValue] = useState("");
  const [planned, setPlanned] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const data = await service.getIssueEffort(workspaceSlug, projectId, issueId);
        if (!live) return;
        // Pre-filled with what was estimated — for most tasks that IS the answer,
        // and the ones where it is not are the ones worth typing.
        const seed = data.actual_days ?? data.days ?? data.derived ?? null;
        setPlanned(data.days ?? null);
        setValue(seed != null ? String(seed) : "");
      } catch {
        // Nothing recorded: the field starts empty rather than the prompt failing.
      } finally {
        if (live) setLoaded(true);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [workspaceSlug, projectId, issueId]);

  const parsed = Number.parseFloat(value.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= 999;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await service.setIssueActualEffort(workspaceSlug, projectId, issueId, parsed);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Recorded",
        message:
          planned != null && Math.abs(planned - parsed) >= 0.1
            ? `${parsed} d actual against ${planned} d estimated — the cost now uses the actual.`
            : "The project's cost now uses the real time rather than the calendar window.",
      });
      onClose();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't record it",
        message: (error as { error?: string })?.error ?? "Nothing was saved.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Skip" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="shadow-lg relative z-10 w-full max-w-md rounded-lg border border-subtle bg-layer-1">
        <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
          <h2 className="flex-1 text-14 font-medium text-primary">How long did it actually take?</h2>
          <button type="button" onClick={onClose} aria-label="Skip" className="text-tertiary hover:text-primary">
            <X className="size-4" />
          </button>
        </header>

        <div className="px-4 py-3">
          <p className="mb-1 truncate text-12 text-secondary" title={issueName}>
            {issueName}
          </p>
          <p className="mb-3 text-11 text-tertiary">
            Person-days of real work, not the window it sat in. Posting a parcel some time this week is an hour, not
            five days — and the project&apos;s cost uses this number.
          </p>
          <div className="flex items-center gap-2">
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by an action, not on page load
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid) {
                  e.preventDefault();
                  void save();
                }
                if (e.key === "Escape") onClose();
              }}
              inputMode="decimal"
              placeholder="0.5"
              aria-label="Person-days actually spent"
              className="w-28 rounded border border-subtle bg-layer-2 px-2 py-1.5 text-13 text-primary outline-none focus:border-accent-strong"
            />
            <span className="text-12 text-tertiary">person-days</span>
            {planned != null && <span className="ml-auto text-11 text-tertiary">estimated {planned} d</span>}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-subtle px-4 py-3">
          {/* Skipping is a first-class answer. A prompt that has to be satisfied
              before the board can move is a prompt people learn to resent. */}
          <button type="button" onClick={onClose} className="rounded border border-subtle px-3 py-1.5 text-12">
            Skip
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            className={cn(
              "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-12 text-on-color",
              !valid || saving ? "opacity-50" : "hover:opacity-90"
            )}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Record
          </button>
        </footer>
      </div>
    </div>
  );
});
