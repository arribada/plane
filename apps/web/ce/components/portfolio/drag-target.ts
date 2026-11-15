/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Where a dragged portfolio bar's new dates have to be written.
 *
 * The portfolio draws three kinds of row in one list — a folder band, a project
 * summary, and the work items of an expanded project — and they do not share a
 * destination. A project's window is a `ProjectSchedule`; a work item's dates are
 * an issue write, and the endpoint that takes those is scoped to ONE project, so
 * a gesture that touches items in two projects is two requests. A folder band has
 * no dates at all.
 *
 * Kept apart from the component because it is the part with rules in it: which
 * rows may move, which may not and why, and how a mixed set is split. jsdom has
 * no drag physics, so the gesture cannot be tested — this can.
 */
import { OFFLINE_MESSAGE, isApiFailure } from "@/plane-web/services/api-error";

export type TPortfolioRowKind = "folder" | "project" | "item" | "unknown";

/** One row's proposed new dates, as the gantt hands them over. */
export type TPortfolioDateUpdate = { id: string; start_date?: string; target_date?: string };

export type TPortfolioDragContext = {
  kindOf: (id: string) => TPortfolioRowKind;
  /** The project a row belongs to: itself for a project row, the owner for an item. */
  projectOf: (id: string) => string | undefined;
  /** That project's plan is frozen — `ProjectSchedule.timeline_locked`. */
  isProjectLocked: (projectId: string) => boolean;
  /**
   * Whether THIS user may change that project's plan — the server's own answer
   * (`can_edit_plan` on the portfolio row, the same predicate as the 403).
   * Optional so a caller built against the older payload keeps working; absent
   * reads as allowed, exactly as `?? true` does on the schedule.
   */
  canEditPlan?: (projectId: string) => boolean;
  /** `allow_edit_others` for that project. Absent reads as allowed. */
  allowEditOthers?: (projectId: string) => boolean;
  /** Whether the current user is among an item row's assignees. Only consulted
   *  when `allowEditOthers` says no; absent reads as "not mine". */
  isAssignedToMe?: (itemId: string) => boolean;
};

export type TPortfolioRefusalReason =
  /** A band header. It spans the row to group things; it is not a dated thing. */
  | "folder-row"
  /** The row is not on this board any more — a stale drag against a reloaded list. */
  | "unknown-row"
  /** That project's plan is locked. Same rule as the per-project timeline, which
   *  is the entire point: two timelines that disagree about whether a plan is
   *  frozen teach people to distrust the lock. */
  | "locked"
  /** That project's plan is the lead's to change, and this is not the lead. The
   *  server would answer 403; refusing here is what stops a bar being drawn
   *  draggable for somebody it will then snap back on. */
  | "lead-only"
  /** With `allow_edit_others` off, an item moves only under its own assignees'
   *  hands. Project rows are not assigned to anybody and are not subject to it. */
  | "not-yours"
  /** An item row whose owning project could not be determined, so there is no
   *  project-scoped endpoint to send it to. */
  | "no-project";

export type TPortfolioRefusal = { id: string; reason: TPortfolioRefusalReason };

export type TPortfolioDragRoute = {
  /** Project windows to write, one `ProjectSchedule` PUT each. */
  projects: TPortfolioDateUpdate[];
  /** Work item dates, grouped by the project whose endpoint takes them. */
  itemsByProject: { projectId: string; updates: TPortfolioDateUpdate[] }[];
  refused: TPortfolioRefusal[];
};

/**
 * May this bar be dragged at all?
 *
 * Answered per row rather than per board, because the answer differs per row —
 * which is why the gantt's `enable*` props accept a function. A portfolio spans
 * many projects and each carries its own lock, so a board-wide boolean could only
 * ever be wrong for somebody.
 */
