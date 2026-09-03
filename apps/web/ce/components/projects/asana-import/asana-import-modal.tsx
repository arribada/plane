/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Import an Asana CSV export into a project as work items.
 *
 * Three steps: pick the file; say what each Asana Section should become here (a new module, an
 * existing one, or nothing); then import. Names, notes, start/due dates, the assignee (matched by
 * email), the parent/sub-task tree, the blocked-by/blocking links and the original Asana id are
 * all carried across. Everything the mapping cannot decide on its own is asked, never guessed.
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Loader2, Upload, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IModule } from "@plane/types";
import { cn } from "@plane/utils";
import { ModuleService } from "@/services/module.service";
import { IssueService } from "@/services/issue/issue.service";
import { WorkspaceService } from "@/services/workspace.service";
import { rowsFromCsv, type TAsanaRow } from "./asana-csv";

const moduleService = new ModuleService();
const issueService = new IssueService();
const workspaceService = new WorkspaceService();

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  onImported?: () => void | Promise<void>;
};

/** What a person chose to do with one Asana section. */
type TSectionChoice = { action: "new" | "existing" | "discard"; moduleId?: string; newName: string };

type TStep = "upload" | "map" | "importing" | "done";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Asana Notes are plain text; wrap paragraphs so the rich-text editor renders them, and stamp
 *  the original id so a work item can always be traced back to its Asana task. */
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

export const AsanaImportModal = observer(function AsanaImportModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, onImported } = props;

  const [step, setStep] = useState<TStep>("upload");
  const [rows, setRows] = useState<TAsanaRow[]>([]);
  const [modules, setModules] = useState<IModule[]>([]);
  const [emailToUserId, setEmailToUserId] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, TSectionChoice>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);

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
    if (step === "importing") return; // never abandon a run mid-flight
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
    // Seed each section to "create a new module of the same name" — the safe, lossless default.
    const seeded: Record<string, TSectionChoice> = {};
    Array.from(new Set(parsed.map((r) => r.section).filter(Boolean))).forEach((s) => {
      seeded[s] = { action: "new", newName: s };
    });
    setChoices(seeded);
    // Fetch the project's modules (to map onto) and the workspace members (to match assignees).
    try {
      const [mods, members] = await Promise.all([
        moduleService.getModules(workspaceSlug, projectId).catch(() => [] as IModule[]),
        workspaceService.fetchWorkspaceMembers(workspaceSlug).catch(() => []),
      ]);
      setModules(mods);
      const map: Record<string, string> = {};
      for (const m of members) {
        const email = (m.member?.email || m.email || "").toLowerCase();
        if (email && m.member?.id) map[email] = m.member.id;
      }
      setEmailToUserId(map);
      // Pre-match a section to an existing module of the same (case-insensitive) name.
      setChoices((prev) => {
        const next = { ...prev };
        for (const s of Object.keys(next)) {
          const hit = mods.find((m) => m.name.trim().toLowerCase() === s.trim().toLowerCase());
          if (hit) next[s] = { action: "existing", moduleId: hit.id, newName: s };
        }
        return next;
      });
    } catch {
      /* mapping still works with an empty module list */
    }
    setStep("map");
  };

  const runImport = async () => {
    setStep("importing");
    setProgress({ done: 0, total: rows.length });
    let created = 0;
    let failed = 0;

    // Resolve each section to a module id (creating the new ones once, up front).
    const sectionModuleId: Record<string, string | undefined> = {};
    for (const section of sections) {
      const choice = choices[section];
      if (!choice || choice.action === "discard") continue;
      if (choice.action === "existing") sectionModuleId[section] = choice.moduleId;
      else {
        try {
          const mod = await moduleService.createModule(workspaceSlug, projectId, {
            name: (choice.newName || section).slice(0, 255),
          });
          sectionModuleId[section] = mod.id;
        } catch {
          /* a module that will not create just leaves its items un-grouped */
        }
      }
    }

    // Pass 1: create every work item, remembering Asana-name -> new id for the second pass.
    const idByName: Record<string, string> = {};
    for (const row of rows) {
      try {
        const assigneeId = row.assigneeEmail ? emailToUserId[row.assigneeEmail] : undefined;
        const moduleId = row.section ? sectionModuleId[row.section] : undefined;
        const issue = await issueService.createIssue(workspaceSlug, projectId, {
          name: row.name.slice(0, 255),
          description_html: buildDescription(row),
          ...(row.startDate ? { start_date: row.startDate } : {}),
          ...(row.dueDate ? { target_date: row.dueDate } : {}),
          ...(assigneeId ? { assignee_ids: [assigneeId] } : {}),
          ...(moduleId ? { module_ids: [moduleId] } : {}),
        });
        idByName[row.name] = issue.id;
        created += 1;
      } catch {
        failed += 1;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    // Pass 2: rebuild the parent tree and the blocked-by links now that every id exists.
    for (const row of rows) {
      const selfId = idByName[row.name];
      if (!selfId) continue;
      const parentId = row.parent ? idByName[row.parent] : undefined;
      if (parentId) {
        await issueService.patchIssue(workspaceSlug, projectId, selfId, { parent_id: parentId }).catch(() => {});
      }
      const blockerIds = row.blockedBy.map((n) => idByName[n]).filter(Boolean);
      if (blockerIds.length > 0) {
        await issueService
          .createIssueRelation(workspaceSlug, projectId, selfId, {
            related_list: blockerIds.map((related_issue) => ({
              relation_type: "blocked_by" as const,
              related_issue,
            })),
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={handleClose}
      />
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
                <span className="font-medium text-primary">{rows.length}</span> tasks found. Match each Asana section
                to a module here, or discard it.
              </p>
              <div className="space-y-2">
                {sections.length === 0 && <p className="text-12 text-tertiary">No sections in this export.</p>}
                {sections.map((section) => {
                  const choice = choices[section] ?? { action: "new", newName: section };
                  return (
                    <div key={section} className="rounded-md border border-subtle p-2.5">
                      <div className="mb-1.5 text-13 font-medium text-primary">{section}</div>
                      <div className="flex flex-wrap items-center gap-2 text-12">
                        <select
                          value={choice.action === "existing" ? choice.moduleId ?? "" : choice.action}
                          onChange={(e) => {
                            const v = e.target.value;
                            setChoices((prev) => ({
                              ...prev,
                              [section]:
                                v === "new"
                                  ? { action: "new", newName: section }
                                  : v === "discard"
                                    ? { action: "discard", newName: section }
                                    : { action: "existing", moduleId: v, newName: section },
                            }));
                          }}
                          className="rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
                        >
                          <option value="new">＋ Create module “{section}”</option>
                          {modules.length > 0 && <option disabled>── map to existing ──</option>}
                          {modules.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                          <option value="discard">✕ Discard (no module)</option>
                        </select>
                        {choice.action === "new" && (
                          <input
                            type="text"
                            value={choice.newName}
                            onChange={(e) =>
                              setChoices((prev) => ({
                                ...prev,
                                [section]: { action: "new", newName: e.target.value },
                              }))
                            }
                            className="w-40 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-primary"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-11 text-tertiary">
                Assignees: {matchedAssignees}/{totalAssignees} emails match a workspace member (the rest import
                unassigned). Parent tasks, dependencies and the Asana id are carried across automatically.
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
                step === "done"
                  ? "bg-accent-primary font-medium text-white hover:opacity-90"
                  : "text-secondary hover:bg-layer-2"
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
