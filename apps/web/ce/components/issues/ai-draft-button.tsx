/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Finishes a work item from the one line somebody typed into the title box.
 *
 * Creating a task by hand means writing a title, then a description, then guessing a
 * duration, then picking a discipline, then finding whoever covers it — and most
 * people stop after the title. This fills the rest in, into fields that are still
 * editable, which is the only reason it is safe for it to be wrong.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TAiDraft } from "@/plane-web/types/arribada";

type Props = {
  projectId: string | null | undefined;
  /** The title box's current value — the whole input. */
  title: string;
  /** Whether the description is still empty; a filled one is never overwritten. */
  descriptionEmpty: boolean;
  onDraft: (draft: TAiDraft) => void;
  onUndo: () => void;
};

export const AiDraftButton = observer(function AiDraftButton({
  projectId,
  title,
  descriptionEmpty,
  onDraft,
  onUndo,
}: Props) {
  const { workspaceSlug } = useParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<TAiDraft | null>(null);

  const slug = workspaceSlug?.toString();
  // Below three characters there is nothing to work from, and asking anyway would
  // spend a model call to be told so.
  const ready = Boolean(slug && projectId && title.trim().length >= 3);

  const run = async () => {
    if (!ready || busy || !slug || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await new ArribadaService().aiDraft(slug, projectId, { title: title.trim() });
      onDraft(draft);
      setApplied(draft);
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Couldn't draft this one.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={!ready || busy}
        title={
          ready
            ? "Draft the description, dates and discipline from the title"
            : "Type a title first — that is what this works from"
        }
        className={cn(
          "flex items-center gap-1.5 rounded border border-subtle px-2 py-1 text-12 font-medium text-secondary",
          "hover:bg-layer-2 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-accent-primary" />}
        {applied ? "Draft again" : "Draft with AI"}
      </button>

      {applied && (
        <>
          <span className="text-11 text-tertiary">
            {applied.role ? `${applied.role} · ` : ""}
            {applied.days}d{applied.assignee_name ? ` · ${applied.assignee_name}` : ""}
            {applied.reason ? ` — ${applied.reason}` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              onUndo();
              setApplied(null);
            }}
            className="flex items-center gap-1 text-11 text-tertiary hover:text-primary"
          >
            <Undo2 className="size-3" />
            Undo
          </button>
        </>
      )}

      {!descriptionEmpty && !applied && (
        <span className="text-11 text-tertiary">Drafting fills the dates and discipline; your description stays.</span>
      )}
      {error && <span className="text-11 text-danger-primary">{error}</span>}
    </div>
  );
});
