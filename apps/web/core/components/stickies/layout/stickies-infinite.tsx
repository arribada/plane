/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { LayoutGrid, Loader2, Move } from "lucide-react";
import { STICKIES_PER_PAGE } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ContentWrapper, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useSticky } from "@/hooks/use-stickies";
import { STICKY_DEFAULT_HEIGHT, STICKY_DEFAULT_WIDTH, clampStickyBox } from "./sticky-free-layout.helpers";
import { StickiesFree } from "./stickies-free";
import { StickiesLayout } from "./stickies-list";

export const StickiesInfinite = observer(function StickiesInfinite() {
  const { workspaceSlug } = useParams();
  // hooks
  const {
    fetchWorkspaceStickies,
    fetchNextWorkspaceStickies,
    getWorkspaceStickyIds,
    loader,
    paginationInfo,
    stickies,
    updateStickyLayout,
    resetStickyLayouts,
  } = useSticky();
  //state
  const [elementRef, setElementRef] = useState<HTMLDivElement | null>(null);
  const [switchingLayout, setSwitchingLayout] = useState(false);

  // ref
  const containerRef = useRef<HTMLDivElement>(null);
  const masonryRef = useRef<HTMLDivElement>(null);

  useSWR(
    workspaceSlug ? `WORKSPACE_STICKIES_${workspaceSlug}` : null,
    workspaceSlug ? () => fetchWorkspaceStickies(workspaceSlug.toString()) : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const handleLoadMore = () => {
    if (loader === "pagination") return;
    fetchNextWorkspaceStickies(workspaceSlug?.toString());
  };

  const hasNextPage = paginationInfo?.next_page_results && paginationInfo?.next_cursor !== undefined;
  const shouldObserve = hasNextPage && loader !== "pagination";
  const workspaceStickies = getWorkspaceStickyIds(workspaceSlug?.toString());
  useIntersectionObserver(containerRef, shouldObserve ? elementRef : null, handleLoadMore);

  // The board is free when at least one note carries stored coordinates. There
  // is deliberately no separate mode flag: one source of truth means the two
  // cannot disagree, and it is what makes "tidy up" a write of nulls rather
  // than a flag flip that leaves stale coordinates behind to surprise someone.
  const isFreeLayout = workspaceStickies.some((id) => stickies[id]?.position_x != null);

  /**
   * Seeds every loaded note with the position the masonry had already given it,
   * measured from the DOM. Computing it instead would mean reimplementing the
   * masonry's packing, and getting it slightly wrong would greet the user with
   * a reshuffle at the exact moment they asked for control.
   */
  const handleArrangeFreely = useCallback(async () => {
    const container = masonryRef.current;
    const slug = workspaceSlug?.toString();
    if (!container || !slug || switchingLayout) return;
    const base = container.getBoundingClientRect();
    const seeds = workspaceStickies
      .map((stickyId) => {
        const element = container.querySelector(`[data-sticky-id="${stickyId}"]`);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          stickyId,
          box: clampStickyBox({
            x: rect.left - base.left,
            y: rect.top - base.top,
            width: rect.width || STICKY_DEFAULT_WIDTH,
            height: rect.height || STICKY_DEFAULT_HEIGHT,
          }),
        };
      })
      .filter((seed) => !!seed);
    if (seeds.length === 0) return;

    setSwitchingLayout(true);
    try {
      // One PATCH per note, once, on an explicit click. There is no bulk
      // endpoint, and inventing one to save a single interaction's worth of
      // requests would have meant a second way to write a sticky.
      await Promise.all(
        seeds.map((seed) =>
          updateStickyLayout(slug, seed.stickyId, {
            position_x: seed.box.x,
            position_y: seed.box.y,
            width: seed.box.width,
            height: seed.box.height,
          })
        )
      );
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not switch layout",
        message: "Your stickies are unchanged. Please try again.",
      });
    } finally {
      setSwitchingLayout(false);
    }
  }, [workspaceSlug, workspaceStickies, updateStickyLayout, switchingLayout]);

  const handleTidyUp = useCallback(async () => {
    const slug = workspaceSlug?.toString();
    if (!slug || switchingLayout) return;
    setSwitchingLayout(true);
    try {
      // Every sticky, including the pages this board has not scrolled to yet —
      // it pages to the end itself, so this can take a moment on a big board.
      await resetStickyLayouts(slug);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not tidy up",
        message: "Anything that had already moved was put back. Please try again.",
      });
    } finally {
      setSwitchingLayout(false);
    }
  }, [workspaceSlug, resetStickyLayouts, switchingLayout]);

  const intersectionElement = hasNextPage && workspaceStickies?.length >= STICKIES_PER_PAGE && (
    <div className={cn("box-border flex min-h-[300px] w-full p-2")} ref={setElementRef} id="intersection-element">
      <div className="flex min-h-[300px] w-full rounded-sm">
        <Loader className="h-full w-full">
          <Loader.Item height="100%" width="100%" />
        </Loader>
      </div>
    </div>
  );

  return (
    <ContentWrapper ref={containerRef} className="space-y-4">
      {loader !== "init-loader" && workspaceStickies.length > 0 && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={isFreeLayout ? handleTidyUp : handleArrangeFreely}
            disabled={switchingLayout}
            className={cn(
              "flex items-center gap-1.5 rounded border border-subtle px-2 py-1 text-12 text-secondary",
              switchingLayout ? "opacity-50" : "hover:bg-layer-transparent-hover hover:text-primary"
            )}
            // Named, not iconic: tidying up discards placements somebody made by
            // hand, and a bare icon is not enough warning for that.
            title={
              isFreeLayout
                ? "Put every sticky back into the automatic layout"
                : "Place stickies yourself — drag and resize them freely"
            }
          >
            {switchingLayout ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isFreeLayout ? (
              <LayoutGrid className="size-3.5" />
            ) : (
              <Move className="size-3.5" />
            )}
            {isFreeLayout ? "Tidy up" : "Arrange freely"}
          </button>
        </div>
      )}

      {isFreeLayout ? (
        <>
          <StickiesFree workspaceSlug={workspaceSlug.toString()} stickyIds={workspaceStickies} />
          {intersectionElement}
        </>
      ) : (
        // The ref is on a wrapper rather than inside StickiesLayout because the
        // masonry is also used by the home widget, which must keep its packed
        // layout and has no business knowing about this board.
        <div ref={masonryRef}>
          <StickiesLayout workspaceSlug={workspaceSlug.toString()} intersectionElement={intersectionElement} />
        </div>
      )}
    </ContentWrapper>
  );
});
