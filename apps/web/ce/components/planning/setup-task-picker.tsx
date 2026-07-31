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
};

const numberInput =
  "w-14 rounded border border-subtle bg-layer-1 px-1.5 py-0.5 text-12 text-primary outline-none focus:border-accent-strong";

function TrackSection({
  track,
  selected,
  onToggle,
  onToggleTrack,
  durations,
  onDuration,
  unstaffed,
}: Props & { track: TBlueprintTrack }) {
  const [open, setOpen] = useState(true);
  const chosen = track.tasks.filter((t) => selected.has(t.key));
  const allOn = chosen.length === track.tasks.length && track.tasks.length > 0;

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
              <p className="mb-1.5 text-11 font-medium tracking-wide text-tertiary uppercase">{phase.label}</p>
              <ul className="flex flex-col gap-1">
                {phase.tasks.map((task) => {
                  const on = selected.has(task.key);
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
                      <span
                        className={cn(
                          "flex-shrink-0 rounded px-1.5 py-0.5 text-11",
                          unstaffed.has(task.role.toLowerCase())
                            ? "bg-amber-500/10 text-amber-600"
                            : "bg-layer-2 text-secondary"
                        )}
                        title={
                          unstaffed.has(task.role.toLowerCase())
                            ? "Nobody on the roster holds this discipline yet"
                            : undefined
                        }
                      >
                        {task.role}
                      </span>
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
