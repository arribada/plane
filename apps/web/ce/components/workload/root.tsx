/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Per-person workload, in two views. The list answers "how much is on each person";
 * the timeline answers "when", which is the only one that shows somebody committed
 * to two projects in the same fortnight.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { CalendarRange, List } from "lucide-react";
import { cn } from "@plane/utils";
import { WorkloadList } from "./list";
import { WorkloadTimeline } from "./timeline";

type TView = "list" | "timeline";

const VIEWS: { key: TView; label: string; hint: string; Icon: typeof List }[] = [
  { key: "list", label: "List", hint: "Active work per person", Icon: List },
  { key: "timeline", label: "Timeline", hint: "Who is booked when, across every project", Icon: CalendarRange },
];

export const WorkloadRoot = observer(function WorkloadRoot() {
  const [view, setView] = useState<TView>("list");
  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  return (
    // The page wraps this in an overflow-y-auto box that suits a table and not a
    // horizontally scrolled chart, so both views manage their own scrolling and
    // this shell never grows past the viewport.
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-subtle px-4 py-2.5 md:px-6">
        <div className="min-w-0">
          <h2 className="text-18 leading-tight font-semibold text-primary">Workload</h2>
          <p className="truncate text-12 text-secondary">{active.hint}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5 rounded-md border border-subtle p-0.5">
          {VIEWS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-12",
                view === key ? "bg-layer-2 font-medium text-primary" : "text-secondary hover:text-primary"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">{view === "list" ? <WorkloadList /> : <WorkloadTimeline />}</div>
    </div>
  );
});
