/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The proposed plan, read the way a lead reads one: when does it finish, what runs at
 * the same time as what, and who has not been found yet. Grouped by sprint when the
 * project runs in sprints, by component when it runs as a flow.
 */
import { Fragment, useState } from "react";
import { observer } from "mobx-react";
import { AlertTriangle, CircleUser, GitBranch, Pin, Sparkles, Zap } from "lucide-react";
import { cn } from "@plane/utils";
import type { TSetupPlan } from "@/plane-web/types/arribada";

type Props = {
  plan: TSetupPlan;
  trackLabels: Record<string, string>;
  /** Naming an owner, or handing the task back to whoever holds its discipline. */
  onAssign?: (taskKey: string, userId: string | null) => void;
  /** Typing a date. It is then fixed, and the rest of the plan reflows around it. */
  onEditDates?: (taskKey: string, startDate: string, targetDate: string) => void;
  /** Redrawing what a task waits on. Goes back through the scheduler. */
  onEditDeps?: (taskKey: string, dependsOn: string[]) => void;
  busy?: boolean;
};

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const weeks = (from: string, to: string) => {
  const days = (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000 + 1;
  return Math.max(1, Math.round(days / 7));
};

export const SetupPlanTable = observer(function SetupPlanTable({
  plan,
  trackLabels,
  onAssign,
  onEditDates,
  onEditDeps,
  busy,
}: Props) {
  // Which row has its dependency picker open. One at a time: the list is every
  // other task, and two open at once turns the table into a wall.
  const [openDeps, setOpenDeps] = useState<string | null>(null);
  const bySprint = plan.sprints.length > 0;

  // One group per sprint, or one per component — same rendering either way.
  const groups = bySprint
    ? plan.sprints.map((sprint) => ({
        id: `s${sprint.index}`,
        label: sprint.name,
        meta: `${day(sprint.start_date)} → ${day(sprint.end_date)}`,
        tasks: plan.tasks.filter((t) => t.sprint === sprint.index),
      }))
    : Object.entries(
        plan.tasks.reduce<Record<string, TSetupPlan["tasks"]>>((acc, task) => {
          (acc[task.track] ||= []).push(task);
          return acc;
        }, {})
      ).map(([track, tasks]) => ({
        id: track,
        label: trackLabels[track] ?? track,
        meta: `${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
        tasks,
      }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-subtle bg-layer-2 px-3 py-2">
        <span className="text-13 font-semibold text-primary">
          {day(plan.start_date)} → {day(plan.end_date)}
        </span>
        <span className="text-12 text-secondary">
          about {weeks(plan.start_date, plan.end_date)} weeks · {plan.tasks.length} work items
          {bySprint ? ` · ${plan.sprints.length} sprints` : ""}
        </span>
        {typeof plan.critical_count === "number" && plan.critical_count > 0 && (
          <span
            className="flex items-center gap-1 rounded bg-danger-subtle px-2 py-0.5 text-12 text-danger-primary"
            title="These have no slack: lose a day on any of them and the end date moves with it."
          >
            <Zap className="size-3.5" />
            {plan.critical_count} on the critical path
          </span>
        )}
      </div>

      {plan.missing_roles.length > 0 && (
        <p className="flex items-start gap-1.5 rounded bg-warning-subtle px-2.5 py-1.5 text-12 text-warning-primary">
          <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0" />
          <span>
            Nobody on the roster holds {plan.missing_roles.join(", ")}. Those work items are still created and carry the
            discipline they need — they are handed over automatically the day someone picks it up.
          </span>
        </p>
      )}
      {plan.warnings.map((warning) => (
        <p key={warning} className="rounded bg-warning-subtle px-2.5 py-1.5 text-12 text-warning-primary">
          {warning}
        </p>
      ))}
      {plan.notes && (
        <p className="flex items-start gap-1.5 text-12 text-secondary">
          <Sparkles className="mt-0.5 size-3.5 flex-shrink-0 text-accent-primary" />
          <span>{plan.notes}</span>
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-subtle">
        <table className="w-full text-13">
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.id}>
                <tr className="bg-layer-2">
                  <td colSpan={4} className="px-3 py-1.5">
                    <span className="text-12 font-semibold text-primary">{group.label}</span>
                    <span className="ml-2 text-11 text-tertiary">{group.meta}</span>
                  </td>
                </tr>
                {group.tasks.map((task) => (
                  <tr key={task.key} className="border-t border-subtle">
                    <td className="px-3 py-1.5">
                      <span className="text-primary">{task.name}</span>
                      {task.added && (
                        <span
                          className="ml-1.5 rounded bg-accent-primary/10 px-1.5 py-0.5 text-10 text-accent-primary"
                          title="Added by the assistant for this project"
                        >
                          added
                        </span>
                      )}
                      {onEditDeps && (
                        <button
                          type="button"
                          onClick={() => setOpenDeps(openDeps === task.key ? null : task.key)}
                          title="What this waits on"
                          className="ml-2 inline-flex items-center gap-1 rounded px-1 py-0.5 text-11 text-tertiary hover:bg-layer-2 hover:text-primary"
                        >
                          <GitBranch className="size-3" />
                          {task.after.length}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-12 whitespace-nowrap">
                      {onAssign && plan.people.length > 0 ? (
                        <span className="flex items-center gap-1">
                          <CircleUser
                            className={cn(
                              "size-3.5 flex-shrink-0",
                              task.pinned ? "text-accent-primary" : "text-tertiary"
                            )}
                          />
                          <select
                            aria-label={`Who does ${task.name}`}
                            disabled={busy}
                            value={task.pinned && task.assignee_id ? task.assignee_id : ""}
                            onChange={(e) => onAssign(task.key, e.target.value || null)}
                            className="max-w-36 truncate rounded border border-transparent bg-transparent py-0.5 text-12 text-secondary outline-none hover:border-subtle focus:border-accent-strong disabled:opacity-50"
                          >
                            {/* Not "unassigned": leaving it blank means the schedule
                                decides, which is a different thing from nobody. */}
                            <option value="">
                              {task.assignee_name
                                ? `${task.assignee_name} (by discipline)`
                                : task.role || "by discipline"}
                            </option>
                            {plan.people.map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.name}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : task.assignee_name ? (
                        <span className="flex items-center gap-1 text-secondary">
                          <CircleUser className="size-3.5 flex-shrink-0 text-tertiary" />
                          {task.assignee_name}
                        </span>
                      ) : (
                        <span className={cn("text-tertiary", !task.role && "italic")}>
                          {task.role || "no discipline"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-12 md:whitespace-nowrap text-secondary">
                      {onEditDates ? (
                        <span className="flex flex-col items-start justify-start gap-1 md:flex-row md:items-center md:justify-end">
                          {/* A pinned date is a decision the scheduler works around,
                              so it is worth seeing at a glance which ones are yours. */}
                          {task.date_pinned && <Pin className="size-3 flex-shrink-0 text-accent-primary" />}
                          <input
                            type="date"
                            aria-label={`Start of ${task.name}`}
                            disabled={busy}
                            value={task.start_date}
                            onChange={(e) => e.target.value && onEditDates(task.key, e.target.value, task.target_date)}
                            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-12 text-secondary outline-none hover:border-subtle focus:border-accent-strong disabled:opacity-50"
                          />
                          <span className="text-tertiary">→</span>
                          <input
                            type="date"
                            aria-label={`Target of ${task.name}`}
                            disabled={busy}
                            min={task.start_date}
                            value={task.target_date}
                            onChange={(e) => e.target.value && onEditDates(task.key, task.start_date, e.target.value)}
                            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-12 text-secondary outline-none hover:border-subtle focus:border-accent-strong disabled:opacity-50"
                          />
                        </span>
                      ) : (
                        <>
                          {day(task.start_date)} → {day(task.target_date)}
                          <span className="ml-1.5 text-tertiary">{task.days}d</span>
                        </>
                      )}
                    </td>
                    {/* The number that turns a set of dates into a decision: how far
                        this can slip before anything else has to. Zero is the
                        critical path, which is the same statement said twice. */}
                    <td className="hidden md:table-cell px-2 py-1.5 text-right text-12 whitespace-nowrap">
                      {typeof task.total_float === "number" ? (
                        task.critical ? (
                          <span
                            className="rounded bg-danger-subtle px-1.5 py-0.5 text-11 font-medium text-danger-primary"
                            title="No slack — a day lost here is a day lost on the delivery date"
                          >
                            no slack
                          </span>
                        ) : (
                          <span
                            className="text-tertiary tabular-nums"
                            title={
                              task.free_float === task.total_float
                                ? `Can slip ${task.total_float} working day(s) without moving anything else`
                                : `Can slip ${task.free_float} day(s) freely, ${task.total_float} before the end date moves`
                            }
                          >
                            +{task.total_float}d
                          </span>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
                {onEditDeps &&
                  group.tasks
                    .filter((task) => openDeps === task.key)
                    .map((task) => (
                      <tr key={`${task.key}-deps`} className="border-t border-subtle bg-layer-2">
                        <td colSpan={4} className="px-3 py-2">
                          <p className="mb-1.5 text-11 font-medium tracking-wide text-secondary uppercase">
                            {task.name} waits on
                          </p>
                          <div className="grid max-h-40 grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2">
                            {plan.tasks
                              .filter((other) => other.key !== task.key)
                              .map((other) => (
                                <label
                                  key={other.key}
                                  htmlFor={`dep-${task.key}-${other.key}`}
                                  className="flex items-center gap-1.5 text-12 text-secondary"
                                >
                                  <input
                                    id={`dep-${task.key}-${other.key}`}
                                    type="checkbox"
                                    disabled={busy}
                                    checked={task.after.includes(other.key)}
                                    onChange={() =>
                                      onEditDeps(
                                        task.key,
                                        task.after.includes(other.key)
                                          ? task.after.filter((k) => k !== other.key)
                                          : [...task.after, other.key]
                                      )
                                    }
                                    className="size-3 flex-shrink-0 text-accent-primary"
                                  />
                                  <span className="truncate">{other.name}</span>
                                </label>
                              ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                {group.tasks.length === 0 && (
                  <tr className="border-t border-subtle">
                    <td colSpan={4} className="px-3 py-1.5 text-12 text-tertiary">
                      Nothing lands in this sprint.
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
