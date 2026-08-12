/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What the critical path is doing, in a sentence, above the chart.
 *
 * The complaint was "je vois pas ce que fait le critical path". The computation
 * was not the problem — it answers in tens of milliseconds. The problem was that
 * the project timeline never SAID anything about it. The chain was expressed
 * only as the colour of a dependency arrow, so a project with no links drew
 * nothing at all, and a project with links drew a slightly redder line that
 * nobody has a legend for. Meanwhile the endpoint dutifully returned one
 * arbitrary work item as "the path" on a project with no dependencies, which is
 * the worst of both: invisible when you look for it, wrong when you find it.
 *
 * So: a strip that names the chain when there is one, a legend for the red, and
 * — the part that matters — a reason when there is not one. "No dependencies
 * recorded between the 77 dated work items" is a sentence somebody can act on.
 * A blank chart is not.
 */
import type { FC } from "react";
import { Route } from "lucide-react";
import { cn } from "@plane/utils";
import type { TCriticalPathDiagnostics } from "@/plane-web/types/arribada";

type Props = {
  diagnostics: TCriticalPathDiagnostics | null;
  /** How many bars the chart is actually marking. Read from the same set the
   *  overlay outlines, so the count and the red rings cannot disagree. */
  markedCount: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence, and whether it is news.
 *
 * `tone: "info"` is the ordinary case and sits back. `"warn"` is for the two
 * states that need an action from the reader — a loop, or links whose ends have
 * no dates — because those are the ones where the chart is silently wrong
 * rather than merely quiet.
 */
export const criticalPathMessage = (
  diagnostics: TCriticalPathDiagnostics,
  markedCount: number
): { text: string; hint?: string; tone: "info" | "warn" } => {
  switch (diagnostics.status) {
    case "ok":
      return {
        text: `Critical path: ${plural(markedCount || diagnostics.critical_count, "work item")} with no room to slip.`,
        hint: `Outlined in red. ${plural(diagnostics.usable_relation_count, "dependency", "dependencies")} across ${plural(diagnostics.linked_count, "linked item")}.`,
        tone: "info",
      };
    case "no_dependencies":
      return {
        text: `No dependencies recorded between these ${plural(diagnostics.dated_count, "dated work item")}, so there is no critical path to show.`,
        hint: 'Link two items with "blocked by" on a work item, or drag from one bar\'s edge to another, and the chain appears here.',
        tone: "info",
      };
    case "dependencies_undated":
      return {
        text: `${plural(diagnostics.relation_count, "dependency", "dependencies")} recorded, but every one of them has an end with no dates — so none can be scheduled.`,
        hint: `${plural(diagnostics.undated_count, "work item")} on this project still have no start or no end date.`,
        tone: "warn",
      };
    case "cycles_only":
      return {
        text: `${plural(diagnostics.cycle_count, "work item")} depend on each other in a loop, so there is no order to walk and no critical path.`,
        hint: "Remove one of the links in the loop and the chain can be computed.",
        tone: "warn",
      };
    case "no_dated_items":
      return {
        text: "Nothing on this project has both a start and an end date, so there is nothing to sequence.",
        hint: "Give the work items dates and the critical path follows from them.",
        tone: "info",
      };
    default:
      // A status this build does not know about — a newer server, most likely.
      // Say nothing rather than assert something wrong.
      return { text: "", tone: "info" };
  }
};

export const CriticalPathBanner: FC<Props> = function CriticalPathBanner({ diagnostics, markedCount }) {
  // Nothing until the first answer arrives, and nothing at all on a server that
  // predates the diagnostics — an empty strip beats a guessed cause.
  if (!diagnostics) return null;
  const message = criticalPathMessage(diagnostics, markedCount);
  if (!message.text) return null;

  return (
    <div
      className={cn("flex flex-shrink-0 items-start gap-2 border-b px-4 py-1.5 text-12", {
        "border-subtle bg-layer-1 text-secondary": message.tone === "info",
        "border-warning-strong bg-warning-subtle text-warning-primary": message.tone === "warn",
      })}
    >
      <Route className={cn("mt-0.5 size-3.5 flex-shrink-0", { "text-danger-primary": message.tone === "info" })} />
      <p className="min-w-0">
        <span className="font-medium">{message.text}</span>
        {message.hint && <span className="ml-1.5 text-tertiary">{message.hint}</span>}
      </p>
    </div>
  );
};
