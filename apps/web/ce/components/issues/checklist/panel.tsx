/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The work items this one contains.
 *
 * Not sub-issues, and deliberately so. A parent link shows up in every list,
 * board, timeline and filter, so using it to say "these five things make up that
 * one" buries the plan under its own decomposition. Membership of a checklist
 * shows up here and nowhere else.
 *
 * A ticked box is not a tick stored beside the work — it is the work item moved
 * to a completed state. One fact, one place, so the checklist and the board can
 * never disagree about what is finished.
 */
import type { FormEvent } from "react";
import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { CheckSquare, Loader2, Plus, Square, Trash2, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn, generateWorkItemLink } from "@plane/utils";
import { useIssueChecklist } from "./use-checklist";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
};

export const IssueChecklistPanel = observer(function IssueChecklistPanel(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false } = props;
  const checklist = useIssueChecklist(workspaceSlug, projectId, issueId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyLine, setBusyLine] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await checklist.addByName(name);
      setDraft("");
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't add that line",
        message: (error as { error?: string })?.error || "Nothing was added.",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (lineId: string) => {
    const item = checklist.items.find((row) => row.id === lineId);
    if (!item || busyLine) return;
    setBusyLine(lineId);
    try {
      await checklist.toggle(item, !item.done);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't change that work item",
        // Ticking writes a state, so the failure is usually that the member's
        // project has no completed state — worth saying rather than "failed".
        message: (error as { error?: string; message?: string })?.error ?? "It was left as it was.",
      });
    } finally {
      setBusyLine(null);
    }
  };

  const remove = async (lineId: string, name: string) => {
    if (!window.confirm(`Take "${name}" off this checklist? The work item itself stays.`)) return;
    try {
      await checklist.remove(lineId);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't remove that line", message: "It is still there." });
    }
  };

  const total = checklist.items.length;
  const done = checklist.items.filter((row) => row.done).length;

  // Read-only and empty: say nothing at all rather than add another empty box to
  // a panel that is already long.
  if (disabled && checklist.loaded && total === 0) return null;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-11 font-medium tracking-wide text-tertiary uppercase">
          Checklist{total > 0 ? ` · ${done}/${total}` : ""}
        </p>
        {!disabled && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-11 text-secondary hover:text-primary"
          >
            <Plus className="size-3" />
            Add a line
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={submit} className="mb-2 flex items-center gap-2 rounded-lg border border-subtle bg-layer-2 p-2">
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Solder the antenna feed"
            aria-label="New checklist line"
            className="min-w-0 flex-1 rounded border border-subtle bg-surface-1 px-2 py-1 text-12 text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
            className="p-1 text-secondary hover:text-primary"
            aria-label="Cancel"
          >
            <X className="size-3.5" />
          </button>
        </form>
      )}

      {!checklist.loaded && checklist.loading ? (
        <div className="h-8 animate-pulse rounded bg-layer-1" />
      ) : total === 0 ? (
        <p className="text-11 text-tertiary">
          Nothing on it yet. A line here is a real work item — it just does not show up as a sub-issue.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {checklist.items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2">
              <button
                type="button"
                disabled={disabled || busyLine === item.id}
                onClick={() => void toggle(item.id)}
                aria-pressed={item.done}
                aria-label={item.done ? `Reopen ${item.name}` : `Complete ${item.name}`}
                className="flex-shrink-0 text-tertiary hover:text-accent-primary disabled:opacity-50"
              >
                {busyLine === item.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : item.done ? (
                  <CheckSquare className="size-3.5 text-accent-primary" />
                ) : (
                  <Square className="size-3.5" />
                )}
              </button>

              <Link
                href={generateWorkItemLink({
                  workspaceSlug,
                  projectId: item.project_id,
                  issueId: item.issue_id,
                  projectIdentifier: item.project_identifier,
                  sequenceId: item.sequence_id,
                })}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-12 text-primary hover:text-accent-primary hover:underline"
              >
                <span className="flex-shrink-0 text-10 text-tertiary">
                  {item.project_identifier}-{item.sequence_id}
                </span>
                <span className={cn("truncate", { "text-tertiary line-through": item.done })}>{item.name}</span>
              </Link>

              {!disabled && (
                <button
                  type="button"
                  onClick={() => void remove(item.id, item.name)}
                  aria-label={`Take ${item.name} off this checklist`}
                  className={cn(
                    // p-2 -m-2 leaves the icon where it is and takes the target to ~44px.
                    "-m-2 flex-shrink-0 p-2 text-tertiary opacity-0 transition-opacity",
                    "group-hover:opacity-100 hover:text-danger-primary focus-visible:opacity-100"
                  )}
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
