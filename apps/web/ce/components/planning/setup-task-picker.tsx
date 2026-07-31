/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The generic task list, grouped the way the V is walked: requirements down to
 * implementation, then verification back up. Ticking is the point — the catalogue is a
 * starting position, not a prescription, and a lead who drops the environmental testing
 * should be able to see that they have.
 */
import { observer } from "mobx-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@plane/utils";
import type { TBlueprintTrack } from "@/plane-web/types/arribada";

type Props = {
  tracks: TBlueprintTrack[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleTrack: (trackKey: string, on: boolean) => void;
  durations: Record<string, number>;
  onDuration: (key: string, days: number) => void;
  /** Disciplines nobody on the roster holds — flagged inline, where the choice is made. */
  unstaffed: Set<string>;
  /** {task key: discipline the lead moved it to}, replacing the catalogue's. */
  roleOverrides: Record<string, string>;
  onRole: (key: string, role: string) => void;
  /** Every discipline this project can hand a task to, roster first. */
  roleOptions: string[];
};

const numberInput =
  "w-14 rounded border border-subtle bg-layer-1 px-1.5 py-0.5 text-12 text-primary outline-none focus:border-accent-strong";

// Working days of the ticked tasks only — an unticked task is not in the plan, so
// it must not be in the total. Reads the edited duration where the lead set one.
const sumDays = (tasks: TBlueprintTrack["tasks"], selected: Set<string>, durations: Record<string, number>): number =>
  tasks.reduce((total, task) => (selected.has(task.key) ? total + (durations[task.key] ?? task.days) : total), 0);

// Case-insensitive dedupe that keeps the first spelling seen, so "Reviewer" and
// "reviewer" cannot both sit in the list and mean the same discipline.
const dedupeRoles = (roles: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of roles) {
    const trimmed = role.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
};

const roleSelect =
  "max-w-40 flex-shrink-0 cursor-pointer appearance-none truncate rounded px-1.5 py-0.5 text-11 outline-none focus:ring-1 focus:ring-accent-strong disabled:cursor-default";

// Effort, not elapsed time: these tasks run in parallel across whoever holds the
// discipline, so the schedule step turns this into dates. Saying "d total" rather
// than a date keeps the lead from reading it as a delivery window.
const EFFORT_HINT =
  "Total working days of the ticked tasks — effort, not elapsed time. The plan step decides what runs in parallel.";

function TrackSection({
  track,
  selected,
  onToggle,
  onToggleTrack,
  durations,
  onDuration,
  unstaffed,
  roleOverrides,
  onRole,
  roleOptions,
}: Props & { track: TBlueprintTrack }) {
  const [open, setOpen] = useState(true);
  const chosen = track.tasks.filter((t) => selected.has(t.key));
  const allOn = chosen.length === track.tasks.length && track.tasks.length > 0;
  const trackDays = sumDays(track.tasks, selected, durations);

  // Preserve the catalogue's order inside each phase; the phases themselves are
  // already in V order because the tasks are declared that way.
  const phases: { label: string; tasks: TBlueprintTrack["tasks"] }[] = [];
  for (const task of track.tasks) {
    const last = phases[phases.length - 1];
    if (last && last.label === task.phase_label) last.tasks.push(task);
    else phases.push({ label: task.phase_label, tasks: [task] });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-subtle">
      <div className="flex items-center gap-2 bg-layer-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-3.5 flex-shrink-0 text-tertiary" />
          ) : (
            <ChevronRight className="size-3.5 flex-shrink-0 text-tertiary" />
          )}
          <span className="text-13 font-semibold text-primary">{track.label}</span>
          <span className="rounded-full bg-layer-1 px-2 py-0.5 text-11 text-secondary">
            {chosen.length}/{track.tasks.length}
          </span>
          <span className="rounded-full bg-layer-1 px-2 py-0.5 text-11 text-secondary" title={EFFORT_HINT}>
            {trackDays} d
          </span>
        </button>
        <button
          type="button"
          onClick={() => onToggleTrack(track.key, !allOn)}
          className="flex-shrink-0 text-11 text-secondary hover:text-primary"
        >
          {allOn ? "Clear all" : "Select all"}
        </button>
      </div>
      {open && (
        <div className="divide-y divide-subtle">
          {phases.map((phase) => (
            <div key={phase.label} className="px-3 py-2">
              <div className="mb-1.5 flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-11 font-medium tracking-wide text-tertiary uppercase">
                  {phase.label}
                </p>
                {/* Flush right, so its "d" lands in the same column as the "d" on
                    every row below — the total reads as the sum of what it sits over. */}
                <span className="flex-shrink-0 text-11 font-medium text-secondary" title={EFFORT_HINT}>
                  {sumDays(phase.tasks, selected, durations)} d
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {phase.tasks.map((task) => {
                  const on = selected.has(task.key);
                  const role = roleOverrides[task.key] ?? task.role;
                  const orphaned = unstaffed.has(role.toLowerCase());
                  // The catalogue's own discipline always stays offerable, even when
                  // the lead has taken it off the roster — otherwise a select bound
                  // to it would render blank and silently reassign on first touch.
                  const options = dedupeRoles([...roleOptions, task.role, role]);
                  const staffed = options.filter((r) => !unstaffed.has(r.toLowerCase()));
                  const vacant = options.filter((r) => unstaffed.has(r.toLowerCase()));
                  return (
                    <li key={task.key} className="flex items-center gap-2">
                      <input
                        id={`task-${task.key}`}
                        type="checkbox"
                        checked={on}
                        onChange={() => onToggle(task.key)}
                        className="size-3.5 flex-shrink-0 text-accent-primary accent-current"
                      />
                      <label
                        htmlFor={`task-${task.key}`}
                        className={cn("min-w-0 flex-1 truncate text-13", on ? "text-primary" : "text-tertiary")}
                      >
                        {task.name}
                      </label>
                      <select
                        aria-label={`Discipline for ${task.name}`}
                        disabled={!on}
                        value={role}
                        onChange={(e) => onRole(task.key, e.target.value)}
                        title={
                          orphaned
                            ? "Nobody on the roster holds this discipline — pick one that somebody does"
                            : "Which discipline does this task, and therefore who it lands on"
                        }
                        className={cn(
                          roleSelect,
                          orphaned
                            ? "bg-warning-subtle text-warning-primary"
                            : "bg-layer-2 text-secondary hover:text-primary",
                          !on && "opacity-40"
                        )}
                      >
                        {/* Staffed first: the whole point of changing a discipline is
                            usually to move the task onto somebody who exists. */}
                        {staffed.length > 0 && (
                          <optgroup label="On this project">
                            {staffed.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {vacant.length > 0 && (
                          <optgroup label="Nobody holds this yet">
                            {vacant.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        aria-label={`Working days for ${task.name}`}
                        disabled={!on}
                        value={durations[task.key] ?? task.days}
                        onChange={(e) => onDuration(task.key, Number(e.target.value))}
                        className={cn(numberInput, "flex-shrink-0 disabled:opacity-40")}
                      />
                      <span className="flex-shrink-0 text-11 text-tertiary">d</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const SetupTaskPicker = observer(function SetupTaskPicker(props: Props) {
  if (props.tracks.length === 0) {
    return <p className="text-13 text-secondary">Pick at least one component on the previous step.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {props.tracks.map((track) => (
        <TrackSection key={track.key} track={track} {...props} />
      ))}
    </div>
  );
});
