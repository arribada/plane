/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The Home stickies, floating over the whole page.
 *
 * When floating is on this lays the existing free-drag board (StickiesFree, in `overlay` mode)
 * over the Home content: a transparent, click-through layer, so the widgets underneath stay
 * usable and only the notes themselves take pointer events. It is `absolute top-0` inside the
 * Home scroll container, so a note dragged far down extends the scroll and scrolls with the
 * content rather than being pinned to the viewport. The normal stickies widget is untouched —
 * this is an addition, toggled from there.
 */
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { useSticky } from "@/hooks/use-stickies";
import { StickiesFree } from "@/components/stickies/layout/stickies-free";
import { stickiesFloating, stickiesHidden } from "./stickies-floating";

export const HomeStickiesFloatingOverlay = observer(function HomeStickiesFloatingOverlay() {
  const { workspaceSlug } = useParams();
  const { getWorkspaceStickyIds, fetchWorkspaceStickies } = useSticky();
  const slug = workspaceSlug?.toString();

  // The docked preview normally fetches the stickies, but it is hidden while floating — so on a
  // fresh Home load with floating already on, nothing had fetched them and the overlay stayed
  // empty until you toggled it off and on. Fetch them here too, so floating shows on first paint.
  useSWR(
    slug && stickiesFloating.on ? `FLOATING_STICKIES_${slug}` : null,
    slug && stickiesFloating.on ? () => fetchWorkspaceStickies(slug) : null
  );

  const workspaceStickies = slug ? getWorkspaceStickyIds(slug) : [];

  if (!stickiesFloating.on || stickiesHidden.on || !slug || workspaceStickies.length === 0) return null;

  return (
    // Click-through layer: the canvas and every empty part of it let events reach the widgets
    // below; StickiesFree's notes opt back in via `overlay`. z-10 sits above the widgets and
    // below the peek/tour/modals (z-20+), so opening a task never lands behind a note.
    <div className="pointer-events-none absolute top-0 left-0 z-10 w-full px-page-x">
      <StickiesFree overlay workspaceSlug={workspaceSlug.toString()} stickyIds={workspaceStickies} />
    </div>
  );
});
