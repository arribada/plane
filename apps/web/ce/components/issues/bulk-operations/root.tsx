/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Real bulk action bar (upstream ships an upgrade banner here). The multi-select
 * machinery already exists in core; this wires the selection to bulk archive /
 * delete and a quick priority set. A reload after a mutation keeps it simple and
 * correct rather than threading store updates through every layout.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, Archive, Trash2, X, SignalHigh, FolderInput } from "lucide-react";
import { cn } from "@plane/utils";
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import { useProject } from "@/hooks/store/use-project";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { IssueService } from "@/services/issue/issue.service";
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

const service = new IssueService();
const arribada = new ArribadaService();

export const IssueBulkOperationsRoot = observer(function IssueBulkOperationsRoot(props: Props) {
  const { className, selectionHelpers } = props;
  const { workspaceSlug, projectId } = useParams();
  const { isSelectionActive, selectedEntityIds, clearSelection } = useMultipleSelectStore();
  const { joinedProjectIds, getProjectById } = useProject();
  const [busy, setBusy] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  if (!isSelectionActive || selectionHelpers.isSelectionDisabled) return null;

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  const ids = selectedEntityIds;

  const done = () => {
    clearSelection();
    window.location.reload();
  };

  const setPriority = async (priority: Prio) => {
    if (!ws || !pid || busy) return;
    setBusy(true);
    setPrioOpen(false);
    try {
      await Promise.all(ids.map((id) => service.patchIssue(ws, pid, id, { priority })));
      done();
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!ws || !pid || busy) return;
    setBusy(true);
    try {
      await service.bulkArchiveIssues(ws, pid, { issue_ids: ids });
      done();
    } finally {
      setBusy(false);
    }
  };

  const adopt = async (targetProjectId: string) => {
    if (!ws || busy) return;
    setBusy(true);
    setMoveOpen(false);
    try {
      await arribada.adoptIssues(ws, ids, targetProjectId);
      done();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!ws || !pid || busy) return;
    if (!window.confirm(`Delete ${ids.length} work item(s)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await service.bulkDeleteIssues(ws, pid, { issue_ids: ids });
      done();
    } finally {
      setBusy(false);
    }
  };

  const btn = "flex items-center gap-1.5 rounded px-2.5 py-1 text-13 hover:bg-layer-2 disabled:opacity-50";

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-subtle bg-layer-1 px-2 py-1.5 shadow-lg",
        className
      )}
    >
      <span className="mr-1 rounded bg-accent/15 px-2 py-0.5 text-13 font-medium text-accent">
        {ids.length} selected
      </span>

      <div className="relative">
        <button type="button" className={btn} disabled={busy} onClick={() => setPrioOpen((v) => !v)}>
          <SignalHigh className="size-3.5" />
          Priority
        </button>
        {prioOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setPrioOpen(false)} />
            <div className="absolute bottom-full left-0 z-30 mb-1 w-32 rounded-md border border-subtle bg-layer-1 p-1 shadow-lg">
              {PRIORITIES.map((p) => (
                <button
                  type="button"
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  className="flex w-full items-center rounded px-2 py-1 text-left text-13 hover:bg-layer-2"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button type="button" className={btn} disabled={busy} onClick={() => setMoveOpen((v) => !v)}>
          <FolderInput className="size-3.5" />
          Move to project
        </button>
        {moveOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMoveOpen(false)} />
            <div className="absolute bottom-full left-0 z-30 mb-1 max-h-64 w-52 overflow-y-auto rounded-md border border-subtle bg-layer-1 p-1 shadow-lg">
              <div className="px-2 py-1 text-11 text-placeholder">Adopt into (keeps a link, marks these done)</div>
              {joinedProjectIds
                .filter((id) => id !== projectId?.toString())
                .map((id) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => adopt(id)}
                    className="flex w-full items-center rounded px-2 py-1 text-left text-13 hover:bg-layer-2"
                  >
                    {getProjectById(id)?.name ?? id}
                  </button>
                ))}
            </div>
          </>
        )}
      </div>

      <button type="button" className={btn} disabled={busy} onClick={archive}>
        <Archive className="size-3.5" />
        Archive
      </button>
      <button type="button" className={cn(btn, "text-danger-primary")} disabled={busy} onClick={remove}>
        <Trash2 className="size-3.5" />
        Delete
      </button>

      <div className="mx-1 h-4 w-px bg-subtle" />
      <button type="button" className={btn} disabled={busy} onClick={clearSelection}>
        <X className="size-3.5" />
        {busy ? "Working…" : "Cancel"}
      </button>
      {busy && <AlertTriangle className="size-3.5 animate-pulse text-secondary" />}
    </div>
  );
});
