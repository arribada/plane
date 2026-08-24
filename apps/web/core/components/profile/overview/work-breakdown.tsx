/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A simple ranked-bar breakdown of a person's assigned work — by project (where they work most)
 * or by discipline (firmware / hardware / ...). Deliberately not a pie: these have no fixed set
 * or colour, and "which is biggest" reads faster off aligned bars than off wedges.
 */
import { Card } from "@plane/ui";

export type TWorkBreakdownItem = { key: string; label: string; count: number };

type Props = {
  title: string;
  items: TWorkBreakdownItem[];
  emptyText: string;
};

export function ProfileWorkBreakdown({ title, items, emptyText }: Props) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="flex flex-col space-y-2">
      <h3 className="text-16 font-medium">{title}</h3>
      <Card className="h-full">
        {items.length > 0 ? (
          <div className="max-h-[300px] space-y-3 overflow-y-auto py-1">
            {items.map((item) => (
              <div key={item.key}>
                <div className="mb-1 flex items-center justify-between gap-2 text-12">
                  <span className="truncate text-secondary">{item.label}</span>
                  <span className="shrink-0 text-tertiary tabular-nums">
                    {item.count}
                    {total > 0 ? ` · ${Math.round((item.count / total) * 100)}%` : ""}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-layer-2">
                  <div
                    className="h-full rounded-full bg-accent-primary"
                    style={{ width: `${(item.count / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid h-[240px] place-items-center text-center text-13 text-tertiary">{emptyText}</div>
        )}
      </Card>
    </div>
  );
}
