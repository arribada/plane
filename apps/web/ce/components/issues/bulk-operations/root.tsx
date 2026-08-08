/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Real bulk action bar (upstream ships an upgrade banner here). The multi-select
 * machinery already exists in core; this wires the selection to bulk archive /
 * delete, a quick priority set, adoption into another project and the planning
 * assistant. Priority and delete update the issue store in place (optimistic, no
 * page reload); archive/adopt change list membership in ways the layout stores
 * don't cleanly cover, so those still refresh the view.
 *
 * EVERY ACTION HERE REPORTS WHAT HAPPENED TO EACH ITEM. It did not: this file
 * contained no `setToast` and no error state of any kind. `Promise.allSettled`
 * was used for the right reason — one failing item must not abandon the other
 * eleven — and then its results were thrown away, so five rejections out of
 * twelve cleared the selection and left a list showing five rows. The obvious
 * reading is that the delete did not take, and the obvious response is to run it
 * again on work that is already gone.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Loader2, Archive, Trash2, X, SignalHigh, FolderInput, Sparkles, CheckCircle2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import { useProject } from "@/hooks/store/use-project";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { IssueService } from "@/services/issue/issue.service";
import { AiPlanModal } from "@/plane-web/components/planning/ai-plan-modal";
import { apiErrorMessage } from "@/plane-web/services/api-error";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type Props = {
  className?: string;
  selectionHelpers: TSelectionHelper;
};

type Prio = "urgent" | "high" | "medium" | "low" | "none";
const PRIORITIES: { value: Prio; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
];

// AdoptIssuesEndpoint answers with the ids it just created; the shared service
// type (owned elsewhere) only declares the counters, and those ids are the whole
// point of the hand-off — so widen the answer here rather than lose them.
type TAdoptResponse = {
  adopted: number;
  parent_id: string | null;
  issues?: { source_id: string; new_issue_id: string; sequence_id: number }[];
};

// A batch of work items that all live in the same project — the planner endpoint
// is per project, so nothing may ever be sent without one of these.
type TPlanTarget = {
  projectId: string;
  projectName: string;
  ids: string[];
  title: string;
  // Set when the batch came from an adopt: closing the modal then owes the caller
  // the view refresh that the adopt itself deferred.
  fromAdopt?: boolean;
};

const service = new IssueService();
const arribada = new ArribadaService();

/**
 * What a per-item batch actually did, said out loud.
 *
 * `verb` is past tense and reads as the headline ("Deleted 7 of 12"). The failed
 * items are NAMED where the caller can name them: "5 failed" tells somebody the
 * selection is now a lie without telling them which half of it.
 *
 * The list is capped because a batch of two hundred cannot fit in a toast, and a
 * toast that scrolls is a toast nobody reads to the end of.
 */
const NAMED_IN_TOAST = 5;

const reportBatch = (verb: string, outcomes: PromiseSettledResult<unknown>[], labels: string[]) => {
  const failedIndexes = outcomes.flatMap((outcome, index) => (outcome.status === "rejected" ? [index] : []));
  const total = outcomes.length;
  if (failedIndexes.length === 0) {
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: `${verb} ${total} work item${total === 1 ? "" : "s"}`,
    });
    return;
  }
  const named = failedIndexes.slice(0, NAMED_IN_TOAST).map((index) => labels[index] ?? "an unnamed item");
  const rest = failedIndexes.length - named.length;
  const reason = apiErrorMessage(
    (outcomes[failedIndexes[0] ?? 0] as PromiseRejectedResult | undefined)?.reason,
    "The server refused them."
  );
  setToast({
    type: TOAST_TYPE.ERROR,
    title: `${verb} ${total - failedIndexes.length} of ${total} — ${failedIndexes.length} failed`,
    message: `${reason} Still untouched: ${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}.`,
  });
};

