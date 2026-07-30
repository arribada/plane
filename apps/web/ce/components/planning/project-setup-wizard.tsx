/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Walks a project lead through the five things a project needs before its
 * timeline means anything: a window, a sense of task size, dependencies that
 * hold, dates on the undated work, and links to where the rest of the project
 * lives. Every step is skippable and every answer is kept in this component, so
 * going back never loses what was typed.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, ChevronLeft, GitBranch, Loader2, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TAiPlan, TProjectDocs } from "@/plane-web/types/arribada";
import { PlanReviewTable, usePlanReview } from "./plan-review-table";
import { AiSettingsModal } from "./ai-settings-modal";
import { useAiSettings } from "./use-ai-settings";

type Props = { projectId: string | null; onClose: () => void; onCompleted?: () => void };

const STEPS = [
  "When does this project run?",
  "How long does a typical task take?",
  "Dependencies",
  "Dates and owners for the undated work",
  "Where does the rest of the project live?",
];

// The schedule endpoint answers with DRF field errors ("target date before start
// date"), everything else with {error}. Both are worth showing as they are.
const errorMessage = (e: unknown, fallback: string) => {
  const body = e as { error?: string; start_date?: string[]; target_date?: string[] };
  return body?.error ?? body?.target_date?.[0] ?? body?.start_date?.[0] ?? fallback;
};

// Same segmented bar as the onboarding flow, sized for a modal header.
function WizardProgress({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex flex-col justify-center">
      <div className="text-11 font-medium text-tertiary">
        {currentStep} of {STEPS.length}
      </div>
      <div className="mx-1 my-0.5 flex w-32 items-center justify-center">
        {STEPS.map((stepTitle, i) => (
          <div
            key={stepTitle}
            className={cn("-ml-0.5 h-1.5 w-full", {
              "bg-success-primary": i < currentStep,
              "bg-surface-1": i >= currentStep,
              "rounded-l-full": i === 0,
              "rounded-r-full": i === STEPS.length - 1 || i === currentStep - 1,
              "z-10": i === currentStep - 1,
            })}
          />
        ))}
      </div>
    </div>
  );
}

