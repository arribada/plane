/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Import an Asana CSV export into a project as work items.
 *
 * Three steps: pick the file; say what each Asana Section should become here — a module, a sprint
 * (cycle), a set of milestones/deliverables, or just plain tasks — and for a module or sprint,
 * whether to create a new one or use an existing; then import. The type is guessed per section
 * from its name and its data, and anything the guess is unsure of is left for you to set. Names,
 * notes, start/due dates, the assignee (by email), the parent/sub-task tree, the blocked-by links
 * and the original Asana id are all carried across.
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Loader2, Upload, X, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IModule, ICycle, IIssueLabel } from "@plane/types";
import { cn } from "@plane/utils";
import { ModuleService } from "@/services/module.service";
import { CycleService } from "@/services/cycle.service";
import { IssueService } from "@/services/issue/issue.service";
import { IssueLabelService } from "@/services/issue/issue_label.service";
import { WorkspaceService } from "@/services/workspace.service";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { rowsFromCsv, type TAsanaRow } from "./asana-csv";

const moduleService = new ModuleService();
const cycleService = new CycleService();
const issueService = new IssueService();
const issueLabelService = new IssueLabelService();
const workspaceService = new WorkspaceService();
const arribadaService = new ArribadaService();

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  onImported?: () => void | Promise<void>;
};

type TSectionType = "module" | "sprint" | "label" | "milestone" | "tasks";
/** What a section becomes. `targetId` set = use that existing module/sprint; unset = create one
 *  named `newName`. Ignored for milestone/tasks. */
type TSectionChoice = { type: TSectionType; targetId?: string; newName: string };

type TStep = "upload" | "map" | "importing" | "done";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const buildDescription = (row: TAsanaRow): string => {
  const paras = row.notes
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const stamp = row.asanaId ? `<p><em>Imported from Asana · ${escapeHtml(row.asanaId)}</em></p>` : "";
  return `${paras}${stamp}` || "<p></p>";
};

/** Guess what a section should become, from its name and whether its tasks all carry due dates. */
const guessType = (section: string, sectionRows: TAsanaRow[]): TSectionType => {
  const name = section.toLowerCase();
  if (/sprint|cycle|iteration|semaine|week/.test(name)) return "sprint";
  // Requirements / specs / stories are a KIND of item, best carried as a label you can filter by.
  if (/requirement|exigence|\bspec\b|user stor|acceptance/.test(name)) return "label";
  if (/date|milestone|jalon|deliverable|livrable|gate|deadline|key/.test(name)) return "milestone";
  // A section where every task has a due date and none has notes reads like a list of dates.
  if (sectionRows.length > 0 && sectionRows.every((r) => r.dueDate) && sectionRows.every((r) => !r.notes.trim()))
    return "milestone";
  return "module";
};

const TYPE_LABEL: Record<TSectionType, string> = {
  module: "Module",
  sprint: "Sprint",
  label: "Label",
  milestone: "Milestones",
  tasks: "Tasks only",
};

