/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The seven numbers the team reads first. Overdue and undated are coloured
 * because they are the only two that ask for an action.
 */
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { cn } from "@plane/utils";
import type { TProjectOverview } from "@/plane-web/types/arribada";
import { percent } from "./helpers";

type Props = { items: TProjectOverview["items"] };

type TileProps = {
  label: string;
  value: number;
  tone?: "neutral" | "danger" | "warn";
  className?: string;
  children?: ReactNode;
};

const Tile = ({ label, value, tone = "neutral", className, children }: TileProps) => (
  <div className={cn("rounded-lg border border-subtle bg-layer-1 p-3", className)}>
    <div className="text-11 font-medium tracking-wide text-secondary uppercase">{label}</div>
    <div
      className={cn("mt-1 text-20 font-semibold tabular-nums", {
        "text-primary": tone === "neutral",
        "text-red-600": tone === "danger",
        "text-amber-600": tone === "warn",
      })}
    >
      {value}
    </div>
    {children}
  </div>
);

export const OverviewKpiTiles = observer(function OverviewKpiTiles({ items }: Props) {
  const done = percent(items.completed, items.total);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Work items" value={items.total} />
      <Tile label="Completed" value={items.completed} className="sm:col-span-2">
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-grow overflow-hidden rounded-full bg-layer-2">
            <div className="h-full rounded-full bg-accent-primary" style={{ width: `${done}%` }} />
          </div>
          <span className="flex-shrink-0 text-12 text-secondary tabular-nums">{done}%</span>
        </div>
      </Tile>
      <Tile label="In progress" value={items.started} />
      <Tile label="Overdue" value={items.overdue} tone={items.overdue > 0 ? "danger" : "neutral"} />
      <Tile label="Due this week" value={items.due_week} />
      <Tile label="Without dates" value={items.undated} tone={items.undated > 0 ? "warn" : "neutral"} />
      <Tile label="Unassigned" value={items.unassigned} />
    </div>
  );
});
