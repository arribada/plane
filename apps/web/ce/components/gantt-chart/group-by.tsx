/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Group by" for the issue gantt, beside "Colour by". Optional throughout: with no
 * grouping the chart is exactly what it was.
 *
 * It also carries the two row-shape switches that are not a grouping but belong
 * in the same menu, because they answer the same question — what is a row here:
 * following the dependency graph, and folding sub-tasks into their parents.
 */
import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { Check, ChevronDown, Rows3 } from "lucide-react";
import { useLightDismiss } from "@/plane-web/components/common/use-light-dismiss";
import { useGanttGroups } from "@/plane-web/components/gantt-chart/group-context";
import { GROUP_BY_OPTIONS } from "@/plane-web/components/gantt-chart/grouping";
import { ganttDisplay } from "@/plane-web/store/gantt-display";

export const GanttGroupBy = observer(function GanttGroupBy() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = GROUP_BY_OPTIONS.find((o) => o.value === ganttDisplay.groupBy);
  const grouping = ganttDisplay.groupBy !== "none";
  const { byKey, subtasks } = useGanttGroups();
  const keys = [...byKey.keys()];

  // The shared helper rather than the click-away backdrop this used to carry: a
  // full-screen backdrop swallows the click that dismisses it, so pressing the
  // next control along took two clicks. It also answers Escape, which the
  // backdrop never did.
  const menuRef = useLightDismiss<HTMLDivElement>({
    open,
    onDismiss: () => {
      const hadFocus = !!menuRef.current?.contains(document.activeElement);
      setOpen(false);
      // Dismissing a menu that holds the caret has to give the caret back, or the
      // next Tab starts from the top of the document.
      if (hadFocus) triggerRef.current?.focus();
    },
  });

  // What the drag consumed, when one has. The bands are gone and the rows kept
  // their order — saying so is the difference between a feature and a glitch.
  const flattenedFrom = ganttDisplay.flattenedFrom;
  const flattenedLabel = flattenedFrom
    ? (GROUP_BY_OPTIONS.find((o) => o.value === flattenedFrom)?.label ?? flattenedFrom)
    : null;

  const parents = subtasks.enabled ? subtasks.parentIds : [];

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title="Band the timeline by a field — the setup wizard's modules are Hardware, Firmware, Software…"
        className="shadow-sm flex items-center gap-1.5 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-12 text-secondary hover:bg-layer-2"
      >
        <Rows3 className="size-3.5" />
        Group:{" "}
        <span className="font-medium text-primary">
          {flattenedLabel ? `Manual (from ${flattenedLabel})` : (current?.label ?? "None")}
        </span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        // `whitespace-normal` is not decoration. This panel is a descendant of the
        // toolbar group in `base-gantt-root`, which is `whitespace-nowrap` so that a
        // narrow chart moves whole groups onto the next line rather than splitting
        // one down the middle — and `white-space` INHERITS, absolute positioning or
        // not. Every helper sentence in here was therefore forbidden to wrap and ran
        // out past the right edge, clipped mid-word. The nowrap has to stay where it
        // is (it is what makes the toolbar wrap correctly); a panel is a different
        // context and says so for itself. `break-words` is for the interpolated
        // group name below, which is somebody's module title and may have no spaces.
        <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-64 rounded-md border border-subtle bg-layer-1 p-1 break-words whitespace-normal">
          {flattenedLabel && (
            <p className="mb-1 rounded bg-layer-2 px-2 py-1.5 text-11 text-tertiary">
              A drag turned the <span className="text-secondary">{flattenedLabel}</span> bands into this manual order.
              The rows kept their places — pick {flattenedLabel} again to put the bands back.
            </p>
          )}
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

            {/* On by default. A sub-task drawn beside its parent claims to be a
                peer of the thing it is part of, and a generated plan is mostly
                parents with two or three each — so the flat list is three times
                longer than the plan it describes. Unticking gives it back. */}
            <button
              type="button"
              onClick={() => ganttDisplay.setNestSubtasks(!ganttDisplay.nestSubtasks)}
              className="flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-layer-2"
            >
              <span className="min-w-0">
                <span className="block text-13 text-primary">Nest sub-tasks</span>
                <span className="block text-11 text-tertiary">
                  Fold each work item&apos;s children into it. Checklist items are not sub-tasks and never move.
                </span>
              </span>
              {ganttDisplay.nestSubtasks && <Check className="mt-0.5 size-3.5 flex-shrink-0 text-accent-primary" />}
            </button>

            {ganttDisplay.nestSubtasks && parents.length > 0 && (
              <div className="flex gap-1 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => ganttDisplay.setAllSubtasksCollapsed(parents, true)}
                  className="flex-1 rounded px-2 py-1 text-11 text-secondary hover:bg-layer-2"
                >
                  Fold all sub-tasks
                </button>
                <button
                  type="button"
                  onClick={() => ganttDisplay.setAllSubtasksCollapsed(parents, false)}
                  className="flex-1 rounded px-2 py-1 text-11 text-secondary hover:bg-layer-2"
                >
                  Unfold all
                </button>
              </div>
            )}
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
      )}
    </div>
  );
});
