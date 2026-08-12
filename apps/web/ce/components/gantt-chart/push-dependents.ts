/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Move a task, and take its chain with it.
 *
 * Dragging a bar used to move exactly that bar. On a plan with dependencies that
 * is almost never what somebody means: a three-week slip on the enclosure design
 * does not leave the moulding trial where it was, it moves it three weeks too.
 * Doing that by hand, one bar at a time, down a chain of nine, is how a plan stops
 * being maintained.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is NOT `cascade()` and must not be folded into it.
 *
 * `cascade()` (scheduling.py) answers "where is the earliest each task could
 * legally start", so it pulls every successor up against its predecessor and
 * SQUEEZES the gaps out of the chain. It is the right answer for the "auto
 * schedule" button, which is asking to be re-planned.
 *
 * This answers "the author moved one thing; move what follows it by the same
 * amount". Gaps are deliberate — a two-week cure, a review window, somebody's
 * leave — and a drag is not permission to spend them. So every downstream task
 * is TRANSLATED by the same delta and its duration is preserved; the shape of
 * the chain is exactly what it was.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The decisions this makes, and why:
 *
 * TRANSITIVE, not one level. A one-level push leaves the chain broken at level
 * two — the direct successor moves, its own successor does not, and the link
 * between them is now violated by the very gesture that was supposed to keep the
 * plan consistent. Half a cascade is worse than none.
 *
 * MEASURED AT THE END THAT MOVED. An FS successor waits on its predecessor's
 * FINISH, an SS successor on its START. So a pure move (both ends by N) pushes by
 * N either way; growing a task to the right (finish +N, start unchanged) pushes
 * its FS successors by N and its SS successors not at all; dragging its start
 * earlier without moving the finish pushes nothing. That falls out of reading the
 * right end per edge kind rather than being three special cases.
 *
 * WORKING DAYS. See `working-days.ts`. Durations are preserved in working days
 * exactly as `_working_span` does server-side, so a task that spanned a weekend
 * does not lose two days by being moved onto a Monday.
 *
 * NEVER SILENTLY. Everything this refuses to move comes back named, with the
 * reason, so the caller can say so. A bulk date rewrite that reports a number and
 * nothing else is how `reflow` got flagged.
 */
import type { TGraphEdge } from "./edges";
import { addWorkingDays, fromEpochDay, toEpochDay, weekdaysBetween, workingDelta } from "./working-days";

/** One task's dates, as the chart holds them. */
export type TSpan = { start_date?: string | null; target_date?: string | null };

export type TPushRefusalReason =
  /** The mover may not edit this item — `allow_edit_others` is off and it is not theirs. */
  | "not-editable"
  /** No bar: an item with only one date, or neither, has nothing to translate. */
  | "undated"
  /** Its dates are outside any horizon a plan can mean — see MAX_WORKING_STEPS. */
  | "implausible"
  /** It sits in another project; this write cannot reach it. */
  | "other-project";

export type TPushInput = {
  originId: string;
  /** The origin's dates BEFORE the gesture. */
  before: TSpan;
  /** The origin's dates AFTER it — what the drag is about to write. */
  after: TSpan;
  /** predecessor -> successor, already normalised. See `edges.ts`. */
  edges: readonly TGraphEdge[];
  /** Current dates of every item that could be reached. Anything absent is
   *  treated as not on this board and is not touched. */
  spans: Readonly<Record<string, TSpan | undefined>>;
  /** Ids the mover is not allowed to write. A cascade must not become a way
   *  around a per-item permission. */
  notEditable?: ReadonlySet<string>;
  /** Ids belonging to a project other than the one being written. */
  otherProject?: ReadonlySet<string>;
  /** ISO date an item may not start before, because it is waiting on a delivery
   *  (`schedule_from_deliveries` + `expected_on` / `received_on`). Only ever
   *  binding on a BACKWARD push — nothing about a part arriving stops work being
   *  planned later than it. */
  floors?: Readonly<Record<string, string>>;
  /** A workspace closure or statutory holiday, by ISO date. */
  isHoliday?: (iso: string) => boolean;
};

