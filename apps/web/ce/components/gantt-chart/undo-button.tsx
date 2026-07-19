/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Small Undo control for the issue gantt — appears only when a bar date edit can
 * be reverted. Ctrl+Z does the same thing (wired in base-gantt-root).
 */
import { observer } from "mobx-react";
import { Undo2 } from "lucide-react";
import { ganttUndo } from "@/plane-web/store/gantt-undo";

export const GanttUndoButton = observer(function GanttUndoButton({ onUndo }: { onUndo: () => void }) {
  if (!ganttUndo.canUndo) return null;
  return (
    <button
      type="button"
      onClick={onUndo}
      title="Undo last date change (Ctrl+Z)"
      className="flex items-center gap-1.5 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-12 text-secondary shadow-sm hover:bg-layer-2"
    >
      <Undo2 className="size-3.5" />
      Undo
    </button>
  );
});
