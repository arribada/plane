/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachInstruction, extractInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { observer } from "mobx-react";
import { useOutsideClickDetector } from "@plane/hooks";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { DropIndicator } from "@plane/ui";
import { HIGHLIGHT_WITH_LINE, highlightIssueOnDrop } from "@/components/issues/issue-layouts/utils";

type Props = {
  id: string;
  isLastChild: boolean;
  isDragEnabled: boolean;
  /** Whether THIS row accepts a drop to reorder. Separate from isDragEnabled
   *  because grouping needs the opposite pair: items must be draggable so they
   *  can be dropped on a band header, while reordering between rows stays off —
   *  a drop between two rows of another group has no meaning. */
  isReorderTarget?: boolean;
  /** ARRIBADA FIX: rows only accept each other when their scopes match. Used by
   *  sub-task nesting, where a row's position is decided among its siblings and
   *  a drop anywhere else would write a sort_order that changes nothing on
   *  screen. `undefined` on either side means "no scope", which is every drag
   *  this component had before and still the default. */
  dragScope?: string;
  children: (isDragging: boolean) => React.ReactNode;
  onDrop: (draggingBlockId: string | undefined, droppedBlockId: string | undefined, dropAtEndOfList: boolean) => void;
  /** ARRIBADA: dropping a work item AT THE CENTRE of another row re-parents it —
   *  the dragged item becomes a sub-task of the row it lands on. Optional and
   *  entirely separate from `onDrop`: a consumer that does not pass it keeps the
   *  pure-reorder behaviour, and make-child is simply never offered. */
  onMakeChild?: (draggingBlockId: string, parentBlockId: string) => void;
};

