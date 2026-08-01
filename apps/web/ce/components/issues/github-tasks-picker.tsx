/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Link GitHub tasks to this work item": lists the open items sitting in the
 * GitHub-inbox (GHIN) project, lets you tick several, and adopts them as
 * sub-issues of the current work item (lossless copy + relates_to back to the
 * GHIN original). This is how one work item comes to contain many GitHub tasks.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Github, Loader2, ExternalLink, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TGithubInboxItem } from "@/plane-web/types/arribada";
import { useModalShell } from "@/plane-web/components/common/use-modal-shell";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  parentIssueId: string;
  onLinked: () => void | Promise<void>;
};

export const GithubTasksPicker = observer(function GithubTasksPicker(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, parentIssueId, onLinked } = props;
  const service = useMemo(() => new ArribadaService(), []);

  const [items, setItems] = useState<TGithubInboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape, a focus trap, focus restored on close and a page that stops
  // scrolling underneath — the four things this hand-rolled overlay lacked.
  // Placed above the early return so the hook runs on every render.
  const { panelProps } = useModalShell({ open: isOpen, onClose });

  useEffect(() => {
    if (!isOpen) return;
    let ignore = false; // drop a response that resolves after this open was torn down
    setItems([]); // clear the previous open's list so it can't flash on reopen
    setSelected(new Set());
    setError(null);
    setLoading(true);
    service
      .listGithubInbox(workspaceSlug)
      .then((rows) => {
        if (!ignore) setItems(rows || []);
        return undefined;
      })
      .catch(() => {
        if (!ignore) setError("Couldn't load the GitHub inbox.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [isOpen, workspaceSlug, service]);

  if (!isOpen) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await service.adoptIssues(workspaceSlug, [...selected], projectId, parentIssueId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "GitHub tasks linked",
        message: `${res.adopted} task${res.adopted === 1 ? "" : "s"} added to this work item.`,
      });
      await onLinked();
      onClose();
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Linking failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={busy ? undefined : onClose}
      />
      <div
        className="shadow-2xl relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-subtle bg-layer-1"
        {...panelProps}
      >
        <div className="flex items-center justify-between border-b border-subtle px-5 py-4">
          <h3 className="flex items-center gap-2 text-16 font-semibold text-primary">
            <Github className="size-4 text-secondary" />
            Link GitHub tasks
          </h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-secondary hover:text-primary">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-13 text-secondary">
              <Loader2 className="size-4 animate-spin" /> Loading GitHub inbox…
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-13 text-secondary">The GitHub inbox is empty — nothing to link.</div>
          ) : (
            items.map((it) => {
              const checked = selected.has(it.id);
              return (
                <label
                  key={it.id}
                  // The item's name sits three levels down, past the depth the
                  // rule inspects, so the control is tied to the label explicitly
                  // and the name is repeated as the accessible label.
                  htmlFor={`github-task-${it.id}`}
                  aria-label={it.name}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-2 hover:bg-layer-2",
                    checked && "bg-layer-2"
                  )}
                >
                  <input
                    id={`github-task-${it.id}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(it.id)}
                    className="accent-blue-500 mt-0.5 size-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-13 text-primary">{it.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-11 text-placeholder">
                      <span className="font-mono">
                        {it.project_identifier}-{it.sequence_id}
                      </span>
                      {it.state && <span>· {it.state}</span>}
                      {it.github_url && (
                        <a
                          href={it.github_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-0.5 text-accent-primary hover:underline"
                        >
                          GitHub <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {error && (
          <p className="mx-5 mb-2 rounded bg-danger-subtle px-2.5 py-1.5 text-12 text-danger-primary">{error}</p>
        )}

        <div className="flex items-center justify-between border-t border-subtle px-5 py-3">
          <span className="text-12 text-secondary">
            {selected.size > 0 ? `${selected.size} selected` : "Select tasks to attach"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || selected.size === 0}
              className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {busy ? "Linking…" : "Link to work item"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
