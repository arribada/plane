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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, ChevronLeft, GitBranch, Loader2, Plus, Sparkles, Users, X } from "lucide-react";
import { cn } from "@plane/utils";
import { OverviewTeamBlock } from "@/plane-web/components/projects/overview/team-block";
import { apiErrorMessage } from "@/plane-web/services/api-error";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type {
  TAiPlan,
  TBlueprintCatalogue,
  TProjectDocs,
  TSetupApplyResult,
  TPlannedTask,
  TSetupPlan,
  TTeamMember,
} from "@/plane-web/types/arribada";
import { PlanReviewTable, usePlanReview } from "./plan-review-table";
import { AiSettingsModal } from "./ai-settings-modal";
import { SetupPlanTable } from "./setup-plan-table";
import { SetupTaskPicker } from "./setup-task-picker";
import { SprintTaskEditor, newSprintTask, type TSprintTask } from "./sprint-task-editor";
import { useAiSettings } from "./use-ai-settings";
import { useModalShell } from "@/plane-web/components/common/use-modal-shell";
import { todayIso } from "@/plane-web/components/gantt-chart/working-days";

type Props = { projectId: string | null; onClose: () => void; onCompleted?: () => void };

type StepKey = "mode" | "scope" | "team" | "tasks" | "cadence" | "plan" | "existing" | "links" | "sprint";

/**
 * What the wizard was opened to do.
 *
 * It used to assume "set up a whole project", and asked how to run it as the
 * second question. But a project that already runs does not need its scope, its
 * roster or its links re-answered to gain one sprint — and walking eight steps
 * to add a fortnight of work is how a tool teaches people to plan outside it.
 */
type SetupMode = "vcycle" | "agile" | "sprint";

// The two tracks that are a yes/no with a length attached rather than a body of work
// the lead picks through.
const DURATION_TRACKS = new Set(["field", "production"]);

// Offered when adding a discipline by hand. The same vocabulary the roster and the
// task catalogue use, so a typed one lands on an existing name rather than a
// near-miss nobody's tasks ask for. Free text is still accepted.
const ROLE_SUGGESTIONS = [
  "hardware engineer",
  "embedded firmware",
  "software",
  "mechanical",
  "designer",
  "data / science",
  "field ops",
  "QA / test",
  "reviewer",
  "project manager",
];

/** The wizard's own field errors first — a rejected date range answers with the
 *  field, not with `error` — then the shared reading, which knows a dropped
 *  connection from a refusal. */
const errorMessage = (e: unknown, fallback: string) => {
  const body = e as { error?: string; start_date?: string[]; target_date?: string[] };
  return body?.error ?? body?.target_date?.[0] ?? body?.start_date?.[0] ?? apiErrorMessage(e, fallback);
};

/** The reader's own day, which is the one the wizard's date fields are pre-filled
 *  with and the one a lead reads back. `toISOString()` answers in UTC: a plan
 *  started on a Monday morning in Auckland opened dated Sunday. `addDays` below
 *  stays on UTC quite correctly — it operates on a date STRING, not an instant. */
const today = todayIso;

/** Calendar days, on the date string itself. UTC on purpose: these are dates, not
 *  instants, and going through local midnight is what makes a plan built in
 *  Auckland start a day before the one built in Bristol. */
const addDays = (date: string, days: number): string => {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
};

/** ISO dates sort as text, so the earlier one is just the smaller string. */
const minDate = (a: string, b: string): string => (a <= b ? a : b);

