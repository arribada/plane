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
 *
 * ── why the label now says more than on/off ─────────────────────────────────
 *
 * "le pushing dependant ça ne semble pas marcher." It was on, and a drag moved
 * one bar. The switch has TWO states in which that is the correct behaviour, and
 * neither of them was visible anywhere:
 *
 * 1. THE BOARD HAS NO LINKS TO PUSH ALONG. A push follows the project's
 *    dependency graph; a project with no dependencies — which is most of them
 *    here — has nothing downstream of anything. `base-gantt-root` skipped the
 *    whole computation on `graph.length > 0` and said nothing, so an empty graph
 *    and a broken feature looked identical.
 * 2. THIS BOARD CANNOT PUSH AT ALL. The portfolio deliberately does not load the
 *    per-project relation store (see `portfolio/root.tsx`), so the feature is
 *    unavailable there — but the preference is persisted under one key shared by
 *    every timeline store, so a user who turned it on inside a project arrives
 *    at the portfolio with it on and nothing to show for it.
 *
 * Both are now states of the control itself, which is the honest place for them:
 * a switch that is on and cannot act should not look like a switch that is on
 * and working.
 */
import { observer } from "mobx-react";
import { GitBranch } from "lucide-react";
import { cn } from "@plane/utils";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

const CHIP = "flex h-7 items-center gap-1.5 rounded-md border px-2 text-11 font-medium transition-colors";

type Props = {
  /**
   * How many schedulable dependency links this chart can see. Omitted where the
   * count is not known; `0` is the meaningful value — the switch can be on and
   * still have nothing to do.
   */
  linkCount?: number;
};

export const PushDependentsToggle = observer(function PushDependentsToggle({ linkCount }: Props) {
  const { pushDependents, togglePushDependents } = useTimeLineChartStore();
  const idle = pushDependents && linkCount === 0;

  return (
    <button
      type="button"
      onClick={() => togglePushDependents()}
      aria-pressed={pushDependents}
      title={
        idle
          ? "On, but nothing to push: no work item in this project depends on another yet. Drag from the round handle on the end of a bar to another bar to create a dependency, and a move will then carry the chain with it."
          : pushDependents
            ? "On: moving or extending a bar shifts everything that depends on it by the same number of working days, all the way down the chain. Ctrl+Z puts the whole move back."
            : "Off: moving a bar moves only that bar. Turn this on to carry its dependency chain with it."
      }
      className={cn(
        CHIP,
        idle
          ? // Not the accent colour. On-and-working and on-with-nothing-to-do are
            // different answers and must not be the same picture.
            "border-warning-strong/40 bg-warning-subtle text-warning-primary"
          : pushDependents
            ? "border-accent-strong/40 bg-accent-primary/10 text-accent-primary"
            : "border-subtle text-secondary hover:bg-layer-2 hover:text-primary"
      )}
    >
      <GitBranch className="size-3.5" />
      {idle ? "Pushing dependents — no links yet" : pushDependents ? "Pushing dependents" : "Push dependents"}
    </button>
  );
});

/**
 * The same control on a board that cannot honour it, drawn as unavailable.
 *
 * Not an `observer` and it does NOT read the timeline store: the portfolio's
 * toolbar sits outside the `TimeLineTypeContext` its chart provides, so
 * `useTimeLineChartStore` would throw there. It has nothing to read anyway — the
 * answer on this board is the same whichever way the preference is set.
 */
export function PushDependentsUnavailable({ reason }: { reason: string }) {
  return (
    <span className={cn(CHIP, "cursor-default border-subtle text-tertiary")} title={reason}>
      <GitBranch className="size-3.5" />
      Push dependents — per project
    </span>
  );
}
