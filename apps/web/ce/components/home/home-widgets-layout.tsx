/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The Home widgets, laid out.
 *
 * Off by default it is the built-in single column, unchanged. "Customise layout" splits the
 * widgets into two columns you can rearrange by dragging — drop a widget onto another to place
 * it above it, or onto a column to append — and the arrangement is remembered per browser
 * (homeLayout). "Reset layout" returns to the single column. A widget that is enabled but not
 * yet placed (a newly turned-on one) joins the first column, so nothing ever vanishes.
 *
 * Native HTML5 drag-and-drop on purpose: reordering a handful of cards needs no gesture library,
 * and the cards stay ordinary blocks the browser already knows how to move.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { Columns2, GripVertical, RotateCcw } from "lucide-react";
import { cn } from "@plane/utils";
import { homeLayout } from "./home-layout";

export type THomeWidgetItem = { key: string; node: ReactNode };

type Props = { items: THomeWidgetItem[] };

export const HomeWidgetsLayout = observer(function HomeWidgetsLayout({ items }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const columns = homeLayout.columns;
  const byKey = new Map(items.map((i) => [i.key, i.node]));
  const allKeys = items.map((i) => i.key);

  // Default: the single column, exactly as before, plus the entry point to customise.
  if (!columns) {
    return (
      <div className="flex flex-col">
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={() => homeLayout.enable(allKeys)}
            className="flex items-center gap-1 rounded px-2 py-1 text-11 font-medium text-tertiary hover:bg-layer-2 hover:text-primary"
          >
            <Columns2 className="size-3.5" />
            Customise layout
          </button>
        </div>
        {items.map((i) => (
          <div key={i.key} className="py-4">
            {i.node}
          </div>
        ))}
      </div>
    );
  }

  // Custom two-column layout. Keys still enabled but not placed yet fall into the first column.
  const placed = new Set([...columns[0], ...columns[1]]);
  const cols: [string[], string[]] = [
    [...columns[0].filter((k) => byKey.has(k)), ...allKeys.filter((k) => !placed.has(k))],
    columns[1].filter((k) => byKey.has(k)),
  ];

  const dropAt = (toCol: 0 | 1, toIndex: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.dataTransfer.getData("text/plain") || dragging;
    if (key) homeLayout.move(key, toCol, toIndex);
    setDragging(null);
  };

  const renderCard = (key: string, colIdx: 0 | 1, index: number) => (
    <div
      key={key}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", key);
        e.dataTransfer.effectAllowed = "move";
        setDragging(key);
      }}
      onDragEnd={() => setDragging(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={dropAt(colIdx, index)}
      className={cn("group/wcard relative py-2", dragging === key && "opacity-50")}
    >
      {/* A grip that appears on hover; the whole card is draggable, this just says so. */}
      <div className="pointer-events-none absolute top-3 -left-1 opacity-0 transition-opacity group-hover/wcard:opacity-60">
        <GripVertical className="size-4 text-tertiary" />
      </div>
      {byKey.get(key)}
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-3">
        <span className="text-11 text-tertiary">Drag widgets between the columns</span>
        <button
          type="button"
          onClick={() => homeLayout.reset()}
          className="flex items-center gap-1 rounded px-2 py-1 text-11 font-medium text-tertiary hover:bg-layer-2 hover:text-primary"
        >
          <RotateCcw className="size-3.5" />
          Reset layout
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        {([0, 1] as const).map((colIdx) => (
          <div
            key={colIdx}
            onDragOver={(e) => e.preventDefault()}
            onDrop={dropAt(colIdx, cols[colIdx].length)}
            className="flex min-h-[96px] flex-col"
          >
            {cols[colIdx].map((key, i) => renderCard(key, colIdx, i))}
            {cols[colIdx].length === 0 && (
              <div className="my-2 grid flex-1 place-items-center rounded-lg border border-dashed border-subtle p-6 text-11 text-tertiary">
                Drop a widget here
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
