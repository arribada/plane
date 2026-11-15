/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A locked plan whose rows could still be dragged.
 *
 * The sidebar decided "draggable" as `canReorder(id) || !!groups.assign`, and
 * `assign` is set by the GROUPING — group by sprint and every row of a locked
 * plan became draggable; nest sub-tasks and every row became a make-child
 * target, with nothing asking whether this reader may change the plan. The
 * writes those gestures made were not caught either, so the 403 the server
 * answered with was an unhandled rejection: the row snapped back and nothing
 * was said.
 *
 * The drag itself needs a real mouse. What this proves is the wiring the
 * gesture depends on — which rows are handed a draggable and a make-child
 * handler, under the lock and without it — and that a refused re-parent is
 * said out loud. `GanttDnDHOC` is stood in for by a div that exposes the props
 * it was given; everything the sidebar reads from a store is a stub.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { setToast, dndProps } = vi.hoisted(() => ({
  setToast: vi.fn(),
  dndProps: new Map<string, { isDragEnabled: boolean; onMakeChild?: (a: string, b: string) => void }>(),
}));

vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", WARNING: "warning" }, setToast }));

// The row's drag-and-drop wrapper, reduced to a record of what it was told.
vi.mock("@/components/gantt-chart/sidebar/gantt-dnd-HOC", () => ({
  GanttDnDHOC: (props: {
    id: string;
    isDragEnabled: boolean;
    onMakeChild?: (a: string, b: string) => void;
    children: (dragging: boolean) => ReactNode;
  }) => {
    dndProps.set(props.id, { isDragEnabled: props.isDragEnabled, onMakeChild: props.onMakeChild });
    return (
      <div
        data-testid={`row-${props.id}`}
        data-drag-enabled={String(props.isDragEnabled)}
        data-make-child={String(!!props.onMakeChild)}
      >
        {props.children(false)}
      </div>
    );
  },
}));

vi.mock("@/components/gantt-chart/sidebar/issues/block", () => ({
  IssuesSidebarBlock: ({ block }: { block: { id: string } }) => <span>{block.id}</span>,
}));

// Virtualisation needs layout; render the children outright.
vi.mock("@/components/core/render-if-visible-HOC", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/loader/layouts/gantt-layout-loader", () => ({ GanttLayoutListItemLoader: () => null }));
vi.mock("@/hooks/use-intersection-observer", () => ({ useIntersectionObserver: () => undefined }));
vi.mock("@/hooks/use-issue-layout-store", () => ({
  useIssuesStore: () => ({ issues: { getIssueLoader: () => null } }),
}));
vi.mock("@/plane-web/components/gantt-chart/group-row", () => ({ GanttGroupHeader: () => null }));

// Two blocks, both dated, both top-level.
vi.mock("@/hooks/use-timeline-chart", () => ({
  useTimeLineChart: () => ({
    getBlockById: (id: string) => ({
      id,
      start_date: "2026-08-10",
      target_date: "2026-08-12",
      sort_order: id === "a" ? 1000 : 2000,
      data: { id, project_id: "p1" },
    }),
  }),
}));

// The grouping context: grouped by sprint (so `assign` is set) and nested (so
// make-child is offered) — the two switches that used to bypass the lock.
const { groupContext } = vi.hoisted(() => ({
  groupContext: {
    byKey: new Map(),
    isCollapsed: () => false,
    toggle: () => undefined,
    groupBy: "cycle",
    assign: async () => undefined,
    subtasks: {
      enabled: true,
      depthOf: () => 0,
      childCountOf: () => 0,
      parentOf: () => null,
      isCollapsed: () => false,
      toggle: () => undefined,
      parentIds: new Set<string>(),
      rollupOf: () => null,
    },
  },
}));
vi.mock("@/plane-web/components/gantt-chart/group-context", () => ({ useGanttGroups: () => groupContext }));

import { IssueGanttSidebar } from "./sidebar";

const ganttContainerRef = { current: null };

const mount = (enableReorder: boolean, blockUpdateHandler = vi.fn()) => {
  render(
    <IssueGanttSidebar
      blockIds={["a", "b"]}
      blockUpdateHandler={blockUpdateHandler}
      enableReorder={enableReorder}
      enableSelection={false}
      ganttContainerRef={ganttContainerRef}
      showAllBlocks
    />
  );
  return blockUpdateHandler;
};

beforeEach(() => {
  setToast.mockClear();
  dndProps.clear();
});

describe("IssueGanttSidebar under the plan permission", () => {
  it("hands no row a draggable or a make-child target when the plan may not be changed", () => {
    // Grouped by sprint AND nested: the two settings that used to make this true.
    mount(false);
    for (const id of ["a", "b"]) {
      expect(screen.getByTestId(`row-${id}`)).toHaveAttribute("data-drag-enabled", "false");
      expect(screen.getByTestId(`row-${id}`)).toHaveAttribute("data-make-child", "false");
    }
  });

  it("hands every row a draggable and a make-child target when it may", () => {
    mount(true);
    for (const id of ["a", "b"]) {
      expect(screen.getByTestId(`row-${id}`)).toHaveAttribute("data-drag-enabled", "true");
      expect(screen.getByTestId(`row-${id}`)).toHaveAttribute("data-make-child", "true");
    }
  });

  it("writes parent_id through the block handler when a row is dropped on another", async () => {
    const write = mount(
      true,
      vi.fn(async () => undefined)
    );
    await act(async () => dndProps.get("b")?.onMakeChild?.("a", "b"));
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), { parent_id: "b" });
    expect(setToast).not.toHaveBeenCalled();
  });

  it("says the server's own reason when the re-parent is refused, instead of rejecting unhandled", async () => {
    const detail = "This project is set so that only its lead changes the plan.";
    mount(
      true,
      vi.fn(async () => {
        throw { error: "Only the project lead can change the plan.", detail };
      })
    );
    await act(async () => dndProps.get("b")?.onMakeChild?.("a", "b"));
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: detail }));
  });

  it("says what became of the row when the refusal carried no sentence", async () => {
    mount(
      true,
      vi.fn(async () => {
        throw undefined;
      })
    );
    await act(async () => dndProps.get("b")?.onMakeChild?.("a", "b"));
    const message = (setToast.mock.calls.at(-1)?.[0] as { message?: string } | undefined)?.message ?? "";
    expect(message).toMatch(/back where it was/);
  });
});