export const ProjectSetupWizard = observer(function ProjectSetupWizard({ projectId, onClose, onCompleted }: Props) {
  const { workspaceSlug } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const { settings, refresh: refreshSettings } = useAiSettings();
  // Ties each label to its control without ids that would collide with the plan
  // modal, which asks for the same things.
  const uid = useId();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<"step" | "plan" | "apply" | "reflow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 1 — window
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  // What the prefills read back, or null when they failed. Both writes are
  // destructive when they are guessed: an empty date clears the window and an
  // empty link key clears the link, so nothing is sent until these are known.
  const [scheduleBase, setScheduleBase] = useState<{ start_date: string | null; target_date: string | null } | null>(
    null
  );
  const [linksBase, setLinksBase] = useState<TProjectDocs | null>(null);
  // 2 — task size
  const [durationDays, setDurationDays] = useState("5");
  const [undatedCount, setUndatedCount] = useState<number | null>(null);
  // 3 — dependencies
  const [reflowed, setReflowed] = useState<number | null>(null);
  // 4 — proposal
  const [context, setContext] = useState("");
  const [plan, setPlan] = useState<TAiPlan | null>(null);
  const review = usePlanReview(plan?.assignments);
  const [applied, setApplied] = useState<number | null>(null);
  // Owners actually written: the API refuses anyone who is not an assignable
  // member of the project, so this is usually lower than the rows applied.
  const [assigned, setAssigned] = useState(0);
  // 5 — links
  const [docId, setDocId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [chatUrl, setChatUrl] = useState("");
  const [repos, setRepos] = useState<string[]>([]);
  const [repoDraft, setRepoDraft] = useState("");

  const slug = workspaceSlug?.toString() ?? "";

  // Everything the wizard edits is loaded up front: a step must never wait on a
  // fetch the moment the user reaches it.
  useEffect(() => {
    if (!projectId || !slug) return;
    setStep(1);
    setError(null);
    setPlan(null);
    setApplied(null);
    setAssigned(0);
    setReflowed(null);
    setScheduleBase(null);
    setLinksBase(null);
    service
      .getSchedule(slug, projectId)
      .then((s) => {
        setScheduleBase({ start_date: s?.start_date ?? null, target_date: s?.target_date ?? null });
        setStartDate(s?.start_date ?? "");
        setTargetDate(s?.target_date ?? "");
        return undefined;
      })
      .catch(() => {});
    service
      .getProjectItems(slug, projectId, true)
      .then((r) => setUndatedCount(r?.length ?? 0))
      .catch(() => setUndatedCount(null));
    service
      .getWikiDoc(slug, projectId)
      .then((d) => {
        setLinksBase({
          doc_id: d?.doc_id ?? null,
          workspace_id: d?.workspace_id ?? null,
          title: d?.title ?? null,
          google_drive_url: d?.google_drive_url ?? null,
          chat_url: d?.chat_url ?? null,
          github_repo_urls: d?.github_repo_urls ?? [],
        });
        setDocId(d?.doc_id ?? "");
        setDocTitle(d?.title ?? "");
        setDriveUrl(d?.google_drive_url ?? "");
        setChatUrl(d?.chat_url ?? "");
        setRepos(d?.github_repo_urls ?? []);
        return undefined;
      })
      .catch(() => {});
  }, [projectId, slug, service]);

  if (!projectId) return null;

  const aiAvailable = settings?.configured !== false;

  const recountUndated = () =>
    service
      .getProjectItems(slug, projectId, true)
      .then((r) => setUndatedCount(r?.length ?? 0))
      .catch(() => {});

  const finish = () => {
    onCompleted?.();
    onClose();
  };

  const next = async () => {
    if (busy) return;
    setError(null);
    setBusy("step");
    try {
      if (step === 1) {
        if (!scheduleBase) {
          setError(
            "Couldn't read this project's current dates — saving now could clear them. Reopen the wizard, or skip this step."
          );
          return;
        }
        const patch: { start_date?: string | null; target_date?: string | null } = {};
        if ((startDate || null) !== scheduleBase.start_date) patch.start_date = startDate || null;
        if ((targetDate || null) !== scheduleBase.target_date) patch.target_date = targetDate || null;
        if (Object.keys(patch).length > 0) await service.updateSchedule(slug, projectId, patch);
      }
      if (step === STEPS.length) {
        if (!linksBase) {
          setError(
            "Couldn't read this project's current links — saving now could wipe them. Reopen the wizard, or skip this step."
          );
          return;
        }
        // An empty key means "clear this link" server-side, so untouched fields
        // stay out of the payload entirely.
        const payload: Parameters<ArribadaService["setWikiDoc"]>[2] = {};
        const chat = chatUrl.trim();
        if (docId.trim() !== (linksBase.doc_id ?? "")) payload.doc_id = docId.trim();
        if (docTitle.trim() !== (linksBase.title ?? "")) payload.title = docTitle.trim();
        if (driveUrl.trim() !== (linksBase.google_drive_url ?? "")) payload.google_drive_url = driveUrl.trim();
        if (chat !== (linksBase.chat_url ?? "")) payload.chat_url = chat;
        if (repos.join("\n") !== (linksBase.github_repo_urls ?? []).join("\n")) payload.github_repo_urls = repos;
        if (Object.keys(payload).length > 0) await service.setWikiDoc(slug, projectId, payload);
        finish();
        return;
      }
      setStep((s) => s + 1);
    } catch (e) {
      setError(errorMessage(e, "Could not save this step."));
    } finally {
      setBusy(null);
    }
  };

  const skip = () => {
    setError(null);
    if (step === STEPS.length) finish();
    else setStep((s) => s + 1);
  };

  const suggest = async () => {
    if (busy) return;
    setBusy("plan");
    setError(null);
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
    if (busy || review.approved.length === 0) return;
    setBusy("apply");
    setError(null);
    try {
      // review.approved already carries the owners the user kept on each row.
      const res = await service.applyPlan(slug, projectId, review.approved);
      setApplied(res.applied);
      setAssigned(res.assigned ?? 0);
      setPlan(null);
      await recountUndated();
    } catch (e) {
      setError(errorMessage(e, "Could not write the dates."));
    } finally {
      setBusy(null);
    }
  };

  const reflow = async () => {
    if (busy) return;
    setBusy("reflow");
    setError(null);
    try {
      const res = await service.autoSchedule(slug, projectId);
      setReflowed(res.rescheduled);
      await recountUndated();
    } catch (e) {
      setError(errorMessage(e, "Could not reflow the dependencies."));
    } finally {
      setBusy(null);
    }
  };

  const addRepo = () => {
    const v = repoDraft.trim();
    if (!v) return;
    // De-duplicated here as well as server-side, so the list the user sees is the list saved.
    setRepos((list) => (list.includes(v) ? list : [...list, v]));
    setRepoDraft("");
  };

  const field =
    "w-full rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-strong";
  const label = "mb-1 block text-11 font-medium uppercase tracking-wide text-secondary";
  const hint = "text-12 text-secondary";
  const actionBtn =
    "flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-13 font-medium text-primary hover:bg-layer-2 disabled:opacity-50";

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-3">
            <p className={hint}>This window is what the timeline draws against and what the assistant plans inside.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor={`${uid}-start`}>
                  Start
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
                  Target
                </label>
                <input
                  id={`${uid}-target`}
                  type="date"
                  className={field}
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-3">
            <p className={hint}>Used as the default length whenever nothing better is known about a work item.</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={90}
                className={cn(field, "w-24")}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
              />
              <span className="text-13 text-secondary">working days</span>
            </div>
            <p className={hint}>
              {undatedCount === null
                ? "Could not read how many work items are undated."
                : undatedCount === 0
                  ? "Every work item in this project already has dates."
                  : `${undatedCount} work item(s) currently have no dates — step 4 gives them some.`}
            </p>
          </div>
        );

      case 3:
        return (
          <div className="space-y-3">
            <p className={hint}>
              The scheduler respects blocked-by and finish-before links: an item never starts before the item it waits
              on has finished. Reflowing pushes every dependent item forward until that rule holds again — it is
              deterministic, uses no AI, and writes straight away.
            </p>
            <button type="button" onClick={reflow} disabled={!!busy} className={actionBtn}>
              {busy === "reflow" ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
              Reflow along dependencies
            </button>
            {reflowed !== null && (
              <p className={hint}>
                {reflowed === 0
                  ? "Nothing to move — every dependency already holds."
                  : `Moved ${reflowed} work item(s).`}
              </p>
            )}
          </div>
        );

      case 4:
        if (!aiAvailable)
          return (
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
          );
        return (
          <div className="space-y-3">
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
              <button type="button" onClick={suggest} disabled={!!busy} className={actionBtn}>
                {busy === "plan" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {plan ? "Suggest again" : "Suggest dates"}
              </button>
              <p className="text-12 text-tertiary">
                The assistant only proposes — nothing is written until you press Apply.
              </p>
            </div>
            {plan && (
              <>
                <PlanReviewTable plan={plan} review={review} />
                <div className="flex justify-end">
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
              </>
            )}
            {applied !== null && (
              <p className="flex items-center gap-1.5 text-12 text-secondary">
                <Check className="size-3.5" /> Wrote dates onto {applied} work item(s)
                {applied > 0 &&
                  (assigned > 0
                    ? `, and an owner onto ${assigned} of them`
                    : " — no owner was set, nobody proposed is an assignable member of this project")}
                .
              </p>
            )}
          </div>
        );

      case 5:
        return (
          <div className="space-y-3">
            <p className={hint}>Wiki, files, chat and code. A bare wiki doc id or a full URL both work.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor={`${uid}-doc-id`}>
                  Wiki doc id or URL
                </label>
                <input
                  id={`${uid}-doc-id`}
                  className={field}
                  value={docId}
                  onChange={(e) => setDocId(e.target.value)}
                  placeholder="doc id or https://docs.arribada.org/…"
                />
              </div>
              <div>
                <label className={label} htmlFor={`${uid}-doc-title`}>
                  Wiki label <span className="text-placeholder normal-case">(optional)</span>
                </label>
                <input
                  id={`${uid}-doc-title`}
                  className={field}
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g. Project handbook"
                />
              </div>
            </div>
            <div>
              <label className={label} htmlFor={`${uid}-drive`}>
                Google Drive folder
              </label>
              <input
                id={`${uid}-drive`}
                className={field}
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
                placeholder="https://drive.google.com/…"
              />
            </div>
            <div>
              <label className={label} htmlFor={`${uid}-chat`}>
                Chat channel
              </label>
              <input
                id={`${uid}-chat`}
                className={field}
                value={chatUrl}
                onChange={(e) => setChatUrl(e.target.value)}
                placeholder="https://chat.arribada.org/arribada/channels/…"
              />
            </div>
            <div>
              <label className={label} htmlFor={`${uid}-repo`}>
                GitHub repos
              </label>
              <div className="space-y-1.5">
                {repos.map((url) => (
                  <div key={url} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-13 text-primary">{url}</span>
                    <button
                      type="button"
                      onClick={() => setRepos((list) => list.filter((u) => u !== url))}
                      className="hover:text-red-600 text-tertiary"
                      title="Remove"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    id={`${uid}-repo`}
                    className={field}
                    value={repoDraft}
                    onChange={(e) => setRepoDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRepo();
                      }
                    }}
                    placeholder="https://github.com/arribada/…"
                  />
                  <button type="button" onClick={addRepo} className={actionBtn}>
                    <Plus className="size-3.5" />
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-0 bg-black/40"
          onClick={busy ? undefined : onClose}
        />
        <div className="shadow-2xl relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-subtle bg-layer-1">
          <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-3">
            <div className="min-w-0">
              <h3 className="text-16 font-semibold text-primary">{STEPS[step - 1]}</h3>
              <p className="text-11 text-tertiary">Project setup</p>
            </div>
            <div className="flex items-center gap-3">
              <WizardProgress currentStep={step} />
              <button type="button" onClick={onClose} disabled={!!busy} className="text-secondary hover:text-primary">
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {renderStep()}
            {error && <p className="bg-red-500/10 text-red-600 mt-3 rounded px-2.5 py-1.5 text-12">{error}</p>}
          </div>

          <div className="flex items-center justify-between border-t border-subtle px-5 py-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep((s) => Math.max(1, s - 1));
              }}
              disabled={step === 1 || !!busy}
              className="flex items-center gap-1 rounded px-2 py-1.5 text-13 text-secondary hover:bg-layer-2 disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={skip}
                disabled={!!busy}
                className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2 disabled:opacity-50"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={next}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy === "step" && <Loader2 className="size-3.5 animate-spin" />}
                {step === STEPS.length ? "Finish" : "Next"}
              </button>
            </div>
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
