/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Fill in the rest" — from a title, propose the fields nobody fills in.
 *
 * It PROPOSES. Everything it returns lands in the form the person is already
 * looking at, every field still editable, and only their Save creates anything.
 * A guessed priority or discipline written straight to the database is a field
 * nobody ever re-reads, and on a plan that ends up in a funder report that is
 * worse than leaving it blank.
 *
 * The same contract the planning assistant follows: it shows its plan before
 * applying it.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

export type TAiDraft = {
  description: string;
  role: string | null;
  priority: string | null;
  estimate_days: number | null;
  is_milestone: boolean;
  confidence: string;
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  /** The title as typed right now — the only thing the model is given to go on. */
  title: string;
  onDraft: (draft: TAiDraft) => void;
};

export function AiFillButton({ workspaceSlug, projectId, title, onDraft }: Props) {
  const [busy, setBusy] = useState(false);
  const ready = title.trim().length >= 4;

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const draft = await service.aiDraftWorkItem(workspaceSlug, projectId, title.trim());
      onDraft(draft);
      setToast({
        type: TOAST_TYPE.INFO,
        title: "Filled in — check it before saving",
        message:
          draft.confidence === "low"
            ? "The model said it was unsure from this title. Read what it wrote before you keep it."
            : "Nothing has been saved. Every field is still yours to change.",
      });
    } catch (error) {
      const message = (error as { error?: string })?.error;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't fill it in",
        // The server phrases its own configuration errors for a human, so they are
        // shown rather than replaced with something vaguer.
        message: message || "The assistant didn't answer. Nothing was changed.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={!ready || busy}
      title={
        ready
          ? "Suggest a description, discipline, priority and estimate from this title — nothing is saved"
          : "Type a title first"
      }
      className={cn(
        "flex items-center gap-1 rounded border border-subtle px-2 py-1 text-11 text-secondary transition-colors",
        ready && !busy ? "hover:bg-layer-1 hover:text-primary" : "cursor-not-allowed opacity-50"
      )}
    >
      <Sparkles className="size-3" />
      {busy ? "Thinking…" : "Fill in the rest"}
    </button>
  );
}
