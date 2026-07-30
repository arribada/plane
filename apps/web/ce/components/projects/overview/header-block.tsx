/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Who we are and when we said we'd be done. The two date inputs are the plan
 * (what a human committed to); the line underneath is what the work items
 * actually say — kept side by side so nobody mistakes one for the other.
 */
import { observer } from "mobx-react";
import { CalendarRange, Loader2, Users } from "lucide-react";
import { cn } from "@plane/utils";
import { STATUS_META } from "@/plane-web/components/portfolio/project-status-modal";
import type { TProjectOverview } from "@/plane-web/types/arribada";
import { formatRange } from "./helpers";

type Props = {
  overview: TProjectOverview;
  saving: boolean;
  onScheduleChange: (patch: { start_date?: string | null; target_date?: string | null }) => void;
};

const DATE_INPUT =
  "rounded border border-subtle bg-layer-1 px-2 py-1 text-13 text-primary outline-none focus:border-accent-strong";

export const OverviewHeaderBlock = observer(function OverviewHeaderBlock(props: Props) {
  const { overview, saving, onScheduleChange } = props;
  const { project, schedule, derived, status, member_count } = overview;

  const derivedRange = formatRange(derived.start_date, derived.target_date);

  return (
    <div className="rounded-lg border border-subtle bg-layer-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-grow">
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
          {project.description && <p className="mt-1.5 max-w-2xl text-13 text-secondary">{project.description}</p>}
          <div className="mt-2 flex items-center gap-1.5 text-12 text-tertiary">
            <Users className="size-3.5" />
            {member_count} {member_count === 1 ? "member" : "members"}
          </div>
        </div>

        <div className="flex-shrink-0 rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-11 font-medium tracking-wide text-secondary uppercase">
            <CalendarRange className="size-3.5" />
            Project window
            {saving && <Loader2 className="size-3 animate-spin" />}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Planned start date"
              value={schedule.start_date ?? ""}
              onChange={(e) => onScheduleChange({ start_date: e.target.value || null })}
              className={cn(DATE_INPUT, "w-36")}
            />
            <span className="text-tertiary">→</span>
            <input
              type="date"
              aria-label="Planned target date"
              value={schedule.target_date ?? ""}
              onChange={(e) => onScheduleChange({ target_date: e.target.value || null })}
              className={cn(DATE_INPUT, "w-36")}
            />
          </div>
          <p className="mt-1.5 text-11 text-tertiary">
            <span className="font-medium">Derived from work items</span> (read-only):{" "}
            {derivedRange || "no dated work items yet"}
          </p>
        </div>
      </div>
    </div>
  );
});