export const GanttDnDHOC = observer(function GanttDnDHOC(props: Props) {
  const { id, isLastChild, children, onDrop, onMakeChild, isDragEnabled, isReorderTarget = true, dragScope } = props;
  // ARRIBADA: only offer make-child when the consumer wired a handler for it.
  const makeChildEnabled = !!onMakeChild;
  // states
  const [isDragging, setIsDragging] = useState(false);
  // ARRIBADA: added the "DRAG_MAKE_CHILD" case — the whole row lights up as a
  // parent target — alongside the existing reorder line states.
  const [instruction, setInstruction] = useState<"DRAG_OVER" | "DRAG_BELOW" | "DRAG_MAKE_CHILD" | undefined>(undefined);
  // refs
  const blockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = blockRef.current;

    if (!element) return;

    // ARRIBADA: one place that turns the raw tree-item instruction into the
    // visual/behavioural state, so onDrag (highlight) and onDrop (action) can
    // never disagree. Returns undefined when this row should ignore the drop.
    //
    // The scope rule that used to live in canDrop now lives here for the reorder
    // branch: with make-child enabled canDrop accepts cross-scope drops, so a
    // reorder onto a different scope must be refused at THIS step instead — which
    // preserves the original "no silent reorder that changes nothing" guarantee.
    const resolveInstruction = (
      self: { data?: Record<string, unknown> } | undefined,
      source: { data?: Record<string, unknown> } | undefined
    ): "DRAG_OVER" | "DRAG_BELOW" | "DRAG_MAKE_CHILD" | undefined => {
      const extracted = extractInstruction(self?.data ?? {})?.type;
      if (!extracted) return undefined;

      // Centre of the row -> re-parent. Only ever produced when makeChildEnabled
      // (getData passes 0/0 and blocks make-child otherwise), so this branch is
      // dead code on the pure-reorder path.
      if (extracted === "make-child") {
        return makeChildEnabled ? "DRAG_MAKE_CHILD" : undefined;
      }

      // The reorder path. The row must be a reorder target.
      if (!isReorderTarget) return undefined;
      // ARRIBADA: with make-child on, a reorder is ALSO how you move between levels — a
      // sub-task dropped between two top-level rows leaves its parent (un-nest), and the
      // consumer re-parents it to the drop target's level. So cross-scope reorder is allowed
      // here; it is only refused (original behaviour) for the other consumers that never wire
      // make-child, where a cross-scope drop would write a sort_order that changes nothing.
      if (!makeChildEnabled) {
        const sameScope = (source?.data?.dragScope ?? undefined) === dragScope;
        if (!sameScope) return undefined;
      }

      return extracted === "reorder-below" && isLastChild ? "DRAG_BELOW" : "DRAG_OVER";
    };

    return combine(
      draggable({
        element,
        canDrag: () => isDragEnabled,
        getInitialData: () => ({ id, dragInstanceId: "GANTT_REORDER", dragScope }),
        onDragStart: () => {
          setIsDragging(true);
        },
        onDrop: () => {
          setIsDragging(false);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          if (source?.data?.id === id) return false;
          if (source?.data?.dragInstanceId !== "GANTT_REORDER") return false;
          // ARRIBADA: two intents share this drop target now, and they disagree
          // on scope. A REORDER is only meaningful between siblings, so it still
          // needs matching scopes. A MAKE-CHILD is meaningful ACROSS scopes — a
          // top-level row dropped onto another to become its child — so scope
          // must NOT gate it. canDrop cannot see the extracted instruction yet,
          // so the safe resolution is: accept when make-child is possible here,
          // and let onDrag/onDrop enforce the scope rule for the reorder case.
          const sameScope = (source?.data?.dragScope ?? undefined) === dragScope;
          // When make-child is wired, any row is a candidate parent target, so
          // accept the drop and let onDrag/onDrop pick the right intent and
          // apply the scope rule to reorder only.
          if (makeChildEnabled) return true;
          // Original behaviour, unchanged, when make-child is not wired.
          return isReorderTarget && sameScope;
        },
        getData: ({ input, element: target }) => {
          const data = { id };

          // ARRIBADA: a non-zero currentLevel/indentPerLevel is what makes the
          // tree-item hitbox able to emit a "make-child" instruction for the
          // centre band of the row (with 0/0, as before, only reorder-above /
          // reorder-below are ever produced — the pure-reorder behaviour). When
          // no make-child handler is wired we keep 0/0 so nothing changes.
          return attachInstruction(data, {
            input,
            element: target,
            currentLevel: makeChildEnabled ? 1 : 0,
            indentPerLevel: makeChildEnabled ? 16 : 0,
            mode: isLastChild ? "last-in-group" : "standard",
            // Never re-parent onto a row of a different scope silently: leave
            // make-child available; the scope check for reorder happens below.
            block: makeChildEnabled ? [] : ["make-child"],
          });
        },
        onDrag: ({ self, source }) => {
          setInstruction(resolveInstruction(self, source));
        },
        onDragLeave: () => {
          setInstruction(undefined);
        },
        onDrop: ({ self, source }) => {
          setInstruction(undefined);
          const currentInstruction = resolveInstruction(self, source);
          if (!currentInstruction) return;

          const sourceId = source?.data?.id as string | undefined;
          const destinationId = self?.data?.id as string | undefined;

          // ARRIBADA: a centre drop re-parents instead of reordering. Guard the
          // self-parent case here too (belt and braces — canDrop already refuses
          // source === id), then hand off to the dedicated callback. The reorder
          // path below is reached only for the reorder instructions, exactly as
          // before.
          if (currentInstruction === "DRAG_MAKE_CHILD") {
            if (onMakeChild && sourceId && destinationId && sourceId !== destinationId) {
              onMakeChild(sourceId, destinationId);
              highlightIssueOnDrop(source?.element?.id, false, true);
            }
            return;
          }

          onDrop(sourceId, destinationId, currentInstruction === "DRAG_BELOW");
          highlightIssueOnDrop(source?.element?.id, false, true);
        },
      })
    );
    // isReorderTarget and isDragEnabled belong here: grouping toggles them at
    // runtime, and a target registered under the old value would keep accepting
    // (or refusing) drops until the row happened to remount. blockRef.current is
    // not a dependency React can track — the mount is what schedules this.
    // ARRIBADA: onMakeChild / makeChildEnabled join the list for the same reason
    // as the others — the target is re-registered when the handler appears or
    // goes away, so a row never keeps an out-of-date drop behaviour.
  }, [id, isLastChild, onDrop, onMakeChild, makeChildEnabled, isDragEnabled, isReorderTarget, dragScope]);

  useOutsideClickDetector(blockRef, () => blockRef?.current?.classList?.remove(HIGHLIGHT_WITH_LINE));

  return (
    <div
      id={`draggable-${id}`}
      // A shadow and a slight fade, not a scale: a scaled row stops lining up
      // with its own bar in the chart pane.
      data-lifted={isDragging ? "true" : undefined}
      // ARRIBADA: the whole row is the drop zone for re-parenting, so mark the
      // row itself (not a thin line) when a centre drop would make it a parent.
      data-make-child-target={instruction === "DRAG_MAKE_CHILD" ? "true" : undefined}
      className={"relative"}
      ref={blockRef}
      onDragStart={() => {
        if (!isDragEnabled) {
          // ARRIBADA FIX: this used to say "only enabled when sorted by manual",
          // which stopped being true when the drag itself started switching the
          // view to manual. What is left is the case it never covered: the row
          // cannot be moved by this reader at all.
          setToast({
            title: "Warning!",
            type: TOAST_TYPE.WARNING,
            message: "This row cannot be moved — the plan is locked, or it is not yours to edit",
          });
        }
      }}
    >
      <DropIndicator classNames="absolute top-0" isVisible={instruction === "DRAG_OVER"} />
      {children(isDragging)}
      {isLastChild && <DropIndicator isVisible={instruction === "DRAG_BELOW"} />}
      {/* ARRIBADA: parent-target highlight for make-child. Pointer-events off so
          it never intercepts the drop; a ring inside the row's own bounds. */}
      {instruction === "DRAG_MAKE_CHILD" && (
        <div className="pointer-events-none absolute inset-0 z-[1] rounded-sm ring-2 ring-inset ring-accent-strong bg-accent-primary/10" />
      )}
    </div>
  );
});
