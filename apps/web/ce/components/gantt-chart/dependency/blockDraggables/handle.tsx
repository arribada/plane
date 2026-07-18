/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Click-to-link dependency handle. Drag-to-create needs live mouse tracking that
 * can't be verified through a build→deploy loop; a two-click gesture (click a
 * source handle, then a target handle) creates the same dependency far more
 * robustly and stays entirely inside these additive handles — the existing bar
 * resize/move handlers are untouched.
 */
import { observer } from "mobx-react";
import { cn } from "@plane/utils";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

type Props = {
  blockId: string;
  side: "left" | "right";
};

export const DependencyHandle = observer(function DependencyHandle({ blockId, side }: Props) {
  const store = useTimeLineChartStore();
  const {
    relation: { createCurrentRelation },
  } = useIssueDetail();

  const source = store.linkingSourceId;
  const isSource = source === blockId;
  const isCandidate = !!source && source !== blockId;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!source) {
      store.setLinkingSource(blockId);
      return;
    }
    if (source === blockId) {
      store.setLinkingSource(null); // clicking the source again cancels
      return;
    }
    // clicked block is the successor: it is blocked_by the source (source runs first)
    createCurrentRelation(blockId, "blocked_by", source).catch(() => {});
    store.setLinkingSource(null);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        !source
          ? "Start a dependency from here"
          : isSource
            ? "Click to cancel"
            : "Link: this item depends on the selected one"
      }
      className={cn(
        "absolute top-1/2 z-20 size-3 -translate-y-1/2 rounded-full border-2 border-white shadow transition-opacity hover:opacity-100",
        side === "right" ? "-right-1.5" : "-left-1.5",
        {
          "bg-blue-500 opacity-100 ring-2 ring-blue-300": isSource,
          "bg-emerald-500 opacity-100": isCandidate,
          "bg-neutral-400 opacity-50": !source,
        }
      )}
    />
  );
});