/** Mon–Fri days in the inclusive range — the working-day budget the plan has to fit into. */
const weekdaysBetween = (start: string, end: string): number => {
  if (!start || !end || end < start) return 0;
  let count = 0;
  let ms = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(ms) || Number.isNaN(endMs)) return 0;
  while (ms <= endMs) {
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    ms += 86_400_000;
  }
  return count;
};

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
  // ARRIBADA: an optional delivery deadline set up front, so the plan is fitted to the window
  // between start and end rather than only computed forward from the start.
  const [endDate, setEndDate] = useState("");
  // 2 — team
  const [team, setTeam] = useState<TTeamMember[] | null>(null);
  const [capacity, setCapacity] = useState<Record<string, number>>({});
  // Disciplines the lead added on top of the ones the chosen tasks imply, and the
  // ones they took out of the list.
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  // {task key: discipline the lead moved it to}. Only holds real changes — moving a
  // task back to its catalogue discipline drops the entry rather than pinning it.
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>({});
  const [removedRoles, setRemovedRoles] = useState<Set<string>>(new Set());
  const [roleDraft, setRoleDraft] = useState("");
  // 3 — tasks
  const [taskKeys, setTaskKeys] = useState<Set<string>>(new Set());
  const [durations, setDurations] = useState<Record<string, number>>({});
  // 2 — cadence. Running in sprints is not a way of slicing the V: it is a different
  // set of tasks, so this answer is what decides which one the wizard offers.
  const [setupMode, setSetupMode] = useState<SetupMode>("vcycle");
  const [sprintName, setSprintName] = useState("");
  const [sprintTasks, setSprintTasks] = useState<TSprintTask[]>([]);
  const [sprintContext, setSprintContext] = useState("");
  const [sprintMode, setSprintMode] = useState<"sprints" | "flow">("flow");
  const [sprintLength, setSprintLength] = useState("14");
  const [sprintCount, setSprintCount] = useState("6");
  const [ceremonies, setCeremonies] = useState<string[]>(["plan", "test", "review"]);
  // 5 — plan
  const [useAi, setUseAi] = useState(true);
  const [context, setContext] = useState("");
  const [plan, setPlan] = useState<TSetupPlan | null>(null);
  // {task key: user id} — only the tasks the lead named an owner for. Everything
  // else is left to the schedule, which picks whoever holds the discipline.
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  // Dates typed on the review table, and dependencies redrawn there. Both outrank
  // the generated plan: the schedule reflows around them rather than overwriting.
  const [fixedDates, setFixedDates] = useState<Record<string, { start_date: string; target_date: string }>>({});
  const [dependencies, setDependencies] = useState<Record<string, string[]>>({});
  const [endOverride, setEndOverride] = useState("");
  const [created, setCreated] = useState<TSetupApplyResult | null>(null);
  // Whether the lead has typed a delivery date. A ref, not state: nothing renders
  // from it, and it must not make the plan rebuild.
  const endTouched = useRef(false);
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
    setAssignees({});
    setFixedDates({});
    setDependencies({});
    setCreated(null);
    endTouched.current = false;
    setApplied(null);
    setReflowed(null);
    setAiPlan(null);
    // The catalogue IS the scope step: without it every track grid renders empty
    // and the wizard looks like a product with no blueprints rather than one that
    // could not fetch them. Same for the roster — an empty team silently disables
    // every assignment the wizard was opened to make.
    service
      .getTaskBlueprints(slug)
      .then((c) => setCatalogue(c ?? null))
      .catch((e: unknown) => {
        setCatalogue(null);
        setError(
          errorMessage(e, "Couldn't load the task blueprints, so there is nothing to choose from on the next step.")
        );
      });
    service
      .getProjectTeam(slug, projectId)
      .then((r) => setTeam(r?.team ?? []))
      .catch((e: unknown) => {
        setTeam([]);
        setError(errorMessage(e, "Couldn't load this project's roster, so nothing can be assigned to anybody."));
      });
    service
      .getSchedule(slug, projectId)
      .then((s) => {
        if (s?.start_date) setStartDate(s.start_date);
        if (s?.target_date) setEndDate(s.target_date);
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
          // The wizard still asks for ONE Drive link, because setting a project up
          // is the moment you have one folder rather than four. The endpoint maps
          // `google_drive_url` onto the FIRST entry and leaves any others alone,
          // so a project that has since grown a list is not flattened by a
          // re-run — carried here so the "has this changed" comparison below is
          // made against the same value the panel shows.
          google_drive_links: d?.google_drive_links ?? [],
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
      // The discipline the task will actually be done by, which is the lead's
      // reassignment where there is one. Reading the catalogue's instead would keep
      // asking the capacity step to staff a discipline no remaining task needs.
      for (const task of track.tasks) if (taskKeys.has(task.key)) roles.add(roleOverrides[task.key] ?? task.role);
    }
    // Plus the ones the lead added by hand, minus the ones they took out. Taking a
    // discipline off the roster no longer strands the tasks that named it — they can
    // be moved onto another discipline on the task step.
    for (const role of extraRoles) roles.add(role);
    return [...roles].filter((role) => !removedRoles.has(role.toLowerCase()));
  }, [catalogue, tracks, taskKeys, extraRoles, removedRoles, roleOverrides]);

  // What the discipline picker on the task step offers: everything this project is
  // already staffing, plus every discipline somebody on the roster actually holds
  // (they may hold one no current task needs — that is exactly what you want to
  // move an orphaned task onto).
  const roleOptions = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const role of [...rolesInPlay, ...Object.keys(roleCounts)]) {
      const key = role.trim().toLowerCase();
      if (!key || seen.has(key) || removedRoles.has(key)) continue;
      seen.add(key);
      out.push(role.trim());
    }
    return out;
  }, [rolesInPlay, roleCounts, removedRoles]);

  const addRole = useCallback((value: string) => {
    const role = value.trim().slice(0, 80);
    if (!role) return;
    setRemovedRoles((current) => {
      if (!current.has(role.toLowerCase())) return current;
      const next = new Set(current);
      next.delete(role.toLowerCase());
      return next;
    });
    setExtraRoles((current) =>
      current.some((r) => r.toLowerCase() === role.toLowerCase()) ? current : [...current, role]
    );
    setRoleDraft("");
  }, []);

  const removeRole = useCallback((role: string) => {
    setExtraRoles((current) => current.filter((r) => r.toLowerCase() !== role.toLowerCase()));
    setRemovedRoles((current) => new Set(current).add(role.toLowerCase()));
  }, []);

  const unstaffed = useMemo(
    () => new Set(rolesInPlay.filter((r) => !roleCounts[r.toLowerCase()]).map((r) => r.toLowerCase())),
    [rolesInPlay, roleCounts]
  );

  // Sprints mean the iteration blocks; a continuous flow means the V.
  const agile = sprintMode === "sprints";

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
    const list: { key: StepKey; title: string }[] = [{ key: "mode", title: "What are we doing?" }];

    // Adding one sprint to a project that already runs: its scope, roster and
    // links have all been answered before, and re-asking them is how somebody
    // learns to plan the next sprint in a spreadsheet instead.
    if (setupMode === "sprint") {
      list.push({ key: "cadence", title: "When does the sprint run?" });
      list.push({ key: "sprint", title: "What is in it?" });
      return list;
    }

    list.push({ key: "scope", title: "What does this project involve?" });
    // Only the agile route still asks about cadence, and only for the length:
    // choosing the V-cycle on step one has already answered the rest, and asking
    // twice is how the two answers end up disagreeing.
    if (setupMode === "agile") list.push({ key: "cadence", title: "How long is a sprint?" });
    list.push({ key: "team", title: "Who works on it?" });
    list.push({ key: "tasks", title: agile ? "Which ceremonies?" : "Which tasks?" });
    list.push({ key: "plan", title: "The plan" });
    if (hasExistingWork) list.push({ key: "existing", title: "Work already in this project" });
    list.push({ key: "links", title: "Where does the rest of the project live?" });
    return list;
  }, [hasExistingWork, agile, setupMode]);

  // Escape, a focus trap, focus restored on close and a page that stops
  // scrolling underneath — the four things this hand-rolled overlay lacked.
  // Placed above the early return so the hook runs on every render.
  const { panelProps } = useModalShell({ open: !!projectId, onClose, busy: !!busy });

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;
  const agileCatalogue = catalogue?.agile ?? null;

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

  // The roster is edited in place on this step, so the capacity defaults and the
  // unstaffed warnings have to follow the edit rather than wait for a reopen.
  const reloadTeam = () =>
    service
      .getProjectTeam(slug, projectId)
      .then((r) => setTeam(r?.team ?? []))
      // A refresh that fails leaves the list showing the roster from before the
      // edit. Silently, that reads as "the change didn't take" — and the lead
      // makes it a second time.
      .catch(() => setError("Couldn't refresh the team list — reopen this step to see the change."));

  // `reflow` is a re-plan after the lead changed who does what: it keeps the tasks
  // the assistant already added and does not call it again, so only the dates and
  // the owners move — and the edited target date survives.
  const buildPlan = async (
    nextAssignees?: Record<string, string>,
    reflow = false,
    nextFixed?: Record<string, { start_date: string; target_date: string }>,
    nextDeps?: Record<string, string[]>
  ) => {
    if (busy) return;
    setBusy("plan");
    setError(null);
    try {
      const result = await service.setupPlan(slug, projectId, {
        tracks,
        task_keys: [...taskKeys],
        start_date: startDate || null,
        // ARRIBADA: the optional deadline — the backend fits the plan into the window when set.
        target_date: endDate || null,
        capacity,
        duration_overrides: durations,
        role_overrides: roleOverrides,
        field_days: tracks.includes("field") ? Number(fieldDays) || null : null,
        production_days: tracks.includes("production") ? Number(productionDays) || null : null,
        sprints: {
          mode: sprintMode,
          length_days: sprintCount ? null : Number(sprintLength) || 14,
          count: sprintCount ? Number(sprintCount) : null,
        },
        method: agile ? "agile" : "vcycle",
        ceremonies,
        use_ai: !reflow && useAi && aiAvailable,
        context: context.trim(),
        assignees: nextAssignees ?? assignees,
        fixed_dates: nextFixed ?? fixedDates,
        dependencies: nextDeps ?? dependencies,
        extra_tasks: reflow ? plan?.tasks.filter((t) => t.added) : undefined,
      });
      setPlan(result);
      // A new plan is not the one that was created. Leaving `created` set showed
      // the "Created N work items" screen over a plan that had never been applied,
      // and the Create button is hidden behind that screen — so the second plan
      // could not be created at all.
      setCreated(null);
      // Seed the delivery date from the schedule only while the lead has not set
      // one. Overwriting it on every rebuild wiped the date they had just typed —
      // including the deadline a warning had told them to work toward, which is
      // the one moment they are most likely to press Rebuild.
      if (!reflow && !endTouched.current) setEndOverride(endDate || result.end_date);
    } catch (e) {
      setError(errorMessage(e, "Could not build a plan."));
    } finally {
      setBusy(null);
    }
  };

  // Naming somebody, or handing the task back to whoever holds its discipline.
  // Either way the schedule is recomputed, because who does a task changes when it
  // can happen — especially when that person already covers another discipline.
  // A typed date becomes fixed. Everything downstream is rescheduled around it —
  // freezing the whole plan instead would leave an artefact where nothing checks
  // the dependencies or whether anyone is free.
  const editDates = (taskKey: string, begins: string, ends: string) => {
    const next = { ...fixedDates, [taskKey]: { start_date: begins, target_date: ends } };
    setFixedDates(next);
    void buildPlan(undefined, true, next, undefined);
  };

  const editDeps = (taskKey: string, dependsOn: string[]) => {
    const next = { ...dependencies, [taskKey]: dependsOn };
    setDependencies(next);
    void buildPlan(undefined, true, undefined, next);
  };

  const assignTask = (taskKey: string, userId: string | null) => {
    const next = { ...assignees };
    if (userId) next[taskKey] = userId;
    else delete next[taskKey];
    setAssignees(next);
    void buildPlan(next, true);
  };

  // Returns whether the plan was written, so Finish can stop rather than report
  // success over a failure.
  const applyPlan = async (): Promise<boolean> => {
    if (!plan) return true;
    try {
      const result = await service.setupApply(slug, projectId, {
        tasks: plan.tasks,
        sprints: plan.sprints,
        create_modules: true,
        set_project_window: false,
      });
      setCreated(result);
      await service.updateSchedule(slug, projectId, {
        start_date: plan.start_date,
        target_date: endOverride || plan.end_date,
      });
      await recountUndated();
      onCompleted?.();
      return true;
    } catch (e) {
      setError(errorMessage(e, "Could not create the work items."));
      return false;
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

  /**
   * The disciplines the sprint editor can offer.
   *
   * `roleOptions` is derived from the chosen tracks and the roster, and the
   * sprint route walks past both of those steps — so a project with no roster
   * yet reaches the editor with an empty list, a `<select>` with no options and
   * a role of "". The standard vocabulary is a better answer than a blank, and
   * it is the same list the "add a discipline" field already suggests.
   */
  const sprintRoleOptions = roleOptions.length > 0 ? roleOptions : ROLE_SUGGESTIONS;

  /**
   * Snap a role onto this project's own vocabulary.
   *
   * The catalogue and the model both answer with a role name, and neither is
   * guaranteed to spell it the way this project's roster does. An unmatched name
   * would render as a `<select>` value that is not in its own option list, which
   * silently shows the wrong discipline — so anything unrecognised falls back to
   * the first real option rather than being trusted.
   */
  const matchRole = (value: string | undefined): string => {
    const key = (value ?? "").trim().toLowerCase();
    return sprintRoleOptions.find((role) => role.toLowerCase() === key) ?? sprintRoleOptions[0] ?? "";
  };

  /**
   * The ceremonies this team already ticked, as editable rows.
   *
   * Prefixed with the sprint's name, and that is not decoration: setup-apply
   * skips any task whose name already exists in the project, and a team's
   * ceremonies are the same words every sprint. Without the prefix the second
   * sprint's planning session is silently dropped as a duplicate of the first
   * one's — the row simply never appears, which is the worst way to lose it.
   * Prefixing at SEED time rather than on save means what is shown is what gets
   * created, and it stays editable.
   */
  const defaultCeremonyTasks = (): TSprintTask[] => {
    const blocks = agileCatalogue?.ceremonies ?? [];
    const chosen = blocks.filter((block) => ceremonies.includes(block.key));
    const source = chosen.length > 0 ? chosen : blocks;
    const prefix = sprintName.trim();
    return source.map((block) =>
      newSprintTask(
        prefix ? `${prefix} — ${block.name}` : block.name,
        matchRole(block.role),
        block.days || 1,
        "default"
      )
    );
  };

  const suggestSprintTasks = async () => {
    if (!projectId || busy) return;
    setBusy("ai");
    setError(null);
    try {
      const proposed = await service.aiSprintTasks(slug, projectId, {
        context: sprintContext.trim(),
        // What is already on the list, so it adds rather than restates.
        defaults: sprintTasks.map((task) => task.name),
        count: 8,
      });
      if (proposed.length === 0) {
        setError("The assistant had nothing to add to what is already there.");
        return;
      }
      setSprintTasks((current) => [
        ...current,
        ...proposed.map((row) => newSprintTask(row.name, matchRole(row.role), row.estimate_days || 3, "ai")),
      ]);
    } catch (e) {
      setError(errorMessage(e, "The assistant could not propose tasks."));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Write the sprint. Dates are laid out here rather than asked of the model:
   * each discipline runs its own tasks back to back from the sprint's start, so
   * two people never appear to be blocked on each other for no reason, and
   * nothing is allowed past the sprint's end — a sprint whose work runs beyond
   * it is not a sprint, and the editor already warned about the over-commitment.
   */
  const applySprint = async (): Promise<boolean> => {
    if (!projectId) return false;
    const rows = sprintTasks.filter((task) => task.name.trim().length > 0);
    if (rows.length === 0) {
      setError("Add at least one task, or cancel.");
      return false;
    }
    const begins = startDate || today();
    const length = Math.max(1, Number(sprintLength) || 14);
    const lastDay = addDays(begins, length - 1);

    const cursorByRole: Record<string, string> = {};
    const tasks: TPlannedTask[] = rows.map((task, position) => {
      const from = cursorByRole[task.role] ?? begins;
      const to = minDate(addDays(from, Math.max(1, task.days) - 1), lastDay);
      cursorByRole[task.role] = minDate(addDays(to, 1), lastDay);
      return {
        key: `sprint-${position}`,
        name: task.name.trim(),
        track: "sprint",
        phase: "sprint",
        role: task.role,
        days: Math.max(1, task.days),
        after: [],
        start_date: from,
        target_date: to,
        assignee_id: null,
        assignee_name: null,
        sprint: 1,
      };
    });

    setBusy("apply");
    try {
      const result = await service.setupApply(slug, projectId, {
        tasks,
        sprints: [
          {
            index: 1,
            name: sprintName.trim() || `Sprint from ${begins}`,
            start_date: begins,
            end_date: lastDay,
            task_count: tasks.length,
          },
        ],
        // The project's own window is already set; widening it because one
        // sprint was added would rewrite a date somebody agreed with a funder.
        set_project_window: false,
      });
      onCompleted?.();
      // A name that already exists in the project is skipped server-side, not
      // written. Closing on "done" while rows were quietly dropped is how
      // somebody finds out three weeks later that the sprint has no review in
      // it, so the wizard stays open and says which ones.
      if (result?.skipped?.length) {
        setError(
          `Created ${result.created}. Already in this project, so not added again: ${result.skipped.join(", ")}. ` +
            `Rename them if this sprint needs its own.`
        );
        return false;
      }
      return true;
    } catch (e) {
      setError(errorMessage(e, "Could not create the sprint."));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const next = async () => {
    if (busy) return;
    setError(null);
    // Arriving at the sprint step seeds it with the ceremonies this team runs —
    // once. Re-seeding on every visit would resurrect rows somebody deleted on
    // purpose, which is why it only fires on an untouched list.
    if (step.key === "cadence" && setupMode === "sprint" && sprintTasks.length === 0) {
      setSprintTasks(defaultCeremonyTasks());
      setIndex((i) => i + 1);
      return;
    }
    // Reaching the plan step with nothing computed yet builds it, rather than showing
    // an empty page with a button on it.
    if (step.key === "tasks") {
      setIndex((i) => i + 1);
      await buildPlan();
      return;
    }
    if (isLast) {
      setBusy("step");
      try {
        // The sprint route has no plan table to apply: its rows ARE the plan, so
        // Finish writes them and stops.
        if (setupMode === "sprint") {
          const written = await applySprint();
          if (written) finish();
          return;
        }
        // Finishing applies the plan. Someone who walked through every step and
        // pressed Finish meant "do it" — leaving the work items uncreated because
        // they did not also press Create on step five is a trap, not a safeguard.
        if (plan && !created) {
          const written = await applyPlan();
          if (!written) return;
        }
        if (await saveLinks()) finish();
      } catch (e) {
        setError(errorMessage(e, "Could not finish the setup."));
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
      case "mode":
        return (
          <div className="space-y-2">
            {(
              [
                {
                  key: "vcycle",
                  title: "Set up a whole project — V-cycle",
                  hint: "Design, build, verify, validate. One timeline; work starts when what it waits on finishes.",
                },
                {
                  key: "agile",
                  title: "Set up a whole project — sprints",
                  // Was "Creates a cycle per sprint" — one object under two names
                  // in one sentence. Plane's Cycle is what this product calls a
                  // sprint, everywhere, including its own screens now.
                  hint: "The same project, cut into fixed periods — one sprint each.",
                },
                {
                  key: "sprint",
                  title: "Add one sprint to this project",
                  hint: "The project already exists. Just the next fortnight: its ceremonies, plus whatever it is about.",
                },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setSetupMode(option.key);
                  // The cadence answer follows from this one; leaving them to be
                  // set separately is how a "V-cycle" project ends up with cycles.
                  setSprintMode(option.key === "vcycle" ? "flow" : "sprints");
                }}
                aria-pressed={setupMode === option.key}
                className={cn(
                  "block w-full rounded-lg border p-3 text-left transition-colors",
                  setupMode === option.key
                    ? "border-accent-strong bg-accent-primary/5"
                    : "border-subtle hover:bg-layer-2"
                )}
              >
                <span className="block text-13 font-semibold text-primary">{option.title}</span>
                <span className="mt-0.5 block text-11 text-secondary">{option.hint}</span>
              </button>
            ))}
            {setupMode !== "sprint" && hasExistingWork && (
              <p className="pt-1 text-11 text-tertiary">
                This project already has work in it. Setting it up again adds to what is there rather than replacing it
                — you will see the existing items before anything is written.
              </p>
            )}
          </div>
        );

      case "sprint":
        return (
          <SprintTaskEditor
            tasks={sprintTasks}
            onChange={setSprintTasks}
            roleOptions={sprintRoleOptions}
            context={sprintContext}
            onContext={setSprintContext}
            onSuggest={suggestSprintTasks}
            suggesting={busy === "ai"}
            aiAvailable={aiAvailable}
            capacityDays={Number(sprintLength) || 14}
          />
        );

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

            <div className="flex flex-wrap items-end gap-4">
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
              {/* ARRIBADA: an optional deadline. When set, the plan is fitted to the window —
                  the durations are scaled to land the last task on or before it. */}
              <div>
                <label className={label} htmlFor={`${uid}-end`}>
                  End date <span className="normal-case text-tertiary">(optional)</span>
                </label>
                <input
                  id={`${uid}-end`}
                  type="date"
                  className={cn(field, "w-44")}
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              {endDate && endDate >= startDate && (
                <p className="pb-1.5 text-12 text-secondary">
                  {weekdaysBetween(startDate, endDate)} working days — the tasks are proposed to fit this window.
                </p>
              )}
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

            {/* The same roster editor the Overview shows, so the disciplines can be
                filled in here rather than sending the lead away mid-setup. Someone with
                no Plane account is a normal entry: the discipline still routes the work. */}
            <div className="overflow-hidden rounded-lg border border-subtle">
              <OverviewTeamBlock projectId={projectId} team={team ?? []} onSaved={reloadTeam} />
            </div>

            {rolesInPlay.length > 0 && (
              <p className="pt-1 text-11 font-medium tracking-wide text-secondary uppercase">
                How many work each discipline at once
              </p>
            )}
            {rolesInPlay.length === 0 ? (
              <p className="text-13 text-secondary">Pick a component first — the disciplines follow from the tasks.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rolesInPlay.map((role) => {
                  const held = roleCounts[role.toLowerCase()] ?? 0;
                  return (
                    <li key={role} className="flex items-center gap-2">
                      <Users className="size-3.5 flex-shrink-0 text-tertiary" />
                      <button
                        type="button"
                        aria-label={`Remove ${role}`}
                        title="Remove this discipline from the plan"
                        onClick={() => removeRole(role)}
                        className="flex-shrink-0 text-tertiary hover:text-danger-primary"
                      >
                        <X className="size-3" />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-13 text-primary">{role}</span>
                      <span className={cn("text-11", held ? "text-tertiary" : "text-warning-primary")}>
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
            {/* A discipline the catalogue's tasks do not name — planning for someone
                you are about to bring in, or a trade this project needs and the
                generic list has no task for. */}
            <div className="flex items-center gap-2 pt-1">
              <input
                id={`${uid}-role-draft`}
                list={`${uid}-role-options`}
                className={cn(field, "flex-1")}
                value={roleDraft}
                onChange={(e) => setRoleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRole(roleDraft);
                  }
                }}
                placeholder="Add a discipline"
              />
              <datalist id={`${uid}-role-options`}>
                {ROLE_SUGGESTIONS.filter((r) => !rolesInPlay.some((x) => x.toLowerCase() === r)).map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <button type="button" onClick={() => addRole(roleDraft)} className={actionBtn}>
                <Plus className="size-3.5" />
                Add
              </button>
            </div>
            {unstaffed.size > 0 && (
              <p className="rounded bg-warning-subtle px-2.5 py-1.5 text-12 text-warning-primary">
                {unstaffed.size} discipline(s) have nobody on the roster — add them above, or carry on: the plan is
                built either way and each work item records the discipline it needs, so the work is handed over
                automatically the day someone picks it up.
              </p>
            )}
          </div>
        );

      case "tasks":
        // In sprints the unit of work is an iteration, not a phase — so the picker
        // asks which ceremonies each sprint carries, and the increment repeats by
        // construction. A sprint with no increment would just be a meeting.
        if (agile)
          return (
            <div className="space-y-4">
              <p className={hint}>
                Every sprint plans, builds an increment, tests it and shows it. Below is what each of your{" "}
                {sprintCount || "6"} sprints will contain — the increment itself is not optional.
              </p>

              <div className="overflow-hidden rounded-lg border border-subtle">
                <p className="bg-layer-2 px-3 py-2 text-12 font-semibold text-primary">Before the first sprint</p>
                <ul className="divide-y divide-subtle">
                  {[
                    ...(agileCatalogue?.setup ?? []),
                    ...(agileCatalogue?.spikes ?? []).filter((sp) => tracks.includes(sp.track)),
                  ].map((task) => (
                    <li key={task.key} className="flex items-center gap-2 px-3 py-1.5 text-13">
                      <span className="min-w-0 flex-1 truncate text-primary">{task.name}</span>
                      <span className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-11 text-secondary">
                        {task.role}
                      </span>
                      <span className="flex-shrink-0 text-11 text-tertiary">{task.days}d</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="overflow-hidden rounded-lg border border-subtle">
                <p className="bg-layer-2 px-3 py-2 text-12 font-semibold text-primary">In every sprint</p>
                <ul className="divide-y divide-subtle">
                  {(agileCatalogue?.ceremonies ?? []).map((ceremony) => (
                    <li key={ceremony.key} className="flex items-center gap-2 px-3 py-1.5 text-13">
                      <input
                        id={`${uid}-ceremony-${ceremony.key}`}
                        type="checkbox"
                        checked={ceremonies.includes(ceremony.key)}
                        onChange={() =>
                          setCeremonies((current) =>
                            current.includes(ceremony.key)
                              ? current.filter((c) => c !== ceremony.key)
                              : [...current, ceremony.key]
                          )
                        }
                        className="size-3.5 flex-shrink-0 text-accent-primary"
                      />
                      <label
                        htmlFor={`${uid}-ceremony-${ceremony.key}`}
                        className="min-w-0 flex-1 truncate text-primary"
                      >
                        {ceremony.name}
                      </label>
                      <span className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-11 text-secondary">
                        {ceremony.role}
                      </span>
                      <span className="flex-shrink-0 text-11 text-tertiary">{ceremony.days}d</span>
                    </li>
                  ))}
                  {tracks
                    .filter((t) => !DURATION_TRACKS.has(t))
                    .map((track) => (
                      <li key={track} className="flex items-center gap-2 px-3 py-1.5 text-13">
                        <span className="size-3.5 flex-shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-primary">
                          {trackLabels[track] ?? track} increment
                        </span>
                        <span className="flex-shrink-0 text-11 text-tertiary">the rest of the sprint</span>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="overflow-hidden rounded-lg border border-subtle">
                <p className="bg-layer-2 px-3 py-2 text-12 font-semibold text-primary">After the last sprint</p>
                <ul className="divide-y divide-subtle">
                  {(agileCatalogue?.closing ?? []).map((task) => (
                    <li key={task.key} className="flex items-center gap-2 px-3 py-1.5 text-13">
                      <span className="min-w-0 flex-1 truncate text-primary">{task.name}</span>
                      <span className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-11 text-secondary">
                        {task.role}
                      </span>
                      <span className="flex-shrink-0 text-11 text-tertiary">{task.days}d</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
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
              roleOverrides={roleOverrides}
              roleOptions={roleOptions}
              onRole={(key, role) =>
                setRoleOverrides((current) => {
                  const original = catalogue?.tracks.flatMap((t) => t.tasks).find((t) => t.key === key)?.role;
                  const updated = { ...current };
                  // Back to the catalogue's own discipline is not an override; keeping
                  // it would freeze this task if the catalogue ever changed.
                  if (!role.trim() || role.trim().toLowerCase() === original?.trim().toLowerCase()) delete updated[key];
                  else updated[key] = role.trim().slice(0, 80);
                  return updated;
                })
              }
            />
          </div>
        );

      case "cadence":
        return (
          <div className="space-y-4">
            {setupMode === "sprint" && (
              // Adding one sprint: flow-vs-sprints was settled on step one, and the
              // count belongs to a project being laid out, not to a single sprint.
              // What is left is what this one is called and when it runs.
              <div className="space-y-3 rounded-lg border border-subtle p-3">
                <div>
                  <label className={label} htmlFor={`${uid}-sprint-name`}>
                    Sprint name
                  </label>
                  <input
                    id={`${uid}-sprint-name`}
                    className={field}
                    value={sprintName}
                    onChange={(e) => setSprintName(e.target.value)}
                    placeholder="Sprint 7 — enclosure bench tests"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className={label} htmlFor={`${uid}-sprint-start`}>
                      Starts
                    </label>
                    <input
                      id={`${uid}-sprint-start`}
                      type="date"
                      className={cn(field, "w-44")}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor={`${uid}-sprint-only-length`}>
                      Length
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={`${uid}-sprint-only-length`}
                        type="number"
                        min={1}
                        max={90}
                        className={cn(field, "w-20")}
                        value={sprintLength}
                        onChange={(e) => setSprintLength(e.target.value)}
                      />
                      <span className="text-12 text-secondary">days</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", setupMode === "sprint" && "hidden")}>
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
                    hint: "The same plan, cut into fixed periods — one sprint each.",
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
            {sprintMode === "sprints" && setupMode !== "sprint" && (
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
              <button type="button" onClick={() => buildPlan()} disabled={!!busy} className={actionBtn}>
                <Sparkles className="size-3.5" />
                Build the plan
              </button>
            </div>
          );
        return (
          <div className="space-y-3">
            <SetupPlanTable
              plan={plan}
              trackLabels={trackLabels}
              onAssign={assignTask}
              onEditDates={editDates}
              onEditDeps={editDeps}
              busy={busy === "plan"}
            />
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
                  onChange={(e) => {
                    // From here on this date is the lead's, and a rebuild must not
                    // overwrite it with whatever the schedule happened to produce.
                    endTouched.current = true;
                    setEndOverride(e.target.value);
                  }}
                />
              </div>
              <button type="button" onClick={() => buildPlan()} disabled={!!busy} className={actionBtn}>
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
              <p className="rounded bg-warning-subtle px-2.5 py-1.5 text-12 text-warning-primary">
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
                      className="text-tertiary hover:text-danger-primary"
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
        <div
          className="shadow-2xl relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-subtle bg-layer-1"
          {...panelProps}
        >
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
            {error && (
              <p className="mt-3 rounded bg-danger-subtle px-2.5 py-1.5 text-12 text-danger-primary">{error}</p>
            )}
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
