/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Month calendar for the Home "My tasks" widget: the user's assigned work items
 * placed on their due date. Read-to-act — click a task to open it. Undated items
 * are surfaced as a footer count so nothing is silently hidden.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@plane/utils";
import type { TMyWorkItem } from "@/plane-web/types/arribada";

const PRIORITY_DOT: Record<TMyWorkItem["priority"], string> = {
  urgent: "bg-danger-primary",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
  none: "bg-neutral-300",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const localISO = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

type Props = {
  items: TMyWorkItem[];
  onOpenItem: (item: TMyWorkItem) => void;
  onSetDue: (item: TMyWorkItem, value: string | null) => void;
};

export const MyTasksCalendar = ({ items, onOpenItem }: Props) => {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const byDate = useMemo(() => {
    const map = new Map<string, TMyWorkItem[]>();
    for (const it of items) {
      if (!it.target_date) continue;
      const key = it.target_date.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return map;
  }, [items]);

  const undatedCount = items.filter((i) => !i.target_date).length;
  const todayISO = localISO(new Date());

  // Build a 6-week grid starting on the Monday on/before the 1st.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday = 0
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const shift = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-13 font-semibold text-primary">
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="hover:bg-neutral-500/10 rounded p-1 text-secondary"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            className="hover:bg-neutral-500/10 rounded px-1.5 py-0.5 text-11 text-secondary"
          >
            Today
          </button>
          <button type="button" onClick={() => shift(1)} className="hover:bg-neutral-500/10 rounded p-1 text-secondary">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-subtle bg-layer-2">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="bg-layer-1 px-1 py-1 text-center text-[10px] font-medium tracking-wide text-secondary/70 uppercase"
          >
            {w}
          </div>
        ))}
        {cells.map((d) => {
          const iso = localISO(d);
          const inMonth = d.getMonth() === month.getMonth();
          const dayItems = byDate.get(iso) ?? [];
          const isToday = iso === todayISO;
          return (
            <div key={iso} className={cn("min-h-[64px] bg-layer-1 p-1", !inMonth && "opacity-40")}>
              <div
                className={cn(
                  "mb-0.5 text-right text-[11px]",
                  isToday ? "font-semibold text-accent-primary" : "text-secondary/70"
                )}
              >
                {isToday ? (
                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-accent-primary text-white">
                    {d.getDate()}
                  </span>
                ) : (
                  d.getDate()
                )}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onOpenItem(it)}
                    title={`${it.name} · ${it.project_identifier}-${it.sequence_id}`}
                    className="bg-neutral-500/5 hover:bg-neutral-500/15 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[it.priority])} />
                    <span className="truncate text-[10px] text-primary">{it.name}</span>
                  </button>
                ))}
                {dayItems.length > 3 && (
                  <div className="px-1 text-[10px] text-secondary/70">+{dayItems.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {undatedCount > 0 && (
        <p className="mt-2 px-1 text-[11px] text-secondary/70">
          {undatedCount} task{undatedCount > 1 ? "s" : ""} with no due date (set one in list view)
        </p>
      )}
    </div>
  );
};
