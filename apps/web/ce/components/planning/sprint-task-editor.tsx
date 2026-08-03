/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The task list for a single sprint being added to a project that already runs.
 *
 * Three ways in, because a sprint is filled three ways in practice: the
 * ceremonies a team runs every time, whatever this fortnight is actually about
 * (described in a sentence and expanded by the assistant), and the one thing
 * somebody remembers on the way out of the room. None of them is the primary
 * one, so none of them is behind the others.
 *
 * Every row is editable and removable whatever produced it. A model's suggestion
 * that cannot be corrected in place is a suggestion people work around rather
 * than with.
 */
import { useId, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { cn } from "@plane/utils";

export type TSprintTask = {
  /** Stable across edits so React keeps the row under the cursor. */
  id: string;
  name: string;
  role: string;
  days: number;
  /** Where the row came from, shown so nobody has to remember. */
  origin: "default" | "ai" | "manual";
};

type Props = {
  tasks: TSprintTask[];
  onChange: (tasks: TSprintTask[]) => void;
  roleOptions: string[];
  /** Free text describing the sprint; also fed to the assistant. */
  context: string;
  onContext: (value: string) => void;
  onSuggest: () => void | Promise<void>;
  suggesting: boolean;
  aiAvailable: boolean;
  /** Working days the sprint holds, for the over-commitment warning. */
  capacityDays: number;
};

const field =
  "rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong";

const ORIGIN_LABEL: Record<TSprintTask["origin"], string> = {
  default: "ceremony",
  ai: "suggested",
  manual: "added",
};

let seq = 0;
const nextId = () => `st-${(seq += 1)}`;

export function newSprintTask(name: string, role: string, days: number, origin: TSprintTask["origin"]): TSprintTask {
  return { id: nextId(), name, role, days, origin };
}

export function SprintTaskEditor(props: Props) {
  const { tasks, onChange, roleOptions, context, onContext, onSuggest, suggesting, aiAvailable, capacityDays } = props;
  const uid = useId();
  const [draft, setDraft] = useState("");

  const committed = tasks.reduce((sum, task) => sum + (Number.isFinite(task.days) ? task.days : 0), 0);
  // Person-days against the sprint's own length. Over-committing is not an error
  // — teams do it knowingly — but it should not be something you discover after
  // the sprint has been created.
  const over = capacityDays > 0 && committed > capacityDays;

  const patch = (id: string, change: Partial<TSprintTask>) =>
    onChange(tasks.map((task) => (task.id === id ? { ...task, ...change } : task)));

  const addManual = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...tasks, newSprintTask(name, roleOptions[0] ?? "", 3, "manual")]);
    setDraft("");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-subtle p-3">
        <label className="block text-11 font-medium tracking-wide text-tertiary uppercase" htmlFor={`${uid}-ctx`}>
          What is this sprint about?
        </label>
        <textarea
          id={`${uid}-ctx`}
          rows={2}
          value={context}
          onChange={(e) => onContext(e.target.value)}
          placeholder="Bench-test the new enclosure and close the two PCB defects from the last run."
          className={cn(field, "w-full resize-y")}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onSuggest()}
            disabled={suggesting || !aiAvailable || context.trim().length === 0}
            title={
              aiAvailable
                ? "Propose tasks from that description. Nothing is saved until you finish."
                : "No AI provider is configured for this workspace."
            }
            className={cn(
              "flex items-center gap-1.5 rounded border border-subtle px-2.5 py-1.5 text-12 text-secondary",
              suggesting || !aiAvailable || context.trim().length === 0
                ? "opacity-50"
                : "hover:bg-layer-2 hover:text-primary"
            )}
          >
            {suggesting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {suggesting ? "Thinking…" : "Propose tasks"}
          </button>
          <span className="text-11 text-tertiary">
            The ceremonies below are already counted — it adds to them, it does not repeat them.
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        {tasks.length === 0 ? (
          <p className="py-4 text-13 text-tertiary">
            Nothing in this sprint yet. Describe it above, or type a task at the bottom.
          </p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2">
              <input
                aria-label="Task name"
                value={task.name}
                onChange={(e) => patch(task.id, { name: e.target.value })}
                className={cn(field, "min-w-0 flex-1")}
              />
              <select
                aria-label="Discipline"
                value={task.role}
                onChange={(e) => patch(task.id, { role: e.target.value })}
                className={cn(field, "w-40 shrink-0")}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <input
                aria-label="Working days"
                type="number"
                min={1}
                max={60}
                value={task.days}
                onChange={(e) => patch(task.id, { days: Math.max(1, Number(e.target.value) || 1) })}
                className={cn(field, "w-16 shrink-0 tabular-nums")}
              />
              <span className="w-16 shrink-0 text-10 text-tertiary">{ORIGIN_LABEL[task.origin]}</span>
              <button
                type="button"
                onClick={() => onChange(tasks.filter((t) => t.id !== task.id))}
                aria-label={`Remove ${task.name}`}
                className="shrink-0 p-1 text-tertiary hover:text-danger-primary"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2">
        <Plus className="size-3.5 shrink-0 text-tertiary" />
        <input
          aria-label="Add a task"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
          placeholder="Add a task and press Enter"
          className={cn(field, "min-w-0 flex-1")}
        />
        <button
          type="button"
          onClick={addManual}
          disabled={draft.trim().length === 0}
          className={cn(
            "shrink-0 rounded border border-subtle px-2.5 py-1.5 text-12 text-secondary",
            draft.trim().length === 0 ? "opacity-50" : "hover:bg-layer-2 hover:text-primary"
          )}
        >
          Add
        </button>
      </div>

      {tasks.length > 0 && (
        <p className={cn("flex items-center gap-1.5 text-11", over ? "text-warning-primary" : "text-tertiary")}>
          {over && <Wand2 className="size-3" />}
          {committed} person-days committed against {capacityDays} in the sprint
          {over ? " — more than it holds. Shorten something, or let it run over knowingly." : "."}
        </p>
      )}
    </div>
  );
}