export const IssueBulkOperationsRoot = observer(function IssueBulkOperationsRoot(props: Props) {
  const { className, selectionHelpers } = props;
  const { workspaceSlug, projectId } = useParams();
  const { isSelectionActive, selectedEntityIds, clearSelection } = useMultipleSelectStore();
  const { joinedProjectIds, getProjectById } = useProject();
  const {
    updateIssue,
    removeIssue,
    issue: { getIssueById },
  } = useIssueDetail();
  const [busy, setBusy] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planTarget, setPlanTarget] = useState<TPlanTarget | null>(null);
  const [adopted, setAdopted] = useState<TPlanTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  const ids = selectedEntityIds;
  // No early return: the adopt hand-off and the planner outlive the selection.
  const barVisible = isSelectionActive && !selectionHelpers.isSelectionDisabled;

  // This bar also runs in workspace-level views, where one selection can span
  // several projects while every write below is per project. Resolve each id to
  // its own project so an id can never reach another project's endpoint.
  const groups: { projectId: string; projectName: string; ids: string[] }[] = [];
  let unresolved = 0;
  for (const id of ids) {
    const owner = getIssueById(id)?.project_id ?? pid ?? null;
    if (!owner) {
      unresolved += 1;
      continue;
    }
    const group = groups.find((g) => g.projectId === owner);
    if (group) group.ids.push(id);
    else groups.push({ projectId: owner, projectName: getProjectById(owner)?.name ?? owner, ids: [id] });
  }

  /** How a work item is referred to in a report — its key where the store knows
   *  one, because "PROJ-14" is what somebody can go and look at. */
  const labelFor = (id: string): string => {
    const issue = getIssueById(id);
    const identifier = issue?.project_id ? getProjectById(issue.project_id)?.identifier : undefined;
    if (identifier && issue?.sequence_id != null) return `${identifier}-${issue.sequence_id}`;
    return issue?.name ?? id;
  };

  // Archive changes which items belong in the list; the layout stores have no
  // clean "drop from local list" hook for it, so it still refreshes the view.
  const doneWithRefresh = () => {
    clearSelection();
    window.location.reload();
  };

  // Adopt completes the sources server-side and puts the copies in another
  // project — neither is something the layout stores can be told about from
  // here, so this stays a reload. It only runs once the hand-off has been used
  // or dismissed, because reloading straight away would throw the new ids away.
  const finishAdopt = () => {
    setAdopted(null);
    window.location.reload();
  };

  const setPriority = async (priority: Prio) => {
    if (!ws || !pid || busy) return;
    setBusy(true);
    setPrioOpen(false);
    // Captured before clearSelection empties it: the report has to name the items
    // the batch was given, not the ones left over.
    const batch = [...ids];
    const labels = batch.map(labelFor);
    try {
      // Optimistic store update — the list re-renders in place, no page reload.
      // allSettled so one failing item doesn't abort the batch or skip clearSelection.
      const outcomes = await Promise.allSettled(batch.map((id) => updateIssue(ws, pid, id, { priority })));
      clearSelection();
      // The store update is optimistic, so a rejected item shows the NEW priority
      // in the list while the server still holds the old one. Saying nothing here
      // means the board and the database disagree and only one of them says so.
      reportBatch(`Set ${priority === "none" ? "no priority" : priority} on`, outcomes, labels);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!ws || !pid || busy) return;
    setBusy(true);
    const count = ids.length;
    try {
      await service.bulkArchiveIssues(ws, pid, { issue_ids: ids });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `Archived ${count} work item${count === 1 ? "" : "s"}`,
      });
      doneWithRefresh();
    } catch (error) {
      // One request for the whole batch, so it is all or nothing — and it used to
      // be nothing, quietly: the view did not reload, the selection stayed, and
      // the bar looked like it had ignored the click.
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Nothing was archived",
        message: apiErrorMessage(error, `All ${count} work item${count === 1 ? "" : "s"} are still in the list.`),
      });
    } finally {
      setBusy(false);
    }
  };

  const adopt = async (targetProjectId: string) => {
    if (!ws || busy) return;
    setBusy(true);
    setMoveOpen(false);
    const count = ids.length;
    const targetName = getProjectById(targetProjectId)?.name ?? targetProjectId;
    try {
      const res = (await arribada.adoptIssues(ws, ids, targetProjectId)) as TAdoptResponse;
      const newIds = (res.issues ?? []).map((i) => i.new_issue_id).filter(Boolean);
      clearSelection();
      // The endpoint can adopt a subset — foreign ids, permissions, an item
      // already adopted — and the hand-off bar below only ever counted what came
      // back, so a partial adopt read as a complete one.
      if (res.adopted < count) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: `Adopted ${res.adopted} of ${count} into ${targetName}`,
          message: `${count - res.adopted} could not be adopted and are unchanged in their own project.`,
        });
      }
      if (newIds.length === 0) {
        finishAdopt();
        return;
      }
      setNotice(null);
      setAdopted({
        projectId: targetProjectId,
        projectName: targetName,
        ids: newIds,
        title: `Complete ${newIds.length} newly adopted work item${newIds.length === 1 ? "" : "s"}`,
        fromAdopt: true,
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: `Nothing was adopted into ${targetName}`,
        message: apiErrorMessage(error, `All ${count} work item${count === 1 ? "" : "s"} stayed where they were.`),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!ws || !pid || busy) return;
    if (!window.confirm(`Delete ${ids.length} work item(s)? This cannot be undone.`)) return;
    setBusy(true);
    const batch = [...ids];
    const labels = batch.map(labelFor);
    try {
      // removeIssue deletes on the server and drops the row from the store — no reload.
      const outcomes = await Promise.allSettled(batch.map((id) => removeIssue(ws, pid, id)));
      clearSelection();
      // The rejections used to be discarded by construction. Five failures out of
      // twelve cleared the selection and left five rows on screen, which reads as
      // "the delete did nothing" — and the natural response is to select them and
      // press delete again.
      reportBatch("Deleted", outcomes, labels);
    } finally {
      setBusy(false);
    }
  };

  const planGroup = (group: { projectId: string; projectName: string; ids: string[] }) => {
    setPlanOpen(false);
    setNotice(null);
    // The selection is deliberately kept: with a multi-project selection the user
    // comes straight back here for the next project.
    setPlanTarget({
      projectId: group.projectId,
      projectName: group.projectName,
      ids: group.ids,
      title: `Complete ${group.ids.length} selected work item${group.ids.length === 1 ? "" : "s"}`,
    });
  };

  const startPlanning = () => {
    if (busy || groups.length === 0) return;
    const only = groups[0];
    // A single project goes straight in; several make the user pick one, because
    // the endpoint would reject the foreign ids and report a partial result.
    if (groups.length === 1 && only) planGroup(only);
    else setPlanOpen((v) => !v);
  };

  const planAdopted = () => {
    if (!adopted) return;
    setPlanTarget(adopted);
    setAdopted(null);
  };

  const btn = "flex items-center gap-1.5 rounded px-2.5 py-1 text-13 hover:bg-layer-2 disabled:opacity-50";
  const bar = "flex items-center gap-1 rounded-lg border border-subtle bg-layer-1 px-2 py-1.5 shadow-lg";
  const menuItem = "flex w-full items-center rounded px-2 py-1 text-left text-13 hover:bg-layer-2";

  return (
    <>
      {barVisible && (
        <div className={cn(bar, className)}>
          <span className="mr-1 rounded bg-accent-primary/15 px-2 py-0.5 text-13 font-medium text-accent-primary">
            {ids.length} selected
          </span>

          {/* Priority / Archive / Delete key off the single route projectId, so only
              offer them inside a project view (a workspace/global list can span projects). */}
          {pid && (
            <div className="relative">
              <button type="button" className={btn} disabled={busy} onClick={() => setPrioOpen((v) => !v)}>
                <SignalHigh className="size-3.5" />
                Priority
              </button>
              {prioOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="fixed inset-0 z-20 cursor-default"
                    onClick={() => setPrioOpen(false)}
                  />
                  <div className="shadow-lg absolute bottom-full left-0 z-30 mb-1 w-32 rounded-md border border-subtle bg-layer-1 p-1">
                    {PRIORITIES.map((p) => (
                      <button type="button" key={p.value} onClick={() => setPriority(p.value)} className={menuItem}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="relative">
            <button type="button" className={btn} disabled={busy} onClick={() => setMoveOpen((v) => !v)}>
              <FolderInput className="size-3.5" />
              Move to project
            </button>
            {moveOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setMoveOpen(false)}
                />
                <div className="shadow-lg absolute bottom-full left-0 z-30 mb-1 max-h-64 w-52 overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1">
                  <div className="px-2 py-1 text-11 text-placeholder">Adopt into (keeps a link, marks these done)</div>
                  {joinedProjectIds
                    .filter((id) => id !== projectId?.toString())
                    .map((id) => (
                      <button type="button" key={id} onClick={() => adopt(id)} className={menuItem}>
                        {getProjectById(id)?.name ?? id}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              className={btn}
              disabled={busy || groups.length === 0}
              onClick={startPlanning}
              title={
                groups.length === 0
                  ? "None of the selected work items could be matched to a project"
                  : "Ask the assistant to schedule these work items"
              }
            >
              <Sparkles className="size-3.5" />
              Complete with AI
            </button>
            {planOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setPlanOpen(false)}
                />
                <div className="shadow-lg absolute bottom-full left-0 z-30 mb-1 max-h-64 w-64 overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1">
                  <div className="px-2 py-1 text-11 text-placeholder">
                    This selection spans {groups.length} projects — the assistant plans one project at a time.
                  </div>
                  {groups.map((g) => (
                    <button type="button" key={g.projectId} onClick={() => planGroup(g)} className={menuItem}>
                      <span className="truncate">{g.projectName}</span>
                      <span className="ml-auto pl-2 text-12 text-tertiary">{g.ids.length}</span>
                    </button>
                  ))}
                  {unresolved > 0 && (
                    <div className="px-2 py-1 text-11 text-tertiary">
                      {unresolved} item(s) have no known project and are left out.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {pid && (
            <>
              <button type="button" className={btn} disabled={busy} onClick={archive}>
                <Archive className="size-3.5" />
                Archive
              </button>
              <button type="button" className={cn(btn, "text-danger-primary")} disabled={busy} onClick={remove}>
                <Trash2 className="size-3.5" />
                Delete
              </button>
            </>
          )}

          {/* Dates are written server-side only: this list keeps showing the old
              ones until it refetches, so offer the refresh instead of looking unchanged. */}
          {notice && (
            <span className="ml-1 flex items-center gap-1.5 rounded bg-layer-2 px-2 py-0.5 text-12 text-secondary">
              {notice}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="font-medium text-accent-primary hover:underline"
              >
                Refresh
              </button>
            </span>
          )}

          <div className="mx-1 h-4 w-px bg-layer-2" />
          <button type="button" className={btn} disabled={busy} onClick={clearSelection}>
            <X className="size-3.5" />
            {busy ? "Working…" : "Cancel"}
          </button>
          {busy && <Loader2 className="size-3.5 animate-spin text-secondary" />}
        </div>
      )}

      {/* The hand-off after an import: the adopted copies are brand new and undated,
          and this is the one moment their ids are known without hunting for them. */}
      {adopted && (
        <div className={cn(bar, className)}>
          <CheckCircle2 className="size-3.5 text-accent-primary" />
          <span className="text-13 text-secondary">
            Adopted {adopted.ids.length} work item{adopted.ids.length === 1 ? "" : "s"} into {adopted.projectName}.
          </span>
          <button type="button" className={cn(btn, "font-medium text-accent-primary")} onClick={planAdopted}>
            <Sparkles className="size-3.5" />
            Complete {adopted.ids.length === 1 ? "this item" : `these ${adopted.ids.length} items`}
          </button>
          <div className="mx-1 h-4 w-px bg-layer-2" />
          <button type="button" className={btn} onClick={finishAdopt}>
            <X className="size-3.5" />
            Dismiss
          </button>
        </div>
      )}

      {/* Mounted only while a batch is in flight: the modal fetches the workspace AI
          settings on mount, and every board in the app renders this bar. */}
      {planTarget && (
        <AiPlanModal
          projectId={planTarget.projectId}
          projectName={planTarget.projectName}
          issueIds={planTarget.ids}
          title={planTarget.title}
          onClose={() => {
            const handoff = planTarget.fromAdopt ?? false;
            setPlanTarget(null);
            // Only now is the deferred adopt refresh safe: the ids have been used.
            if (handoff) finishAdopt();
          }}
          onApplied={(applied) => setNotice(applied > 0 ? `Wrote ${applied} date(s).` : "No dates were written.")}
          onReflowed={(moved) => setNotice(moved > 0 ? `Moved ${moved} work item(s).` : "Nothing to move.")}
        />
      )}
    </>
  );
});
