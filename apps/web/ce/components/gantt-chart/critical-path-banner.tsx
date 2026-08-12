/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What the critical path is doing, above the chart — and, now, the control that
 * makes the chart show it.
 *
 * ---------------------------------------------------------------------------
 * Round one: a sentence
 * ---------------------------------------------------------------------------
 *
 * The chain used to be expressed only as the colour of a dependency arrow, so a
 * project with no links drew nothing at all and the feature read as doing
 * nothing. This strip named it instead, and said WHY when there was nothing to
 * name. That part worked: the follow-up report quotes the sentence back.
 *
 * ---------------------------------------------------------------------------
 * Round two: a sentence is not a visualisation
 * ---------------------------------------------------------------------------
 *
 * "Critical path: 20 work items with no room to slip. Je le vois fonctionner sur
 * le projet RSPB medium mais c'est pas très clair visuellement."
 *
 * Twenty items are named and the reader cannot see which twenty. Two things were
 * missing and neither is another mark:
 *
 *   * The count had no consequence attached. Twenty items is a quantity; the
 *     DATE those twenty end on is the thing that moves when one of them slips,
 *     and it is what a project lead is actually holding. The sentence carries it
 *     now.
 *   * There was no way to ask the chart. The banner is the obvious place for
 *     that control — the reader is already looking at it, having just read the
 *     number they want explained — so the sentence IS the button. Pressing it
 *     veils everything with float and lights the chain through it; see
 *     `critical-path.ts` for why that is a de-emphasis rather than a fifth
 *     visual language.
 *
 * The four not-ok states stay exactly as they were: there is no chain to focus,
 * so there is no button, only the reason and what to do about it.
 */
import type { FC } from "react";
import { Route } from "lucide-react";
import { cn } from "@plane/utils";
import type { TCriticalPathDiagnostics } from "@/plane-web/types/arribada";
import { formatChainDate, type TChainSpan } from "./critical-path";

type Props = {
  diagnostics: TCriticalPathDiagnostics | null;
  /** How many bars the chart is actually marking. Read from the same set the
   *  overlay outlines, so the count and the red rings cannot disagree. */
  markedCount: number;
  /** First and last day of the chain, for the consequence half of the sentence.
   *  Null when the chain's items are not all dated. */
  span?: TChainSpan;
  /** Whether the chart is currently in the focused state. */
  focused?: boolean;
  /** Absent on a chart with no chain to focus, which is also every state below
   *  `ok` — the strip stays a sentence there. */
  onToggleFocus?: (next: boolean) => void;
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
  markedCount: number,
  options: { span?: TChainSpan; focused?: boolean } = {}
): { text: string; hint?: string; tone: "info" | "warn" } => {
  switch (diagnostics.status) {
    case "ok": {
      const count = markedCount || diagnostics.critical_count;
      // The consequence, not just the quantity. "20 work items" is a fact about
      // the plan; "18 Jul moves" is a fact about the delivery, and it is the one
      // the reader came for.
      const ends = options.span
        ? ` They finish ${formatChainDate(options.span.end)} — if any one slips, that does.`
        : "";
      return {
        text: `Critical path: ${plural(count, "work item")} with no room to slip.${ends}`,
        hint: options.focused
          ? "Everything with room to move is dimmed, with a tail showing how many days it has."
          : `Outlined in red. ${plural(diagnostics.usable_relation_count, "dependency", "dependencies")} across ${plural(diagnostics.linked_count, "linked item")}.`,
        tone: "info",
      };
    }
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

export const CriticalPathBanner: FC<Props> = function CriticalPathBanner({
  diagnostics,
  markedCount,
  span,
  focused = false,
  onToggleFocus,
}) {
  // Nothing until the first answer arrives, and nothing at all on a server that
  // predates the diagnostics — an empty strip beats a guessed cause.
  if (!diagnostics) return null;
  const message = criticalPathMessage(diagnostics, markedCount, { span, focused });
  if (!message.text) return null;

  // Only offered when there is a chain AND bars to mark. On every other status
  // the strip is a diagnosis, and there is nothing to isolate.
  const canFocus = !!onToggleFocus && diagnostics.status === "ok" && markedCount > 0;

  const body = (
    <p className="min-w-0 text-left">
      <span className="font-medium">{message.text}</span>
      {message.hint && <span className="ml-1.5 text-tertiary">{message.hint}</span>}
    </p>
  );

  return (
    <div
      className={cn("flex flex-shrink-0 items-start gap-2 border-b px-4 py-1.5 text-12", {
        "border-subtle bg-layer-1 text-secondary": message.tone === "info" && !focused,
        // Focused, the strip is the chart's current subject rather than a note
        // beside it, and it has to look like a state you can leave.
        "border-danger-strong bg-danger-subtle text-danger-primary": focused,
        "border-warning-strong bg-warning-subtle text-warning-primary": message.tone === "warn" && !focused,
      })}
    >
      <Route
        className={cn("mt-0.5 size-3.5 flex-shrink-0", {
          "text-danger-primary": message.tone === "info" && !focused,
        })}
      />
      {canFocus ? (
        // The sentence is the button. The reader has just read the number they
        // want explained; making them find a control elsewhere in a toolbar to
        // ask about it is how a feature stays invisible.
        <button
          type="button"
          aria-pressed={focused}
          onClick={() => onToggleFocus?.(!focused)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded text-left hover:underline"
          title={
            focused
              ? "Put the rest of the plan back"
              : "Dim everything with room to move, and light the chain running through what is left"
          }
        >
          {body}
          <span className="mt-px flex-shrink-0 rounded border border-current px-1.5 py-px text-11 font-medium opacity-80">
            {focused ? "Show everything" : "Highlight"}
          </span>
        </button>
      ) : (
        body
      )}
    </div>
  );
};
