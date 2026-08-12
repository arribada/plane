/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The "Colour by" control for the work-item timeline.
 *
 * The axes and their words come from `color-dimension.ts` rather than being
 * spelled out again here — the portfolio's Colour control reads the same list,
 * and "Sprint" has to mean Sprint on both screens. The control itself only sets
 * the shared preference; which bar ends up which colour is decided once for the
 * whole chart by `color-scale.tsx`.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { Check, ChevronDown, Palette } from "lucide-react";
import { GANTT_COLOR_OPTIONS } from "./color-dimension";
import { ganttDisplay } from "@/plane-web/store/gantt-display";

export const GanttColorBy = observer(function GanttColorBy() {
  const [open, setOpen] = useState(false);
  const current = GANTT_COLOR_OPTIONS.find((o) => o.value === ganttDisplay.colorBy);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Colour the timeline bars by a field"
        className="shadow-sm flex items-center gap-1.5 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-12 text-secondary hover:bg-layer-2"
      >
        <Palette className="size-3.5" />
        Colour: <span className="font-medium text-primary">{current?.label}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-56 rounded-md border border-subtle bg-layer-1 p-1">
            {GANTT_COLOR_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                title={o.hint}
                onClick={() => {
                  ganttDisplay.setColorBy(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-13 hover:bg-layer-2"
              >
                {o.label}
                {ganttDisplay.colorBy === o.value && <Check className="size-3.5 flex-shrink-0 text-accent-primary" />}
              </button>
            ))}
            {/* Done-ness is a STATE, not a seventh series: a 45° hatch and a tick,
                never its own hue — a hue would eat a palette slot and collide
                with whichever series happened to own that colour. The toggle
                stays because "what is LEFT" is a real way to read a plan, and on
                that reading the finished bars are noise. It does not close the
                menu: it is a thing you flip while looking at the chart. */}
            <div className="my-1 h-px bg-layer-2" />
            <button
              type="button"
              onClick={() => ganttDisplay.setShowCompleted(!ganttDisplay.showCompleted)}
              title="Hatch finished work and mark it with a tick, so what is done reads at a glance"
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-13 hover:bg-layer-2"
            >
              <span
                className={
                  ganttDisplay.showCompleted
                    ? "flex size-4 flex-shrink-0 items-center justify-center rounded border border-accent-strong bg-accent-primary text-white"
                    : "flex size-4 flex-shrink-0 items-center justify-center rounded border border-subtle"
                }
              >
                {ganttDisplay.showCompleted && <Check className="size-3" />}
              </span>
              Show finished work
            </button>
          </div>
        </>
      )}
    </div>
  );
});
