/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Takes a project lead through setting a project up the way this team actually runs
 * one: which of hardware, firmware and software it involves, who covers each
 * discipline and how many of them there are, which of the generic V-cycle tasks to
 * keep, whether it runs in sprints, and then — computed, not guessed — the dated plan
 * with an owner on every item.
 *
 * The order matters. Roles come before tasks because a task is assigned by discipline,
 * so a project with no roles recorded has nowhere to send the work. Tasks come before
 * the plan because the plan is a consequence of them. And the plan is only ever
 * proposed: nothing is written until the lead presses Create.
 *
 * Every answer lives in this component, so stepping back never loses what was typed.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, ChevronLeft, GitBranch, Loader2, Plus, Sparkles, Users, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type {
  TAiPlan,
  TBlueprintCatalogue,
  TProjectDocs,
  TSetupApplyResult,
  TSetupPlan,
  TTeamMember,
} from "@/plane-web/types/arribada";
import { PlanReviewTable, usePlanReview } from "./plan-review-table";
import { AiSettingsModal } from "./ai-settings-modal";
import { SetupPlanTable } from "./setup-plan-table";
import { SetupTaskPicker } from "./setup-task-picker";
import { useAiSettings } from "./use-ai-settings";

type Props = { projectId: string | null; onClose: () => void; onCompleted?: () => void };

type StepKey = "scope" | "team" | "tasks" | "cadence" | "plan" | "existing" | "links";

// The two tracks that are a yes/no with a length attached rather than a body of work
// the lead picks through.
const DURATION_TRACKS = new Set(["field", "production"]);

const errorMessage = (e: unknown, fallback: string) => {
  const body = e as { error?: string; start_date?: string[]; target_date?: string[] };
  return body?.error ?? body?.target_date?.[0] ?? body?.start_date?.[0] ?? fallback;
};

const today = () => new Date().toISOString().slice(0, 10);

function WizardProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex flex-col justify-center">
      <div className="text-11 font-medium text-tertiary">
        {current} of {total}
      </div>
      <div className="mx-1 my-0.5 flex w-32 items-center justify-center">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={`seg-${i}`}
            className={cn("-ml-0.5 h-1.5 w-full", {
              "bg-success-primary": i < current,
              "bg-surface-1": i >= current,
              "rounded-l-full": i === 0,
              "rounded-r-full": i === total - 1 || i === current - 1,
              "z-10": i === current - 1,
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
  const uid = useId();
  const slug = workspaceSlug?.toString() ?? "";

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<"step" | "plan" | "create" | "ai" | "apply" | "reflow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 1 — scope
  const [catalogue, setCatalogue] = useState<TBlueprintCatalogue | null>(null);
  const [tracks, setTracks] = useState<string[]>([]);
  const [fieldDays, setFieldDays] = useState("10");
  const [productionDays, setProductionDays] = useState("20");
  const [startDate, setStartDate] = useState(today());
  // 2 — team
  const [team, setTeam] = useState<TTeamMember[] | null>(null);
  const [capacity, setCapacity] = useState<Record<string, number>>({});
  // 3 — tasks
  const [taskKeys, setTaskKeys] = useState<Set<string>>(new Set());
  const [durations, setDurations] = useState<Record<string, number>>({});
  // 4 — cadence
  const [sprintMode, setSprintMode] = useState<"sprints" | "flow">("flow");
  const [sprintLength, setSprintLength] = useState("14");
  const [sprintCount, setSprintCount] = useState("");
  // 5 — plan
  const [useAi, setUseAi] = useState(true);
  const [context, setContext] = useState("");
  const [plan, setPlan] = useState<TSetupPlan | null>(null);
  const [endOverride, setEndOverride] = useState("");
  const [created, setCreated] = useState<TSetupApplyResult | null>(null);
  // 6 — work already in the project
  const [undatedCount, setUndatedCount] = useState<number | null>(null);
  // Latched when the wizard opens. The step list must not change shape underneath
  // someone: dating the leftover items would otherwise drop the step they are
  // standing on, and the confirmation with it.
  const [hasExistingWork, setHasExistingWork] = useState(false);
  const [aiPlan, setAiPlan] = useState<TAiPlan | null>(null);
  const review = usePlanReview(aiPlan?.assignments);
  const [applied, setApplied] = useState<number | null>(null);
  const [reflowed, setReflowed] = useState<number | null>(null);
  // 7 — links
  const [linksBase, setLinksBase] = useState<TProjectDocs | null>(null);
  const [docId, setDocId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [chatUrl, setChatUrl] = useState("");
  const [repos, setRepos] = useState<string[]>([]);
  const [repoDraft, setRepoDraft] = useState("");

  // Everything the wizard needs is loaded up front: a step must never wait on a fetch
  // the moment the user reaches it.
  useEffect(() => {
    if (!projectId || !slug) return;
    setIndex(0);
    setError(null);
    setPlan(null);
    setCreated(null);
    setApplied(null);
    setReflowed(null);
    setAiPlan(null);
    service
      .getTaskBlueprints(slug)
      .then((c) => setCatalogue(c ?? null))
      .catch(() => setCatalogue(null));
    service
      .getProjectTeam(slug, projectId)
      .then((r) => setTeam(r?.team ?? []))
      .catch(() => setTeam([]));
    service
      .getSchedule(slug, projectId)
      .then((s) => {
        if (s?.start_date) setStartDate(s.start_date);
        return undefined;
      })
      .catch(() => {});
    service
      .getProjectItems(slug, projectId, true)
      .then((r) => {
        setUndatedCount(r?.length ?? 0);
        setHasExistingWork((r?.length ?? 0) > 0);
        return undefined;
      })
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

  // How many people hold each discipline today. The default width of each track, and
  // what tells the lead which disciplines have nobody at all.
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const member of team ?? []) {
      for (const role of member.roles ?? []) {
        const key = role.trim().toLowerCase();
        if (key) counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [team]);

  // The tracks the lead picked, in catalogue order, with project management always in
  // front — a project with no kickoff and no review is not a project.
  const pickedTracks = useMemo(() => {
    if (!catalogue) return [];
    const chosen = new Set([...tracks, "pm"]);
    return catalogue.tracks.filter((t) => chosen.has(t.key) && !DURATION_TRACKS.has(t.key));
  }, [catalogue, tracks]);

  // Every discipline the current selection actually needs, so the capacity editor asks
  // about those and nothing else. Left in catalogue order — which is the order the work
  // happens in — rather than alphabetical.
  const rolesInPlay = useMemo<string[]>(() => {
    if (!catalogue) return [];
    const chosen = new Set([...tracks, "pm"]);
    const roles = new Set<string>();
    for (const track of catalogue.tracks) {
      if (!chosen.has(track.key)) continue;
      for (const task of track.tasks) if (taskKeys.has(task.key)) roles.add(task.role);
    }
    return [...roles];
  }, [catalogue, tracks, taskKeys]);

  const unstaffed = useMemo(
    () => new Set(rolesInPlay.filter((r) => !roleCounts[r.toLowerCase()]).map((r) => r.toLowerCase())),
    [rolesInPlay, roleCounts]
  );

  const trackLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const track of catalogue?.tracks ?? []) labels[track.key] = track.label;
    return labels;
  }, [catalogue]);

  // Selecting a component fills in its default tasks; clearing one takes them away.
  // Anything the lead ticked by hand inside a track they keep is left alone.
  const toggleTrack = useCallback(
    (trackKey: string) => {
      if (!catalogue) return;
      const track = catalogue.tracks.find((t) => t.key === trackKey);
      if (!track) return;
      setTracks((current) => {
        const on = current.includes(trackKey);
        setTaskKeys((keys) => {
          const updated = new Set(keys);
          for (const task of track.tasks) {
            if (on) updated.delete(task.key);
            else if (!task.optional) updated.add(task.key);
          }
          return updated;
        });
        return on ? current.filter((t) => t !== trackKey) : [...current, trackKey];
      });
    },
    [catalogue]
  );

  // Project management rides along with the first component chosen, and leaves with the
  // last one — its tasks are the reviews the others hang off.
  useEffect(() => {
    if (!catalogue) return;
    const pm = catalogue.tracks.find((t) => t.key === "pm");
    if (!pm) return;
    setTaskKeys((keys) => {
      const updated = new Set(keys);
      for (const task of pm.tasks) {
        if (tracks.length > 0 && !task.optional) updated.add(task.key);
        else if (tracks.length === 0) updated.delete(task.key);
      }
      return updated;
    });
  }, [catalogue, tracks.length]);

  const steps = useMemo(() => {
    const list: { key: StepKey; title: string }[] = [
      { key: "scope", title: "What does this project involve?" },
      { key: "team", title: "Who works on it?" },
      { key: "tasks", title: "Which tasks?" },
      { key: "cadence", title: "How do you want to run it?" },
      { key: "plan", title: "The plan" },
    ];
    if (hasExistingWork) list.push({ key: "existing", title: "Work already in this project" });
    list.push({ key: "links", title: "Where does the rest of the project live?" });
    return list;
  }, [hasExistingWork]);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  if (!projectId) return null;

  const aiAvailable = settings?.configured !== false;

  const finish = () => {
    onCompleted?.();
    onClose();
  };

  const recountUndated = () =>
    service
      .getProjectItems(slug, projectId, true)
      .then((r) => setUndatedCount(r?.length ?? 0))
      .catch(() => {});

  const buildPlan = async () => {
    if (busy) return;
    setBusy("plan");
    setError(null);
    try {
      const result = await service.setupPlan(slug, projectId, {
        tracks,
        task_keys: [...taskKeys],
        start_date: startDate || null,
        capacity,
        duration_overrides: durations,
        field_days: tracks.includes("field") ? Number(fieldDays) || null : null,
        production_days: tracks.includes("production") ? Number(productionDays) || null : null,
        sprints: {
          mode: sprintMode,
          length_days: sprintCount ? null : Number(sprintLength) || 14,
          count: sprintCount ? Number(sprintCount) : null,
        },
        use_ai: useAi && aiAvailable,
        context: context.trim(),
      });
      setPlan(result);
      setEndOverride(result.end_date);
    } catch (e) {
      setError(errorMessage(e, "Could not build a plan."));
    } finally {
      setBusy(null);
    }
  };

  const createPlan = async () => {
    if (busy || !plan) return;
    setBusy("create");
    setError(null);
    try {
      const result = await service.setupApply(slug, projectId, {
        tasks: plan.tasks,
        sprints: plan.sprints,
        create_modules: true,
        // The window is written here instead, so the lead's edited target date wins
        // over the one the schedule happened to land on.
        set_project_window: false,
      });
      setCreated(result);
      await service.updateSchedule(slug, projectId, {
        start_date: plan.start_date,
        target_date: endOverride || plan.end_date,
      });
      await recountUndated();
      onCompleted?.();
    } catch (e) {
      setError(errorMessage(e, "Could not create the work items."));
    } finally {
      setBusy(null);
    }
  };

  const suggestExisting = async () => {
    if (busy) return;
    setBusy("ai");
    setError(null);
    try {
      setAiPlan(
        await service.aiPlan(slug, projectId, {
          start_date: startDate || null,
          target_date: endOverride || plan?.end_date || null,
          default_duration_days: 5,
          context: context.trim(),
        })
      );
    } catch (e) {
      setError(errorMessage(e, "The assistant could not produce a plan."));
    } finally {
      setBusy(null);
    }
  };

  const applyExisting = async () => {
    if (busy || review.approved.length === 0) return;
    setBusy("apply");
    setError(null);
    try {
      const res = await service.applyPlan(slug, projectId, review.approved);
      setApplied(res.applied);
      setAiPlan(null);
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
    } catch (e) {
      setError(errorMessage(e, "Could not reflow the dependencies."));
    } finally {
      setBusy(null);
    }
  };

  const saveLinks = async () => {
    if (!linksBase) {
      setError("Couldn't read this project's current links — saving now could wipe them. Reopen the wizard, or skip.");
      return false;
    }
    const payload: Parameters<ArribadaService["setWikiDoc"]>[2] = {};
    const chat = chatUrl.trim();
    if (docId.trim() !== (linksBase.doc_id ?? "")) payload.doc_id = docId.trim();
    if (docTitle.trim() !== (linksBase.title ?? "")) payload.title = docTitle.trim();
    if (driveUrl.trim() !== (linksBase.google_drive_url ?? "")) payload.google_drive_url = driveUrl.trim();
    if (chat !== (linksBase.chat_url ?? "")) payload.chat_url = chat;
    if (repos.join("\n") !== (linksBase.github_repo_urls ?? []).join("\n")) payload.github_repo_urls = repos;
    if (Object.keys(payload).length > 0) await service.setWikiDoc(slug, projectId, payload);
    return true;
  };

  const next = async () => {
    if (busy) return;
    setError(null);
    // Reaching the plan step with nothing computed yet builds it, rather than showing
    // an empty page with a button on it.
    if (step.key === "cadence") {
      setIndex((i) => i + 1);
      await buildPlan();
      return;
    }
    if (isLast) {
      setBusy("step");
      try {
        if (await saveLinks()) finish();
      } catch (e) {
        setError(errorMessage(e, "Could not save the links."));
      } finally {
        setBusy(null);
      }
      return;
    }
    setIndex((i) => i + 1);
  };

  const addRepo = () => {
    const value = repoDraft.trim();
    if (!value) return;
    setRepos((list) => (list.includes(value) ? list : [...list, value]));
    setRepoDraft("");
  };

  const field =
    "w-full rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-strong";
  const label = "mb-1 block text-11 font-medium uppercase tracking-wide text-secondary";
  const hint = "text-12 text-secondary";
  const actionBtn =
    "flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-13 font-medium text-primary hover:bg-layer-2 disabled:opacity-50";

  const renderStep = () => {
    switch (step.key) {
      case "scope":
        return (
          <div className="space-y-4">
            <p className={hint}>
              Each component brings the tasks its discipline actually goes through — requirements and architecture
              first, then the build, then the testing that answers each of them.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(catalogue?.tracks ?? [])
                .filter((t) => t.key !== "pm" && !DURATION_TRACKS.has(t.key))
                .map((track) => (
                  <button
                    key={track.key}
                    type="button"
                    onClick={() => toggleTrack(track.key)}
                    aria-pressed={tracks.includes(track.key)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      tracks.includes(track.key)
                        ? "border-accent-strong bg-accent-primary/5"
                        : "border-subtle hover:bg-layer-2"
                    )}
                  >
                    <span className="block text-13 font-semibold text-primary">{track.label}</span>
                    <span className="mt-0.5 block text-11 text-secondary">{track.hint}</span>
                  </button>
                ))}
            </div>

            <div className="space-y-2">
              {(catalogue?.tracks ?? [])
                .filter((t) => DURATION_TRACKS.has(t.key))
                .map((track) => {
                  const on = tracks.includes(track.key);
                  const isField = track.key === "field";
                  return (
                    <div
                      key={track.key}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-subtle p-3"
                    >
                      <input
                        id={`${uid}-${track.key}`}
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleTrack(track.key)}
                        className="size-3.5 text-accent-primary"
                      />
                      <label htmlFor={`${uid}-${track.key}`} className="flex-1 text-13 text-primary">
                        {track.label}
                        <span className="ml-2 text-11 text-tertiary">{track.hint}</span>
                      </label>
                      {on && (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            max={365}
                            aria-label={
                              isField ? "Mission length in working days" : "Production length in working days"
                            }
                            className={cn(field, "w-20")}
                            value={isField ? fieldDays : productionDays}
                            onChange={(e) => (isField ? setFieldDays : setProductionDays)(e.target.value)}
                          />
                          <span className="text-12 text-secondary">working days</span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div>
              <label className={label} htmlFor={`${uid}-start`}>
                Start date
              </label>
              <input
                id={`${uid}-start`}
                type="date"
                className={cn(field, "w-44")}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>
        );

      case "team":
        return (
          <div className="space-y-3">
            <p className={hint}>
              Work is handed out by discipline, so this is what decides who each task goes to — and how many people
              cover a discipline is what decides whether its tasks run side by side or one after another.
            </p>
            {rolesInPlay.length === 0 ? (
              <p className="text-13 text-secondary">Pick a component first — the disciplines follow from the tasks.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rolesInPlay.map((role) => {
                  const held = roleCounts[role.toLowerCase()] ?? 0;
                  return (
                    <li key={role} className="flex items-center gap-2">
                      <Users className="size-3.5 flex-shrink-0 text-tertiary" />
                      <span className="min-w-0 flex-1 truncate text-13 text-primary">{role}</span>
                      <span className={cn("text-11", held ? "text-tertiary" : "text-amber-600")}>
                        {held ? `${held} on the roster` : "nobody on the roster"}
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        aria-label={`People working on ${role} at once`}
                        className={cn(field, "w-16")}
                        value={capacity[role.toLowerCase()] ?? Math.max(1, held)}
                        onChange={(e) =>
                          setCapacity((c) => ({
                            ...c,
                            [role.toLowerCase()]: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                          }))
                        }
                      />
                      <span className="w-16 flex-shrink-0 text-11 text-tertiary">at once</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {unstaffed.size > 0 && (
              <p className="bg-amber-500/10 text-amber-700 rounded px-2.5 py-1.5 text-12">
                {unstaffed.size} discipline(s) have nobody on the roster. The plan is still built and each work item
                records the discipline it needs — it is handed over automatically when someone picks it up. Add people
                from the project Overview, under Team &amp; roles.
              </p>
            )}
          </div>
        );

      case "tasks":
        return (
          <div className="space-y-3">
            <p className={hint}>
              {taskKeys.size} task(s) selected. Untick anything this project does not go through; a dependency on a task
              you drop is dropped with it, so the work behind it simply moves earlier.
            </p>
            <SetupTaskPicker
              tracks={pickedTracks}
              selected={taskKeys}
              durations={durations}
              unstaffed={unstaffed}
              onToggle={(key) =>
                setTaskKeys((keys) => {
                  const updated = new Set(keys);
                  if (updated.has(key)) updated.delete(key);
                  else updated.add(key);
                  return updated;
                })
              }
              onToggleTrack={(trackKey, on) => {
                const track = catalogue?.tracks.find((t) => t.key === trackKey);
                if (!track) return;
                setTaskKeys((keys) => {
                  const updated = new Set(keys);
                  for (const task of track.tasks) {
                    if (on) updated.add(task.key);
                    else updated.delete(task.key);
                  }
                  return updated;
                });
              }}
              onDuration={(key, days) => setDurations((d) => ({ ...d, [key]: Math.max(1, Math.min(365, days || 1)) }))}
            />
          </div>
        );

      case "cadence":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    key: "flow",
                    title: "Continuous flow",
                    hint: "One timeline. Work starts when what it waits on finishes.",
                  },
                  {
                    key: "sprints",
                    title: "Sprints",
                    hint: "The same plan, cut into fixed periods. Creates a cycle per sprint.",
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSprintMode(option.key)}
                  aria-pressed={sprintMode === option.key}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    sprintMode === option.key
                      ? "border-accent-strong bg-accent-primary/5"
                      : "border-subtle hover:bg-layer-2"
                  )}
                >
                  <span className="block text-13 font-semibold text-primary">{option.title}</span>
                  <span className="mt-0.5 block text-11 text-secondary">{option.hint}</span>
                </button>
              ))}
            </div>
            {sprintMode === "sprints" && (
              <div className="space-y-3 rounded-lg border border-subtle p-3">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className={label} htmlFor={`${uid}-sprint-length`}>
                      Sprint length
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={`${uid}-sprint-length`}
                        type="number"
                        min={1}
                        max={90}
                        className={cn(field, "w-20")}
                        value={sprintLength}
                        disabled={!!sprintCount}
                        onChange={(e) => setSprintLength(e.target.value)}
                      />
                      <span className="text-12 text-secondary">days</span>
                    </div>
                  </div>
                  <div>
                    <label className={label} htmlFor={`${uid}-sprint-count`}>
                      or a fixed number
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={`${uid}-sprint-count`}
                        type="number"
                        min={1}
                        max={52}
                        className={cn(field, "w-20")}
                        value={sprintCount}
                        placeholder="—"
                        onChange={(e) => setSprintCount(e.target.value)}
                      />
                      <span className="text-12 text-secondary">sprints</span>
                    </div>
                  </div>
                </div>
                <p className={hint}>
                  Give a length, or a number and the window is divided into that many. Each sprint becomes a Plane cycle
                  and every work item joins the one its start date falls in.
                </p>
              </div>
            )}
            <div className="space-y-2 border-t border-subtle pt-3">
              <label className="flex items-center gap-2 text-13 text-primary" htmlFor={`${uid}-use-ai`}>
                <input
                  id={`${uid}-use-ai`}
                  type="checkbox"
                  checked={useAi && aiAvailable}
                  disabled={!aiAvailable}
                  onChange={(e) => setUseAi(e.target.checked)}
                  className="size-3.5 text-accent-primary"
                />
                Let the assistant adapt the plan to this project
              </label>
              <p className={hint}>
                Dates are always computed from the dependencies and the number of people — the assistant only adjusts
                durations and adds tasks a generic list cannot know about.
                {!aiAvailable && " No AI provider is configured for this workspace."}
              </p>
              {!aiAvailable && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded border border-subtle px-2.5 py-1 text-12 text-secondary hover:bg-layer-2"
                >
                  Configure the assistant
                </button>
              )}
              <div>
                <label className={label} htmlFor={`${uid}-context`}>
                  Anything the assistant should know <span className="text-placeholder normal-case">(optional)</span>
                </label>
                <textarea
                  id={`${uid}-context`}
                  rows={2}
                  className={cn(field, "resize-none")}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="e.g. the tag has to survive 200 m of seawater and the field trip is in October…"
                />
              </div>
            </div>
          </div>
        );

      case "plan":
        // Only the first build blanks the step; a rebuild keeps the current plan on
        // screen so the lead can see what their change did to it.
        if (busy === "plan" && !plan)
          return (
            <div className="flex items-center gap-2 py-8 text-13 text-secondary">
              <Loader2 className="size-4 animate-spin" /> Working out the schedule…
            </div>
          );
        if (created)
          return (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-13 text-primary">
                <Check className="size-4 text-success-primary" />
                Created {created.created} work item(s), {created.relations} dependency link(s),
                {created.modules_created > 0 ? ` ${created.modules_created} module(s),` : ""}
                {created.cycles_created > 0 ? ` ${created.cycles_created} sprint(s),` : ""} and handed{" "}
                {created.assigned} of them to an owner.
              </p>
              {created.skipped.length > 0 && (
                <p className={hint}>
                  {created.skipped.length} task(s) already existed in this project and were left alone.
                </p>
              )}
              <p className={hint}>The timeline and the Overview now have something to draw.</p>
            </div>
          );
        if (!plan)
          return (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={buildPlan} disabled={!!busy} className={actionBtn}>
                <Sparkles className="size-3.5" />
                Build the plan
              </button>
            </div>
          );
        return (
          <div className="space-y-3">
            <SetupPlanTable plan={plan} trackLabels={trackLabels} />
            <div className="flex flex-wrap items-end gap-4 border-t border-subtle pt-3">
              <div>
                <label className={label} htmlFor={`${uid}-end`}>
                  Target date
                </label>
                <input
                  id={`${uid}-end`}
                  type="date"
                  className={cn(field, "w-44")}
                  value={endOverride}
                  onChange={(e) => setEndOverride(e.target.value)}
                />
              </div>
              <button type="button" onClick={buildPlan} disabled={!!busy} className={actionBtn}>
                {busy === "plan" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                Rebuild
              </button>
              <button
                type="button"
                onClick={createPlan}
                disabled={!!busy}
                className="ml-auto flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy === "create" && <Loader2 className="size-3.5 animate-spin" />}
                Create {plan.tasks.length} work items
              </button>
            </div>
            {endOverride && endOverride < plan.end_date && (
              <p className="bg-amber-500/10 text-amber-700 rounded px-2.5 py-1.5 text-12">
                The plan as selected finishes on {plan.end_date}. To hit {endOverride} you need fewer tasks, or more
                people on the disciplines that carry the longest chain.
              </p>
            )}
          </div>
        );

      case "existing":
        return (
          <div className="space-y-3">
            <p className={hint}>
              This project already has {undatedCount} work item(s) with no dates — from GitHub, or added by hand. The
              assistant can date and assign those too.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={suggestExisting} disabled={!!busy || !aiAvailable} className={actionBtn}>
                {busy === "ai" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {aiPlan ? "Suggest again" : "Suggest dates and owners"}
              </button>
              <button type="button" onClick={reflow} disabled={!!busy} className={actionBtn}>
                {busy === "reflow" ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
                Reflow along dependencies
              </button>
            </div>
            {reflowed !== null && (
              <p className={hint}>
                {reflowed === 0
                  ? "Nothing to move — every dependency already holds."
                  : `Moved ${reflowed} work item(s).`}
              </p>
            )}
            {aiPlan && (
              <>
                <PlanReviewTable plan={aiPlan} review={review} />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={applyExisting}
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
                <Check className="size-3.5" /> Wrote dates onto {applied} work item(s).
              </p>
            )}
          </div>
        );

      case "links":
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
        <div className="shadow-2xl relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-subtle bg-layer-1">
          <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-3">
            <div className="min-w-0">
              <h3 className="text-16 font-semibold text-primary">{step.title}</h3>
              <p className="text-11 text-tertiary">Project setup</p>
            </div>
            <div className="flex items-center gap-3">
              <WizardProgress current={index + 1} total={steps.length} />
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
                setIndex((i) => Math.max(0, i - 1));
              }}
              disabled={index === 0 || !!busy}
              className="flex items-center gap-1 rounded px-2 py-1.5 text-13 text-secondary hover:bg-layer-2 disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  if (isLast) finish();
                  else setIndex((i) => i + 1);
                }}
                disabled={!!busy}
                className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2 disabled:opacity-50"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={next}
                disabled={!!busy || (step.key === "scope" && tracks.length === 0)}
                className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy === "step" && <Loader2 className="size-3.5 animate-spin" />}
                {isLast ? "Finish" : "Next"}
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
