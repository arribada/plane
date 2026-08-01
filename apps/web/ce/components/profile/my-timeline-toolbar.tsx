/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, FolderKanban, Layers, List, Palette } from "lucide-react";
import { Tooltip } from "@plane/ui";
import { cn } from "@plane/utils";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import type { TPortfolioColorBy } from "@/plane-web/types/arribada";

// How the personal timeline stacks its rows. "project" is the default because the
// first question about a task on somebody's board is which project it belongs to.
export type TTimelineGroupBy = "project" | "folder" | "none";

const GROUP_OPTIONS: { value: TTimelineGroupBy; label: string; icon: typeof List; hint: string }[] = [
  { value: "project", label: "Project", icon: FolderKanban, hint: "Group work items under their project" },
  { value: "folder", label: "Folder", icon: Layers, hint: "Group projects into their portfolio folders" },
  { value: "none", label: "None", icon: List, hint: "One flat list, earliest first" },
];

const COLOR_OPTIONS: { value: TPortfolioColorBy; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "priority", label: "Priority" },
];

const segment = (active: boolean) =>
  cn(
    "flex items-center gap-1 rounded px-2 py-1 text-12",
    active ? "bg-accent-primary/10 font-medium text-accent-primary" : "text-secondary hover:bg-layer-2"
  );

type Props = {
  groupBy: TTimelineGroupBy;
  onGroupByChange: (value: TTimelineGroupBy) => void;
};

export const MyTimelineToolbar = observer(function MyTimelineToolbar({ groupBy, onGroupByChange }: Props) {
  const portfolio = usePortfolio();

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-subtle px-4 py-2 text-13">
      <div className="flex items-center gap-1">
        <span className="mr-1 text-11 font-medium tracking-wide text-secondary uppercase">Group by</span>
        {GROUP_OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <Tooltip key={o.value} tooltipContent={o.hint}>
              <button type="button" onClick={() => onGroupByChange(o.value)} className={segment(groupBy === o.value)}>
                <Icon className="size-3.5" />
                {o.label}
              </button>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        <Palette className="size-3.5 text-secondary" />
        <span className="mr-1 text-11 font-medium tracking-wide text-secondary uppercase">Colour</span>
        {COLOR_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => portfolio.setColorBy(o.value)}
            className={segment(portfolio.colorBy === o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex-grow" />

      {portfolio.isLoading && <span className="text-12 text-secondary">Loading…</span>}

      {/* Undated work is not hidden, it is counted: a timeline has nowhere to put an
          item with neither a start nor a target date, and saying so is the only
          honest way to show a board that is missing part of the work. */}
      {portfolio.userUndatedCount > 0 && (
        <Tooltip
          tooltipContent={`${portfolio.userUndatedCount} of ${portfolio.userTotalCount} assigned work item(s) have no start or target date, so a timeline cannot place them. Give them dates to see them here.`}
        >
          <span className="flex items-center gap-1 rounded bg-warning-subtle px-2 py-1 text-12 text-warning-primary">
            <AlertTriangle className="size-3.5" />
            {portfolio.userUndatedCount} without dates — not shown
          </span>
        </Tooltip>
      )}

      {portfolio.userTruncated && (
        <Tooltip tooltipContent="Only the first 500 dated work items are drawn. Narrow the work down in the Assigned tab.">
          <span className="rounded bg-layer-2 px-2 py-1 text-12 text-secondary">first 500 shown</span>
        </Tooltip>
      )}
    </div>
  );
});