export type TPushMove = { id: string; start_date: string; target_date: string };

export type TPushOutcome = {
  /** Signed working days the origin's FINISH moved. */
  finishDelta: number;
  /** Signed working days the origin's START moved. */
  startDelta: number;
  /** Downstream items whose dates change, origin EXCLUDED — the caller is
   *  already writing that one. */
  moves: TPushMove[];
  /** Reached, but left alone. Named so the caller can say so. */
  refused: { id: string; reason: TPushRefusalReason }[];
  /** Pushed backwards into a delivery it is waiting on, and held at that date
   *  instead. Its own successors still move by the full delta — holding one item
   *  is a smaller lie than dragging its whole tail back with it. */
  held: { id: string; floor: string }[];
};

const EMPTY_OUTCOME: TPushOutcome = { finishDelta: 0, startDelta: 0, moves: [], refused: [], held: [] };

/** The two ends of a span, as epoch days, or null if it is not a drawable bar. */
const spanDays = (span: TSpan | undefined): { start: number; target: number } | null => {
  const start = toEpochDay(span?.start_date);
  const target = toEpochDay(span?.target_date);
  if (start === null || target === null) return null;
  return { start, target };
};

/**
 * Which downstream items move, and by how much.
 *
 * Pure: it reads dates and edges and returns a decision. Nothing here writes,
 * fetches or touches a store, which is what makes "given a move of N days, which
 * items move" a question a test can ask without a mouse.
 */
