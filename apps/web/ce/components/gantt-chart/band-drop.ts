/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a drop on a sprint or module band actually means — decided once, as data,
 * before anything is written.
 *
 * THE DEFECT THIS EXISTS TO PREVENT is a drop that does nothing and says nothing.
 * The decision used to be eight lines inside `assignToGroup` in
 * `base-gantt-root.tsx` with four bare `return`s in it — an item already in the
 * band, an item with no project, a "No sprint" drop on an item that is already
 * out, a module drop with nothing to change — and the caller invoked it as
 * `void assign(...)`, so a REJECTED write was swallowed on top. Every one of
 * those paths looked identical from the outside: you drag a work item onto a
 * sprint, you let go, and the chart does not move. That is the bug report this
 * file answers, and it is why there is no silent outcome below: every refusal
 * carries a reason and a sentence, and the only refusal with nothing to say is
 * the one where the drag was never ours to begin with.
 *
 * TWO THINGS ARE ALSO CORRECTED HERE.
 *
 * A module drop used to compute what to leave as "every module of mine that is
 * a band on this chart", which contradicted the comment directly above it
 * ("leaves the band it came from — not make this its only one, which would
 * silently strip memberships nobody touched"). An item in Hardware and Firmware,
 * dropped on Software, lost BOTH. The band it came from is not a derivation: it
 * is the row's own band, which the caller already knows, so it is passed in.
 *
 * And a synthetic row id is refused by name. Band headers (`__ggrp__:`) and the
 * portfolio's folder and status rows are real entries in the same id list the
 * rows come from; one reaching `addCycleToIssue` is a 404 on a uuid route, which
 * the store turns into a rejected promise and the screen turned into nothing.
 *
 * Pure on purpose. The gesture needs a real pointer and cannot be driven in
 * jsdom, but the decision it leads to is a function of a drop payload and a band
 * key, and that is the half worth pinning.
 */
import type { TGanttGroupBy } from "./grouping";
import { isSyntheticRowId } from "./grouping";

/**
 * The `dragInstanceId` every gantt sidebar row publishes — `gantt-dnd-HOC.tsx`,
 * `getInitialData`. A band only accepts a drag that came off one of its own
 * rows; anything else on the page that happens to be draggable is somebody
 * else's gesture. Written out rather than imported because that file is
 * upstream's and this fork does not add exports to it.
 */
export const GANTT_ROW_DRAG_INSTANCE = "GANTT_REORDER";

/**
 * The key `buildGroups` files an item under when it has no value for the
 * dimension — "Not in a sprint", "No module". Duplicated from `grouping.ts`,
 * where it is private, and pinned by a test that runs `buildGroups` and reads
 * the key back: a drift here would turn "take it out of its sprint" into "put it
 * in the sprint whose id is the string `__unset__`", which is a 404.
 */
export const UNSET_GROUP_KEY = "__unset__";

/** Why a drop was not honoured. Named rather than boolean because each one needs
 *  a different sentence, and because "it did nothing" is the answer this whole
 *  file exists to stop being the only one available. */
export type TBandDropRefusal =
  | "not-our-drag"
  | "no-item"
  | "synthetic-row"
  | "unknown-item"
  | "no-project"
  | "not-assignable"
  | "locked"
  | "already-in-band"
  | "already-out";

/** What the caller should do, or why it will not. `message` is what to say out
 *  loud; `null` only for a drag that was never aimed at this chart. */
export type TBandDropPlan =
  | { kind: "join-sprint"; issueId: string; cycleId: string; bandLabel?: string }
  | { kind: "leave-sprint"; issueId: string; cycleId: string }
  | { kind: "join-modules"; issueId: string; add: string[]; remove: string[] }
  | { kind: "leave-modules"; issueId: string; remove: string[] }
  | { kind: "refused"; reason: TBandDropRefusal; message: string | null };

/** Only what the decision reads. Narrower than `TIssue` so a test can hand over
 *  four fields instead of building a whole work item. */
export type TBandDropIssue = {
  id: string;
  project_id?: string | null;
  cycle_id?: string | null;
  module_ids?: string[] | null;
};

export type TBandDropInput = {
  /** `source.data`, exactly as pragmatic-drag-and-drop hands it to `onDrop`. */
  source: Record<string, unknown> | null | undefined;
  /** The band that was dropped on. `UNSET_GROUP_KEY` for the leftovers band. */
  groupKey: string;
  groupBy: TGanttGroupBy;
  /**
   * Whether this reader may change the plan at all — Plane's permission AND the
   * fork's plan lock. Read at DROP time rather than when the handler was built:
   * `CycleIssueViewSet` and `ModuleIssueViewSet` are both in `GUARDED` in
   * `plane/arribada/plan_guard.py`, so a locked plan answers 403, the store
   * rolls its optimistic write back, and the row snaps home. Refusing here turns
   * that into a sentence instead of a flinch.
   */
  canEditPlan: boolean;
  /** The work item the payload names, as the store has it. */
  getIssue: (id: string) => TBandDropIssue | null | undefined;
  /** The band the row is in NOW — the caller has the grouped list, so this is
   *  the row's actual band rather than a re-derivation that could disagree with
   *  what is on screen. Null when it is in none. */
  bandOf: (id: string) => string | null;
  /** For the sentence. Optional: a refusal reads fine without it. */
  bandLabel?: string;
};

const refuse = (reason: TBandDropRefusal, message: string | null): TBandDropPlan => ({
  kind: "refused",
  reason,
  message,
});

/** The bands a work item can actually BELONG to. State, priority, assignee and
 *  label bands are views of a field: nobody aims at a header meaning to
 *  re-prioritise, so offering it there would turn a mis-drop into a silent edit. */
const isAssignable = (groupBy: TGanttGroupBy): groupBy is "cycle" | "module" =>
  groupBy === "cycle" || groupBy === "module";

/**
 * The one decision. Order matters: whose gesture, then what it names, then
 * whether this reader may, then whether the band can hold it, then whether it is
 * already there.
 */
export const planBandDrop = (input: TBandDropInput): TBandDropPlan => {
  const { source, groupKey, groupBy, canEditPlan, getIssue, bandOf, bandLabel } = input;

  // Not ours, and nothing to say about it. `canDrop` already refuses these, so
  // reaching here at all means another adapter is in play.
  if (!source || source.dragInstanceId !== GANTT_ROW_DRAG_INSTANCE) return refuse("not-our-drag", null);

  const issueId = source.id;
  if (typeof issueId !== "string" || issueId.length === 0)
    return refuse("no-item", "That drag did not carry a work item.");

  // A band header, a portfolio folder or a status row. Real entries in the same
  // id list, and a uuid route would 404 on any of them.
  if (isSyntheticRowId(issueId)) return refuse("synthetic-row", "That row is a heading, not a work item.");

  if (!groupKey) return refuse("not-assignable", "That band has no key to file anything under.");

  if (!isAssignable(groupBy))
    return refuse(
      "not-assignable",
      "Only sprint and module bands can be dropped into. The others show a field, and changing it by aiming at a header is not something anyone means to do."
    );

  if (!canEditPlan)
    return refuse("locked", "This plan is locked, or it is not yours to edit, so the item was left where it was.");

  const issue = getIssue(issueId);
  if (!issue) return refuse("unknown-item", "That work item is not loaded on this chart.");
  // Nullable on the type: a draft item has no project, and there is nothing to
  // file one into.
  if (!issue.project_id) return refuse("no-project", "A draft work item has no project to file it in.");

  const target = groupKey === UNSET_GROUP_KEY ? null : groupKey;
  const named = bandLabel ? `“${bandLabel}”` : "that band";

  if (groupBy === "cycle") {
    if (!target) {
      if (!issue.cycle_id) return refuse("already-out", "That work item is not in a sprint already.");
      return { kind: "leave-sprint", issueId: issue.id, cycleId: issue.cycle_id };
    }
    if (issue.cycle_id === target) return refuse("already-in-band", `That work item is already in ${named}.`);
    return { kind: "join-sprint", issueId: issue.id, cycleId: target, ...(bandLabel ? { bandLabel } : {}) };
  }

  const current = issue.module_ids ?? [];

  if (!target) {
    // "No module" means no module. Leaving one behind would file the row under
    // THAT module's band instead — a drop that visibly lands somewhere else is
    // read as a drop that went wrong.
    if (current.length === 0) return refuse("already-out", "That work item is not in a module already.");
    return { kind: "leave-modules", issueId: issue.id, remove: [...current] };
  }

  if (current.includes(target)) return refuse("already-in-band", `That work item is already in ${named}.`);

  // An item can sit in several modules and a drop means "put it in this one".
  // Only the band it was actually drawn in is left; every other membership
  // belongs to somebody else's decision.
  const from = bandOf(issue.id);
  const remove = from && from !== UNSET_GROUP_KEY && from !== target && current.includes(from) ? [from] : [];
  return { kind: "join-modules", issueId: issue.id, add: [target], remove };
};

/** What to say when a drop was honoured. Said out loud for the same reason the
 *  refusals are: the row moves band, and on a long chart it moves off screen. */
export const describeBandDrop = (plan: TBandDropPlan, bandLabel?: string): string => {
  const named = bandLabel ? `“${bandLabel}”` : "that band";
  switch (plan.kind) {
    case "join-sprint":
      return `Moved into ${named}.`;
    case "leave-sprint":
      return "Taken out of its sprint.";
    case "join-modules":
      return plan.remove.length > 0 ? `Moved into ${named}.` : `Added to ${named}.`;
    case "leave-modules":
      return plan.remove.length > 1 ? `Taken out of its ${plan.remove.length} modules.` : "Taken out of its module.";
    case "refused":
      return plan.message ?? "";
  }
};
