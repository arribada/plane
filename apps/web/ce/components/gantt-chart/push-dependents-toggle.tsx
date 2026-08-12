/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Push dependents" — whether moving a bar takes its chain with it.
 *
 * It sits with the lock, the baseline and undo rather than in the Display menu,
 * because it is not about what the chart draws: it changes what a drag WRITES.
 * Putting a switch that rewrites dates next to "shade weekends" would be the kind
 * of misfiling somebody discovers by accident.
 *
 * The label says which way it is set at a glance, because a control whose effect
 * is invisible until the next drag has to be readable at rest.
 */
import { observer } from "mobx-react";
import { GitBranch } from "lucide-react";
import { cn } from "@plane/utils";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

export const PushDependentsToggle = observer(function PushDependentsToggle() {
  const { pushDependents, togglePushDependents } = useTimeLineChartStore();

  return (
    <button
      type="button"
      onClick={() => togglePushDependents()}
      aria-pressed={pushDependents}
      title={
        pushDependents
          ? "On: moving or extending a bar shifts everything that depends on it by the same number of working days, all the way down the chain. Ctrl+Z puts the whole move back."
          : "Off: moving a bar moves only that bar. Turn this on to carry its dependency chain with it."
      }
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md border px-2 text-11 font-medium transition-colors",
        pushDependents
          ? "border-accent-strong/40 bg-accent-primary/10 text-accent-primary"
          : "border-subtle text-secondary hover:bg-layer-2 hover:text-primary"
      )}
    >
      <GitBranch className="size-3.5" />
      {pushDependents ? "Pushing dependents" : "Push dependents"}
    </button>
  );
});