export const pushDependents = (input: TPushInput): TPushOutcome => {
  const { originId, edges, spans, notEditable, otherProject, floors, isHoliday } = input;

  const before = spanDays(input.before);
  const after = spanDays(input.after);
  // A bar that had no dates before the gesture is being GIVEN dates, not moved,
  // and there is no delta to propagate.
  if (!before || !after) return EMPTY_OUTCOME;

  const holidayDays = new Set<number>();
  if (isHoliday) {
    // Only the window actually spanned by the gesture is consulted, so this stays
    // a handful of lookups rather than a scan of the calendar.
    const from = Math.min(before.start, after.start) - 1;
    const to = Math.max(before.target, after.target) + 1;
    if (to - from <= 4000) {
      for (let day = from; day <= to; day += 1) if (isHoliday(fromEpochDay(day))) holidayDays.add(day);
    }
  }

  const startDelta = workingDelta(before.start, after.start, holidayDays);
  const finishDelta = workingDelta(before.target, after.target, holidayDays);
  if (startDelta === 0 && finishDelta === 0) return { ...EMPTY_OUTCOME };

  // successors, and the delta each edge kind carries out of a given node
  const successors = new Map<string, { to: string; kind: TGraphEdge["kind"] }[]>();
  for (const edge of edges) {
    const list = successors.get(edge.from);
    if (list) list.push({ to: edge.to, kind: edge.kind });
    else successors.set(edge.from, [{ to: edge.to, kind: edge.kind }]);
  }

  /**
   * Breadth-first over the chain, keeping the LARGEST delta proposed for each
   * node.
   *
   * Largest rather than first, because a node with two moved predecessors is
   * constrained by the later of them — and on a backward push "largest" is the
   * least negative, so a task is never pulled earlier than one of its
   * predecessors permits. A node already seen with a delta at least this big is
   * not re-queued, which is also what terminates on a cycle: the fork's own data
   * can and does contain A→B→A, and `_topo_order` drops those rows rather than
   * looping. Dropping them here would mean silently not moving them, so they are
   * visited — once each, at their strongest delta.
   */
  const proposed = new Map<string, number>();
  const queue: { id: string; delta: number }[] = [];

  for (const edge of successors.get(originId) ?? []) {
    const delta = edge.kind === "FS" ? finishDelta : startDelta;
    if (delta === 0) continue;
    queue.push({ id: edge.to, delta });
  }

  let guard = 0;
  const CEILING = 100_000;
  while (queue.length > 0) {
    guard += 1;
    if (guard > CEILING) break;
    const next = queue.shift();
    if (!next) break;
    if (next.id === originId) continue; // a cycle back to the thing being dragged
    const seen = proposed.get(next.id);
    if (seen !== undefined && seen >= next.delta) continue;
    proposed.set(next.id, next.delta);
    // A moved task translates rigidly, so both of its ends move by the same
    // amount — its successors see one delta whatever kind their edge is.
    for (const edge of successors.get(next.id) ?? []) queue.push({ id: edge.to, delta: next.delta });
  }

  const moves: TPushMove[] = [];
  const refused: TPushOutcome["refused"] = [];
  const held: TPushOutcome["held"] = [];

  // Stable order: the caller names these in a toast and in an undo entry, and a
  // Map's insertion order is breadth-first, which reads as the chain does.
  for (const [id, delta] of proposed) {
    if (otherProject?.has(id)) {
      refused.push({ id, reason: "other-project" });
      continue;
    }
    if (notEditable?.has(id)) {
      refused.push({ id, reason: "not-editable" });
      continue;
    }
    const current = spanDays(spans[id]);
    if (!current) {
      refused.push({ id, reason: "undated" });
      continue;
    }
    const duration = Math.max(1, weekdaysBetween(current.start, current.target));
    let start = addWorkingDays(current.start, delta, isHoliday);
    if (start === null) {
      refused.push({ id, reason: "implausible" });
      continue;
    }
    // A delivery floor binds only downwards. `expected_on` says "the part is not
    // here before this"; it says nothing about how late the work may be planned.
    const floorIso = floors?.[id];
    const floor = floorIso ? toEpochDay(floorIso) : null;
    if (floor !== null && start < floor) {
      start = floor;
      held.push({ id, floor: fromEpochDay(floor) });
    }
    const target = addWorkingDays(start, duration - 1, isHoliday);
    if (target === null) {
      refused.push({ id, reason: "implausible" });
      continue;
    }
    const startIso = fromEpochDay(start);
    const targetIso = fromEpochDay(target);
    // Nothing to write is not a move. A one-day forward drag over a Friday can
    // land a Saturday-started task on the same Monday it already had.
    if (startIso === spans[id]?.start_date && targetIso === spans[id]?.target_date) continue;
    moves.push({ id, start_date: startIso, target_date: targetIso });
  }

  return { finishDelta, startDelta, moves, refused, held };
};

/** A one-line summary a toast can carry, in the same voice as the rest of the
 *  chart: what moved, by how much, and what did not. */
export const describePush = (outcome: TPushOutcome): string => {
  const days = Math.abs(outcome.finishDelta || outcome.startDelta);
  const direction = (outcome.finishDelta || outcome.startDelta) < 0 ? "earlier" : "later";
  const parts = [
    `${outcome.moves.length} dependent ${outcome.moves.length === 1 ? "item" : "items"} moved ${days} working ${days === 1 ? "day" : "days"} ${direction}`,
  ];
  if (outcome.held.length > 0) parts.push(`${outcome.held.length} held at an expected delivery`);
  const notEditable = outcome.refused.filter((r) => r.reason === "not-editable").length;
  if (notEditable > 0) parts.push(`${notEditable} you may not edit were left alone`);
  const elsewhere = outcome.refused.filter((r) => r.reason === "other-project").length;
  if (elsewhere > 0) parts.push(`${elsewhere} in another project were left alone`);
  const undated = outcome.refused.filter((r) => r.reason === "undated").length;
  if (undated > 0) parts.push(`${undated} with no dates were left alone`);
  const implausible = outcome.refused.filter((r) => r.reason === "implausible").length;
  if (implausible > 0) parts.push(`${implausible} with unusable dates were left alone`);
  return `${parts.join(" · ")}.`;
};
