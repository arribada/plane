/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Give the undated work items dates": describe the project window, ask the
 * assistant for a proposal, then review every row before anything is written.
 * The deterministic dependency reflow sits next to it on purpose — it needs no
 * model, no key and no review, and it is the honest answer when the AI is not
 * configured or its suggestion is not trusted.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { GitBranch, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TAiPlan } from "@/plane-web/types/arribada";
import { PlanReviewTable, usePlanReview } from "./plan-review-table";
import { AiSettingsModal } from "./ai-settings-modal";
import { useAiSettings } from "./use-ai-settings";

type Props = {
  projectId: string | null;
  projectName?: string;
  onClose: () => void;
  onApplied?: (applied: number) => void;
  // The reflow writes without closing the modal, so it cannot share onApplied:
  // callers close on an apply, and the reflow result has to stay readable.
  onReflowed?: (moved: number) => void;
};

const errorMessage = (e: unknown, fallback: string) => (e as { error?: string })?.error ?? fallback;

export const AiPlanModal = observer(function AiPlanModal(props: Props) {
  const { projectId, projectName, onClose, onApplied, onReflowed } = props;
  const { workspaceSlug } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const { settings, refresh: refreshSettings } = useAiSettings();
  // Ties each label to its control without ids that would collide with the
  // wizard's copy of the same form.
  const uid = useId();

  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [durationDays, setDurationDays] = useState("5");
  const [context, setContext] = useState("");
  const [plan, setPlan] = useState<TAiPlan | null>(null);
  const review = usePlanReview(plan?.assignments);
  const [busy, setBusy] = useState<"suggest" | "apply" | "reflow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reflowed, setReflowed] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The project's own planned window is nearly always the window to plan inside.
  useEffect(() => {
    if (!projectId || !workspaceSlug) return;
    setPlan(null);
    setError(null);
    setReflowed(null);
    service
      .getSchedule(workspaceSlug.toString(), projectId)
      .then((s) => {
        setStartDate(s?.start_date ?? "");
        setTargetDate(s?.target_date ?? "");
        return undefined;
      })
      .catch(() => {});
  }, [projectId, workspaceSlug, service]);

  if (!projectId) return null;

  const slug = workspaceSlug?.toString() ?? "";
  const aiAvailable = settings?.configured !== false;

  const suggest = async () => {
    if (!slug || busy) return;
    setBusy("suggest");
    setError(null);
    setReflowed(null);
    try {
      setPlan(
        await service.aiPlan(slug, projectId, {
          start_date: startDate || null,
          target_date: targetDate || null,
          default_duration_days: Number(durationDays) || 5,
          context: context.trim(),
        })
      );
    } catch (e) {
      setError(errorMessage(e, "The assistant could not produce a plan."));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!slug || busy || review.approved.length === 0) return;
    setBusy("apply");
    setError(null);
    try {
      const res = await service.applyPlan(slug, projectId, review.approved);
      onApplied?.(res.applied);
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Could not write the dates."));
    } finally {
      setBusy(null);
    }
  };

  const reflow = async () => {
    if (!slug || busy) return;
    setBusy("reflow");
    setError(null);
    try {
      const res = await service.autoSchedule(slug, projectId);
      setReflowed(res.rescheduled);
      // This one writes immediately, so the caller has to refetch its timeline.
      onReflowed?.(res.rescheduled);
    } catch (e) {
      setError(errorMessage(e, "Could not reflow the dependencies."));
    } finally {
      setBusy(null);
    }
  };

  const field =
    "w-full rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-strong";
  const label = "mb-1 block text-11 font-medium uppercase tracking-wide text-secondary";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-0 bg-black/40"
          onClick={busy ? undefined : onClose}
        />
        <div className="shadow-2xl relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-subtle bg-layer-1">
          <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
            <h3 className="flex items-center gap-2 text-16 font-semibold text-primary">
              <Sparkles className="size-4 text-secondary" />
              Plan dates · {projectName ?? "Project"}
            </h3>
            <button type="button" onClick={onClose} disabled={!!busy} className="text-secondary hover:text-primary">
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {aiAvailable ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className={label} htmlFor={`${uid}-start`}>
                      Project start
                    </label>
                    <input
                      id={`${uid}-start`}
                      type="date"
                      className={field}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor={`${uid}-target`}>
                      Project target
                    </label>
                    <input
                      id={`${uid}-target`}
                      type="date"
                      className={field}
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor={`${uid}-duration`}>
                      Typical task length
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`${uid}-duration`}
                        type="number"
                        min={1}
                        max={90}
                        className={field}
                        value={durationDays}
                        onChange={(e) => setDurationDays(e.target.value)}
                      />
                      <span className="text-12 whitespace-nowrap text-secondary">working days</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={label} htmlFor={`${uid}-context`}>
                    Anything the model should know
                  </label>
                  <textarea
                    id={`${uid}-context`}
                    rows={2}
                    className={cn(field, "resize-none")}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="e.g. the field trip is in October, hardware bring-up must finish before firmware starts…"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={suggest}
                    disabled={!!busy}
                    className="flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-13 font-medium text-primary hover:bg-layer-2 disabled:opacity-50"
                  >
                    {busy === "suggest" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {plan ? "Suggest again" : "Suggest dates"}
                  </button>
                  <p className="text-12 text-tertiary">
                    The assistant only proposes — nothing is written until you press Apply.
                  </p>
                </div>

                {plan && <PlanReviewTable plan={plan} review={review} />}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-13 text-secondary">No AI provider is configured for this workspace.</p>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded border border-subtle px-2.5 py-1 text-12 text-secondary hover:bg-layer-2"
                >
                  Configure the assistant
                </button>
              </div>
            )}

            <div className="rounded-lg border border-subtle bg-layer-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={reflow}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 rounded border border-subtle bg-layer-1 px-3 py-1.5 text-13 font-medium text-primary hover:bg-layer-2 disabled:opacity-50"
                >
                  {busy === "reflow" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <GitBranch className="size-3.5" />
                  )}
                  Reflow along dependencies
                </button>
                <p className="flex-1 text-12 text-secondary">
                  No AI: pushes every item that is blocked by another until it starts after the item it waits on has
                  finished. Writes straight away.
                </p>
              </div>
              {reflowed !== null && (
                <p className="mt-2 text-12 text-secondary">
                  {reflowed === 0
                    ? "Nothing to move — every dependency already holds."
                    : `Moved ${reflowed} work item(s).`}
                </p>
              )}
            </div>

            {error && <p className="bg-red-500/10 text-red-600 rounded px-2.5 py-1.5 text-12">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-subtle px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!!busy || review.approved.length === 0}
              className={cn(
                "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90",
                (!!busy || review.approved.length === 0) && "opacity-50"
              )}
            >
              {busy === "apply" && <Loader2 className="size-3.5 animate-spin" />}
              Apply {review.approved.length} date{review.approved.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>

      <AiSettingsModal
        isOpen={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          refreshSettings();
        }}
      />
    </>
  );
});