export const portfolioRowRefusal = (id: string, context: TPortfolioDragContext): TPortfolioRefusalReason | null => {
  const kind = context.kindOf(id);
  if (kind === "folder") return "folder-row";
  if (kind === "unknown") return "unknown-row";
  const projectId = context.projectOf(id);
  if (!projectId) return kind === "item" ? "no-project" : "unknown-row";
  if (context.isProjectLocked(projectId)) return "locked";
  // The same three gates the per-project timeline's `isAllowed` / `canEditBlock`
  // apply, in the same order. This used to stop at the lock, so a lead-only plan
  // and a not-yours item were drawn draggable here and refused by the server.
  if (!(context.canEditPlan?.(projectId) ?? true)) return "lead-only";
  if (kind === "item" && !(context.allowEditOthers?.(projectId) ?? true) && !(context.isAssignedToMe?.(id) ?? false))
    return "not-yours";
  return null;
};

export const canMovePortfolioRow = (id: string, context: TPortfolioDragContext): boolean =>
  portfolioRowRefusal(id, context) === null;

/** Split a drag's updates into the writes they actually are. */
export const routePortfolioDrag = (
  updates: readonly TPortfolioDateUpdate[],
  context: TPortfolioDragContext
): TPortfolioDragRoute => {
  const projects: TPortfolioDateUpdate[] = [];
  const byProject = new Map<string, TPortfolioDateUpdate[]>();
  const refused: TPortfolioRefusal[] = [];

  for (const update of updates) {
    // An update carrying neither date is not a write. The gantt sends one for a
    // half-dated block whose missing side was not the side dragged.
    if (update.start_date === undefined && update.target_date === undefined) continue;

    const reason = portfolioRowRefusal(update.id, context);
    if (reason) {
      refused.push({ id: update.id, reason });
      continue;
    }

    const kind = context.kindOf(update.id);
    if (kind === "project") {
      projects.push(update);
      continue;
    }
    const projectId = context.projectOf(update.id) as string;
    const list = byProject.get(projectId);
    if (list) list.push(update);
    else byProject.set(projectId, [update]);
  }

  return {
    projects,
    itemsByProject: [...byProject].map(([projectId, updates_]) => ({ projectId, updates: updates_ })),
    refused,
  };
};

/** What to tell somebody whose drag went nowhere. Null when nothing was refused
 *  for a reason worth saying out loud — a folder band never moves and nobody
 *  expects it to. */
export const describeRefusal = (refused: readonly TPortfolioRefusal[]): string | null => {
  if (refused.some((r) => r.reason === "locked"))
    return "That project's plan is locked. Unlock it on the project's own timeline to move these dates.";
  if (refused.some((r) => r.reason === "lead-only"))
    return "Only that project's lead (or a workspace admin) can change its plan.";
  if (refused.some((r) => r.reason === "not-yours"))
    return "That project only lets a work item's own assignees move it, and this one is not yours.";
  if (refused.some((r) => r.reason === "no-project"))
    return "That work item is not attached to a project on this board, so its dates could not be written.";
  if (refused.some((r) => r.reason === "unknown-row"))
    return "That row is no longer on this board. Reload and try again.";
  return null;
};

/** The server's own sentence, in the order DRF and plan_guard spell it. */
const sentenceIn = (body: Record<string, unknown> | null): string | undefined => {
  if (!body) return undefined;
  for (const key of ["detail", "error", "message"]) {
    const candidate = body[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
};

/**
 * What to say when the server refused a drag the board had allowed.
 *
 * The toast used to be "The dates were put back as they were." whatever the
 * reason — so a 403 from a lead-only plan read as a flaky network. Two shapes
 * arrive: `ArribadaService` (the project window) throws a normalised
 * `TApiFailure` with `status` and `offline`; upstream's `IssueService` (the
 * item dates) throws `error.response.data` alone, a body with no status. Both
 * carry the server's sentence when it sent one, and that sentence — `plan_guard`
 * says who may change the plan and what is still open — is the thing to show.
 */
export const describeDragFailure = (raw: unknown): string => {
  const PUT_BACK = "The dates were put back as they were.";
  if (isApiFailure(raw)) {
    if (raw.offline) return `${OFFLINE_MESSAGE} ${PUT_BACK}`;
    const said = sentenceIn(raw);
    if (said) return `${said} ${PUT_BACK}`;
    if (raw.status === 401 || raw.status === 403) return `That plan is not yours to change. ${PUT_BACK}`;
    return PUT_BACK;
  }
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const said = sentenceIn(body);
  return said ? `${said} ${PUT_BACK}` : PUT_BACK;
};
