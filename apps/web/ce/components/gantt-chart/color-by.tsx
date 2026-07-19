/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Small floating "Colour by" control for the issue gantt (state / priority /
 * assignee / label). Sets the shared gantt-display preference the bar renderer reads.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { Check, ChevronDown, Palette } from "lucide-react";
import { ganttDisplay, type TGanttColorBy } from "@/plane-web/store/gantt-display";

const OPTIONS: { value: TGanttColorBy; label: string }[] = [
  { value: "state", label: "State" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "label", label: "Label" },
];

export const GanttColorBy = observer(function GanttColorBy() {
  const [open, setOpen] = useState(false);
  const current = OPTIONS.find((o) => o.value === ganttDisplay.colorBy);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Colour the timeline bars by a field"
        className="flex items-center gap-1.5 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-12 text-secondary shadow-sm hover:bg-layer-2"
      >
        <Palette className="size-3.5" />
        Colour: <span className="font-medium text-primary">{current?.label}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 w-36 rounded-md border border-subtle bg-layer-1 p-1 shadow-lg">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  ganttDisplay.setColorBy(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-13 hover:bg-layer-2"
              >
                {o.label}
                {ganttDisplay.colorBy === o.value && <Check className="size-3.5 text-accent-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});