export const AsanaImportModal = observer(function AsanaImportModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, onImported } = props;

  const [step, setStep] = useState<TStep>("upload");
  const [rows, setRows] = useState<TAsanaRow[]>([]);
  const [modules, setModules] = useState<IModule[]>([]);
  const [cycles, setCycles] = useState<ICycle[]>([]);
  const [labels, setLabels] = useState<IIssueLabel[]>([]);
  const [emailToUserId, setEmailToUserId] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, TSectionChoice>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sections = useMemo(() => Array.from(new Set(rows.map((r) => r.section).filter(Boolean))), [rows]);
  const matchedAssignees = useMemo(
    () => new Set(rows.map((r) => r.assigneeEmail).filter((e) => e && emailToUserId[e])).size,
    [rows, emailToUserId]
  );
  const totalAssignees = useMemo(() => new Set(rows.map((r) => r.assigneeEmail).filter(Boolean)).size, [rows]);

  if (!isOpen) return null;

  const reset = () => {
    setStep("upload");
    setRows([]);
    setError(null);
    setResult(null);
    setChoices({});
    setProgress({ done: 0, total: 0 });
  };

  const handleClose = () => {
    if (step === "importing") return;
    reset();
    onClose();
  };

  const onFile = async (file: File) => {
    setError(null);
    const text = await file.text();
    const { rows: parsed, error: parseError } = rowsFromCsv(text);
    if (parseError) {
      setError(parseError);
      return;
    }
    setRows(parsed);
    const distinct = Array.from(new Set(parsed.map((r) => r.section).filter(Boolean)));
    // Fetch what we can map onto, then guess a type + target per section.
    let mods: IModule[] = [];
    let cyc: ICycle[] = [];
    let labs: IIssueLabel[] = [];
    try {
      const [m, c, l, members] = await Promise.all([
        moduleService.getModules(workspaceSlug, projectId).catch(() => [] as IModule[]),
        cycleService.getCyclesWithParams(workspaceSlug, projectId).catch(() => [] as ICycle[]),
        issueLabelService.getProjectLabels(workspaceSlug, projectId).catch(() => [] as IIssueLabel[]),
        workspaceService.fetchWorkspaceMembers(workspaceSlug).catch(() => []),
      ]);
      mods = m;
      cyc = c;
      labs = l;
      setModules(m);
      setCycles(c);
      setLabels(l);
      const map: Record<string, string> = {};
      for (const member of members) {
        const email = (member.member?.email || member.email || "").toLowerCase();
        if (email && member.member?.id) map[email] = member.member.id;
      }
      setEmailToUserId(map);
    } catch {
      /* mapping still works with empty lists */
    }
    const seeded: Record<string, TSectionChoice> = {};
    for (const section of distinct) {
      const sectionRows = parsed.filter((r) => r.section === section);
      const type = guessType(section, sectionRows);
      let targetId: string | undefined;
      if (type === "module") targetId = mods.find((m) => m.name.trim().toLowerCase() === section.trim().toLowerCase())?.id;
      if (type === "sprint") targetId = cyc.find((c) => c.name.trim().toLowerCase() === section.trim().toLowerCase())?.id;
      if (type === "label") targetId = labs.find((l) => l.name.trim().toLowerCase() === section.trim().toLowerCase())?.id;
      seeded[section] = { type, targetId, newName: section };
    }
    setChoices(seeded);
    setStep("map");
  };

  const runImport = async () => {
    setStep("importing");
    setProgress({ done: 0, total: rows.length });
    let created = 0;
    let failed = 0;

    // Resolve module/sprint sections to an id (creating the new ones up front).
    const target: Record<string, { type: TSectionType; id?: string }> = {};
    for (const section of sections) {
      const choice = choices[section];
      if (!choice) continue;
      if (choice.type === "module") {
        let id = choice.targetId;
        if (!id) {
          try {
            id = (await moduleService.createModule(workspaceSlug, projectId, { name: (choice.newName || section).slice(0, 255) })).id;
          } catch {
            /* leave ungrouped */
          }
        }
        target[section] = { type: "module", id };
      } else if (choice.type === "sprint") {
        let id = choice.targetId;
        if (!id) {
          // Give the cycle the span of its tasks when they carry dates.
          const dates = rows.filter((r) => r.section === section).flatMap((r) => [r.startDate, r.dueDate]).filter(Boolean).sort();
          try {
            id = (
              await cycleService.createCycle(workspaceSlug, projectId, {
                name: (choice.newName || section).slice(0, 255),
                ...(dates.length ? { start_date: dates[0], end_date: dates[dates.length - 1] } : {}),
              })
            ).id;
          } catch {
            /* leave ungrouped */
          }
        }
        target[section] = { type: "sprint", id };
      } else if (choice.type === "label") {
        let id = choice.targetId;
        if (!id) {
          try {
            id = (await issueLabelService.createIssueLabel(workspaceSlug, projectId, { name: (choice.newName || section).slice(0, 255) })).id;
          } catch {
            /* leave unlabelled */
          }
        }
        target[section] = { type: "label", id };
      } else {
        target[section] = { type: choice.type };
      }
    }

    // Pass 1: create every work item.
    const idByName: Record<string, string> = {};
    const moduleIssues: Record<string, string[]> = {};
    const cycleIssues: Record<string, string[]> = {};
    const milestoneIssueIds: string[] = [];
    for (const row of rows) {
      try {
        const assigneeId = row.assigneeEmail ? emailToUserId[row.assigneeEmail] : undefined;
        const t = row.section ? target[row.section] : undefined;
        const moduleId = t?.type === "module" ? t.id : undefined;
        const labelId = t?.type === "label" ? t.id : undefined;
        // A milestone with only a due date (Asana Key Dates have no start) must carry start ==
        // target, or the timeline draws its two bar handles instead of a clean diamond.
        const startForRow = row.startDate || (t?.type === "milestone" && row.dueDate ? row.dueDate : "");
        const issue = await issueService.createIssue(workspaceSlug, projectId, {
          name: row.name.slice(0, 255),
          description_html: buildDescription(row),
          ...(startForRow ? { start_date: startForRow } : {}),
          ...(row.dueDate ? { target_date: row.dueDate } : {}),
          ...(assigneeId ? { assignee_ids: [assigneeId] } : {}),
          ...(moduleId ? { module_ids: [moduleId] } : {}),
          ...(labelId ? { label_ids: [labelId] } : {}),
        });
        idByName[row.name] = issue.id;
        // module_ids on create does NOT make the ModuleIssue link, so collect and add them below.
        if (t?.type === "module" && t.id) (moduleIssues[t.id] ??= []).push(issue.id);
        if (t?.type === "sprint" && t.id) (cycleIssues[t.id] ??= []).push(issue.id);
        if (t?.type === "milestone") milestoneIssueIds.push(issue.id);
        created += 1;
      } catch {
        failed += 1;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    // Group into modules and sprints, and mark the milestone sections' items as deliverables.
    for (const [moduleId, issues] of Object.entries(moduleIssues)) {
      if (issues.length) await moduleService.addIssuesToModule(workspaceSlug, projectId, moduleId, { issues }).catch(() => {});
    }
    for (const [cycleId, issues] of Object.entries(cycleIssues)) {
      if (issues.length) await issueService.addIssueToCycle(workspaceSlug, projectId, cycleId, { issues }).catch(() => {});
    }
    for (const issueId of milestoneIssueIds) {
      await arribadaService.setProjectMilestone(workspaceSlug, projectId, issueId, "delivery").catch(() => {});
    }

    // Pass 2: parent tree and blocked-by links, now that every id exists.
    for (const row of rows) {
      const selfId = idByName[row.name];
      if (!selfId) continue;
      const parentId = row.parent ? idByName[row.parent] : undefined;
      if (parentId) await issueService.patchIssue(workspaceSlug, projectId, selfId, { parent_id: parentId }).catch(() => {});
      const blockerIds = row.blockedBy.map((n) => idByName[n]).filter(Boolean);
      if (blockerIds.length > 0) {
        await issueService
          .createIssueRelation(workspaceSlug, projectId, selfId, {
            related_list: blockerIds.map((related_issue) => ({ relation_type: "blocked_by" as const, related_issue })),
          })
          .catch(() => {});
      }
    }

    setResult({ created, failed });
    setStep("done");
    setToast({
      type: failed === 0 ? TOAST_TYPE.SUCCESS : TOAST_TYPE.WARNING,
      title: "Asana import finished",
      message: `${created} work item${created === 1 ? "" : "s"} created${failed ? `, ${failed} failed` : ""}.`,
    });
    if (onImported) await onImported();
  };

  const setChoice = (section: string, patch: Partial<TSectionChoice>) =>
    setChoices((prev) => ({ ...prev, [section]: { ...(prev[section] ?? { type: "module", newName: section }), ...patch } }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-black/40" onClick={handleClose} />
      <div className="shadow-2xl relative z-10 flex max-h-[82vh] w-full max-w-lg flex-col rounded-xl border border-subtle bg-layer-1">
        <div className="flex items-center justify-between border-b border-subtle px-5 py-4">
          <h3 className="text-16 font-semibold text-primary">Import from Asana (CSV)</h3>
          <button type="button" onClick={handleClose} disabled={step === "importing"} className="text-secondary hover:text-primary">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === "upload" && (
            <div className="space-y-3">
              <p className="text-13 text-secondary">
                Export your Asana project as CSV (Project → ••• → Export → CSV) and drop it here.
              </p>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-subtle bg-layer-2 px-4 py-10 text-center hover:border-accent-primary">
                <Upload className="size-6 text-tertiary" />
                <span className="text-13 text-secondary">Choose a CSV file</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
              </label>
              {error && (
                <p className="flex items-center gap-1.5 rounded bg-danger-subtle px-2.5 py-1.5 text-12 text-danger-primary">
                  <AlertTriangle className="size-3.5" /> {error}
                </p>
              )}
            </div>
          )}

          {step === "map" && (
            <div className="space-y-4">
              <p className="text-13 text-secondary">
                <span className="font-medium text-primary">{rows.length}</span> tasks found. Each section is set to
                a guessed type — change it if the guess is wrong, then import.
              </p>
              <div className="space-y-2">
                {sections.length === 0 && <p className="text-12 text-tertiary">No sections in this export.</p>}
                {sections.map((section) => {
                  const choice = choices[section] ?? { type: "module" as TSectionType, newName: section };
                  const sectionRows = rows.filter((r) => r.section === section);
                  const isExpanded = expanded.has(section);
                  const entities = (
                    choice.type === "sprint" ? cycles : choice.type === "label" ? labels : modules
                  ) as { id: string; name: string }[];
                  return (
                    <div key={section} className="rounded-md border border-subtle p-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(section)) next.delete(section);
                            else next.add(section);
                            return next;
                          })
                        }
                        className="mb-1.5 flex w-full items-center justify-between gap-2 text-left"
                      >
                        <span className="text-13 font-medium text-primary">{section}</span>
                        <span className="flex shrink-0 items-center gap-1 text-11 text-tertiary">
                          {sectionRows.length} task{sectionRows.length === 1 ? "" : "s"}
                          <ChevronDown className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")} />
                        </span>
                      </button>
                      {isExpanded && (
                        <ul className="mb-2 max-h-40 space-y-1 overflow-y-auto rounded bg-layer-2 p-2">
                          {sectionRows.map((r, i) => (
                            <li key={`${section}-${i}`} className="flex items-center justify-between gap-2 text-11">
                              <span className="truncate text-secondary">{r.name}</span>
                              <span className="flex shrink-0 items-center gap-2 text-tertiary">
                                {r.dueDate && <span className="tabular-nums">{r.dueDate}</span>}
                                {r.assigneeEmail && <span className="max-w-[130px] truncate">{r.assigneeEmail}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-12">
                        <select
                          value={choice.type}
                          onChange={(e) => setChoice(section, { type: e.target.value as TSectionType, targetId: undefined })}
                          className="rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
                        >
                          {(["module", "sprint", "label", "milestone", "tasks"] as TSectionType[]).map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABEL[t]}
                            </option>
                          ))}
                        </select>
                        {(choice.type === "module" || choice.type === "sprint" || choice.type === "label") && (
                          <>
                            <select
                              value={choice.targetId ?? "new"}
                              onChange={(e) =>
                                setChoice(section, { targetId: e.target.value === "new" ? undefined : e.target.value })
                              }
                              className="rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
                            >
                              <option value="new">＋ Create “{choice.newName || section}”</option>
                              {entities.length > 0 && <option disabled>── existing ──</option>}
                              {entities.map((en) => (
                                <option key={en.id} value={en.id}>
                                  {en.name}
                                </option>
                              ))}
                            </select>
                            {!choice.targetId && (
                              <input
                                type="text"
                                value={choice.newName}
                                onChange={(e) => setChoice(section, { newName: e.target.value })}
                                className="w-36 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
                              />
                            )}
                          </>
                        )}
                        {choice.type === "milestone" && (
                          <span className="text-11 text-tertiary">each task marked a deliverable</span>
                        )}
                        {choice.type === "tasks" && <span className="text-11 text-tertiary">imported, not grouped</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-11 text-tertiary">
                Assignees: {matchedAssignees}/{totalAssignees} emails match a member (the rest import unassigned).
                Parent tasks, blocked-by links and the Asana id are carried across automatically.
              </p>
            </div>
          )}

          {step === "importing" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="size-6 animate-spin text-accent-primary" />
              <p className="text-13 text-secondary">
                Importing {progress.done}/{progress.total} work items…
              </p>
              <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-layer-2">
                <div
                  className="h-full rounded-full bg-accent-primary transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {step === "done" && result && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="size-8 text-success-primary" />
              <p className="text-14 font-medium text-primary">
                {result.created} work item{result.created === 1 ? "" : "s"} imported
              </p>
              {result.failed > 0 && <p className="text-12 text-danger-primary">{result.failed} could not be created.</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-subtle px-5 py-3">
          {step === "map" && (
            <>
              <button type="button" onClick={reset} className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2">
                Back
              </button>
              <button
                type="button"
                onClick={() => void runImport()}
                className="rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90"
              >
                Import {rows.length} tasks
              </button>
            </>
          )}
          {(step === "upload" || step === "done") && (
            <button
              type="button"
              onClick={handleClose}
              className={cn(
                "rounded px-3 py-1.5 text-13",
                step === "done" ? "bg-accent-primary font-medium text-white hover:opacity-90" : "text-secondary hover:bg-layer-2"
              )}
            >
              {step === "done" ? "Done" : "Cancel"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
