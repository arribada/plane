/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Project status: read the recent Asana-style updates and post a new one
 * (On track / At risk / Off track + a short note). Opened from the portfolio.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectStatus, TProjectStatusUpdate } from "@/plane-web/types/arribada";
import { useModalShell } from "@/plane-web/components/common/use-modal-shell";

export const STATUS_META: Record<TProjectStatus, { label: string; color: string; dot: string }> = {
  on_track: { label: "On track", color: "#10b981", dot: "bg-success-primary" },
  at_risk: { label: "At risk", color: "#f59e0b", dot: "bg-warning-primary" },
  off_track: { label: "Off track", color: "#ef4444", dot: "bg-danger-primary" },
};

type Props = {
  projectId: string | null;
  projectName?: string;
  onClose: () => void;
  onPosted: (projectId: string, update: TProjectStatusUpdate) => void;
};

export const ProjectStatusModal = observer(function ProjectStatusModal(props: Props) {
  const { projectId, projectName, onClose, onPosted } = props;
  const { workspaceSlug } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const [history, setHistory] = useState<TProjectStatusUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TProjectStatus>("on_track");
  const [message, setMessage] = useState("");
  const [posting, setPosting] = useState(false);

  // Escape, a focus trap, focus restored on close and a page that stops
  // scrolling underneath — the four things this hand-rolled overlay lacked.
  // Placed above the early return so the hook runs on every render.
  const { panelProps } = useModalShell({ open: !!projectId, onClose });

  useEffect(() => {
    if (!projectId || !workspaceSlug) return;
    setLoading(true);
    setMessage("");
    service
      .getProjectStatuses(workspaceSlug.toString(), projectId)
      .then((r) => setHistory(r || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [projectId, workspaceSlug, service]);

  if (!projectId) return null;

  const post = async () => {
    if (!workspaceSlug || posting) return;
    setPosting(true);
    try {
      const update = await service.postProjectStatus(workspaceSlug.toString(), projectId, {
        status,
        message: message.trim(),
      });
      setHistory((h) => [update, ...h]);
      setMessage("");
      onPosted(projectId, update);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={posting ? undefined : onClose}
      />
      <div
        className="shadow-2xl relative z-10 flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-subtle bg-layer-1"
        {...panelProps}
      >
        <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
          <h3 className="text-16 font-semibold text-primary">Status · {projectName ?? "Project"}</h3>
          <button type="button" onClick={onClose} className="text-secondary hover:text-primary">
            <X className="size-4" />
          </button>
        </div>

        {/* compose */}
        <div className="border-b border-subtle p-4">
          <div className="mb-2 flex gap-1.5">
            {(Object.keys(STATUS_META) as TProjectStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-12 font-medium",
                  status === s ? "border-transparent text-white" : "border-subtle text-secondary hover:bg-layer-2"
                )}
                style={status === s ? { backgroundColor: STATUS_META[s].color } : undefined}
              >
                <span className={cn("size-2 rounded-full", status === s ? "bg-white" : STATUS_META[s].dot)} />
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What changed? (optional)"
            rows={2}
            className="w-full resize-none rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-strong"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={post}
              disabled={posting}
              className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {posting && <Loader2 className="size-3.5 animate-spin" />}
              Post update
            </button>
          </div>
        </div>

        {/* history */}
        <div className="flex-grow overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-6 text-secondary">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-4 text-center text-13 text-secondary">No status updates yet.</p>
          ) : (
            <ul className="space-y-3">
              {history.map((u) => (
                <li key={u.id} className="flex gap-2.5">
                  <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", STATUS_META[u.status]?.dot)} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-12">
                      <span className="font-medium text-primary">{STATUS_META[u.status]?.label}</span>
                      <span className="text-secondary/70">
                        {u.author ?? "—"} · {new Date(u.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {u.message && <p className="mt-0.5 text-13 whitespace-pre-wrap text-secondary">{u.message}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
});
