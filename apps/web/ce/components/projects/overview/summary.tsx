/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The top of the project page: its name, one sentence saying where the project
 * actually is, and the window it is planned inside. Everything else on this page
 * is one fold below — a grid of tiles answered "what are the numbers", which is
 * not the question you have when you open a project.
 */
import { observer } from "mobx-react";
import { CalendarRange, Loader2 } from "lucide-react";
import { cn } from "@plane/utils";
import { STATUS_META } from "@/plane-web/components/portfolio/project-status-modal";
import type { TProjectOverview } from "@/plane-web/types/arribada";
import { formatRange, percent } from "./helpers";

type Props = {
  overview: TProjectOverview;
  saving: boolean;
  onScheduleChange: (patch: { start_date?: string | null; target_date?: string | null }) => void;
};

const DATE_INPUT =
  "rounded border border-subtle bg-layer-1 px-2 py-1 text-13 text-primary outline-none focus:border-accent-strong";

// The sentence a human would say about this project, not a list of counters.
const summarise = (overview: TProjectOverview): string => {
  const { items } = overview;
  if (items.total === 0) return "No work items yet — add some, or run the setup wizard below.";

  const parts = [`${items.completed} of ${items.total} work items done (${percent(items.completed, items.total)}%)`];
  if (items.started) parts.push(`${items.started} in progress`);

  const trouble: string[] = [];
  if (items.overdue) trouble.push(`${items.overdue} overdue`);
  if (items.undated) trouble.push(`${items.undated} without dates`);
  if (items.unassigned) trouble.push(`${items.unassigned} unassigned`);

  const first = `${parts.join(", ")}.`;
  const second = trouble.length ? ` ${trouble.join(", ")} — ` : "";
  const window = formatRange(overview.schedule.start_date, overview.schedule.target_date);
  const third = window ? `planned ${window}.` : "no planned window yet.";
  return trouble.length ? first + second + third : `${first} Planned ${window || "window not set yet"}.`;
};

export const OverviewSummary = observer(function OverviewSummary({ overview, saving, onScheduleChange }: Props) {
  const { project, schedule, derived, status, items } = overview;
  const derivedRange = formatRange(derived.start_date, derived.target_date);

  return (
    <div className="rounded-lg border border-subtle bg-layer-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="truncate text-18 font-semibold text-primary">{project.name}</h1>
        <span className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-11 font-medium tracking-wide text-secondary uppercase">
          {project.identifier}
        </span>
        {status && (
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-11 font-medium text-white"
            style={{ backgroundColor: STATUS_META[status.status]?.color }}
            title={status.message || undefined}
          >
            <span className="size-2 rounded-full bg-white" />
            {STATUS_META[status.status]?.label}
          </span>
        )}
      </div>

      <p className="mt-2 max-w-3xl text-13 text-secondary">{summarise(overview)}</p>

      {items.total > 0 && (
        <div className="mt-3 h-1.5 w-full max-w-3xl overflow-hidden rounded-full bg-layer-2">
          <span
            className="bg-emerald-500 block h-full rounded-full"
            style={{ width: `${percent(items.completed, items.total)}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-12 text-tertiary">
        <CalendarRange className="size-3.5" />
        <span>Plan</span>
        <input
          type="date"
          aria-label="Planned start date"
          value={schedule.start_date ?? ""}
          onChange={(e) => onScheduleChange({ start_date: e.target.value || null })}
          className={cn(DATE_INPUT, "w-36")}
        />
        <span>→</span>
        <input
          type="date"
          aria-label="Planned target date"
          value={schedule.target_date ?? ""}
          onChange={(e) => onScheduleChange({ target_date: e.target.value || null })}
          className={cn(DATE_INPUT, "w-36")}
        />
        {saving && <Loader2 className="size-3 animate-spin" />}
        {derivedRange && <span className="text-tertiary">· work items actually span {derivedRange}</span>}
      </div>
    </div>
  );
});
