/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The rail at the head of a sidebar row when sub-tasks are nested: an indent for
 * the depth, and a chevron on anything that has children.
 *
 * Nothing here changes the row's height. The two panes map over the same id list
 * and every dependency arrow computes its y from a row's index in it, so a taller
 * parent row would slide every arrow below it off its own bar.
 */
import { observer } from "mobx-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@plane/utils";
import { useGanttGroups } from "./group-context";

/** Per level. Capped below, because a five-deep chain would otherwise push the
 *  title out of a sidebar somebody has narrowed. */
const INDENT_PX = 14;
const MAX_INDENT_LEVELS = 4;

export const SubtaskToggle = observer(function SubtaskToggle({ blockId }: { blockId: string }) {
  const { subtasks } = useGanttGroups();
  if (!subtasks.enabled) return null;

  const depth = subtasks.depthOf(blockId);
  const children = subtasks.childCountOf(blockId);
  // A top-level row with no sub-tasks is every row on a plan that has none. It
  // gets nothing at all, so switching nesting on costs an unnested chart no
  // horizontal space.
  if (depth === 0 && children === 0) return null;

  const collapsed = subtasks.isCollapsed(blockId);
  const rollup = collapsed ? subtasks.rollupOf(blockId) : null;

  return (
    <span className="flex flex-shrink-0 items-center" aria-hidden={children === 0}>
      <span style={{ width: `${Math.min(depth, MAX_INDENT_LEVELS) * INDENT_PX}px` }} />
      {children > 0 ? (
        <button
          type="button"
          onClick={(event) => {
            // The row behind this opens the work item. Folding is not opening.
            event.stopPropagation();
            event.preventDefault();
            subtasks.toggle(blockId);
          }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${children} sub-tasks` : `Hide ${children} sub-tasks`}
          title={
            rollup
              ? `${children} sub-task${children > 1 ? "s" : ""} folded away — they run outside this item's own dates`
              : `${children} sub-task${children > 1 ? "s" : ""}`
          }
          className={cn(
            "relative flex size-4 items-center justify-center rounded text-tertiary hover:bg-layer-2 hover:text-secondary",
            // The touch target is bigger than the glyph without taking any
            // layout, the same pattern the toolbar controls use.
            "after:absolute after:-inset-2 after:content-['']"
          )}
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {/* A folded parent whose children reach outside its own bar is the one
              case where folding hides something. Say so on the row, not only on
              the chart, because the sidebar is where somebody decides to open it. */}
          {rollup && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warning-primary" />}
        </button>
      ) : (
        // A leaf still needs the chevron's width, or its title would sit further
        // left than its siblings' and the indent would read as one level out.
        <span className="size-4" />
      )}
    </span>
  );
});
