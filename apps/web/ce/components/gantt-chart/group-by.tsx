/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Group by" for the issue gantt, beside "Colour by". Optional throughout: with no
 * grouping the chart is exactly what it was.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Check, ChevronDown, Rows3 } from "lucide-react";
import { useGanttGroups } from "@/plane-web/components/gantt-chart/group-context";
import { GROUP_BY_OPTIONS } from "@/plane-web/components/gantt-chart/grouping";
import { ganttDisplay } from "@/plane-web/store/gantt-display";

export const GanttGroupBy = observer(function GanttGroupBy() {
  const [open, setOpen] = useState(false);
  const current = GROUP_BY_OPTIONS.find((o) => o.value === ganttDisplay.groupBy);
  const grouping = ganttDisplay.groupBy !== "none";
  const { byKey } = useGanttGroups();
  const keys = [...byKey.keys()];

  // Escape closes it. The click-away backdrop below only answers a mouse, and a
  // menu you cannot dismiss from the keyboard is a menu you can get stuck in.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Band the timeline by a field — the setup wizard's modules are Hardware, Firmware, Software…"
        className="shadow-sm flex items-center gap-1.5 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-12 text-secondary hover:bg-layer-2"
      >
        <Rows3 className="size-3.5" />
        Group: <span className="font-medium text-primary">{current?.label ?? "None"}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close the grouping menu"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-60 rounded-md border border-subtle bg-layer-1 p-1">
            {GROUP_BY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  ganttDisplay.setGroupBy(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-layer-2"
              >
                <span className="min-w-0">
                  <span className="block text-13 text-primary">{o.label}</span>
                  {o.hint && <span className="block text-11 text-tertiary">{o.hint}</span>}
                </span>
                {ganttDisplay.groupBy === o.value && (
                  <Check className="mt-0.5 size-3.5 flex-shrink-0 text-accent-primary" />
                )}
              </button>
            ))}
            {/* Row order sits here rather than in Plane's own "order by": that list is
                a field sort the API applies, and walking the dependency graph is
                neither a field nor something the API knows how to do. */}
            <div className="mt-1 border-t border-subtle pt-1">
              <span className="block px-2 py-0.5 text-11 text-tertiary">Row order</span>
              <button
                type="button"
                onClick={() => {
                  ganttDisplay.setRowOrder(ganttDisplay.rowOrder === "graph" ? "default" : "graph");
                  setOpen(false);
                }}
                className="flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-layer-2"
              >
                <span className="min-w-0">
                  <span className="block text-13 text-primary">Follow dependencies</span>
                  <span className="block text-11 text-tertiary">Everything a task waits on sits above it</span>
                </span>
                {ganttDisplay.rowOrder === "graph" && (
                  <Check className="mt-0.5 size-3.5 flex-shrink-0 text-accent-primary" />
                )}
              </button>
            </div>

            {grouping && keys.length > 0 && (
              <div className="mt-1 flex gap-1 border-t border-subtle pt-1">
                {/* Folding every band is how you get from 37 rows to six and read the
                    shape of the project in one screen. */}
                <button
                  type="button"
                  onClick={() => ganttDisplay.setAllGroupsCollapsed(keys, true)}
                  className="flex-1 rounded px-2 py-1 text-11 text-secondary hover:bg-layer-2"
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  onClick={() => ganttDisplay.setAllGroupsCollapsed(keys, false)}
                  className="flex-1 rounded px-2 py-1 text-11 text-secondary hover:bg-layer-2"
                >
                  Expand all
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});
