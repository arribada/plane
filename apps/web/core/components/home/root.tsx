/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { ContentWrapper } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useHome } from "@/hooks/store/use-home";
import { useUserProfile, useUser } from "@/hooks/store/user";
// plane web imports
import { HomePeekOverviewsRoot } from "@/plane-web/components/home";
import { TourRoot } from "@/plane-web/components/onboarding/tour/root";
// local imports
import { homeLayout } from "@/plane-web/components/home/home-layout";
import { HomeStickiesFloatingOverlay } from "@/plane-web/components/home/stickies-floating-overlay";
import { DashboardWidgets } from "./home-dashboard-widgets";
import { UserGreetingsView } from "./user-greetings";

export const WorkspaceHomeView = observer(function WorkspaceHomeView() {
  // store hooks
  const { workspaceSlug } = useParams();
  const { data: currentUser } = useUser();
  const { data: currentUserProfile, updateTourCompleted } = useUserProfile();
  const { fetchWidgets } = useHome();

  useSWR(
    workspaceSlug ? `HOME_DASHBOARD_WIDGETS_${workspaceSlug}` : null,
    workspaceSlug ? () => fetchWidgets(workspaceSlug?.toString()) : null,
    {
      revalidateIfStale: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  const handleTourCompleted = async () => {
    try {
      await updateTourCompleted();
    } catch (error) {
      console.error("Error updating tour completed", error);
    }
  };

  // TODO: refactor loader implementation
  return (
    <>
      {currentUserProfile && !currentUserProfile.is_tour_completed && (
        <div className="fixed top-0 left-0 z-20 grid h-full w-full place-items-center overflow-y-auto bg-backdrop transition-opacity">
          <TourRoot onComplete={handleTourCompleted} />
        </div>
      )}
      <>
        <HomePeekOverviewsRoot />
        <ContentWrapper className="relative mx-auto scrollbar-hide gap-6 bg-surface-1 px-page-x">
          {/* ARRIBADA: the floating stickies layer — absolute inside this scroll container so
              notes scroll with the page; renders only when the user turns floating on. */}
          <HomeStickiesFloatingOverlay />
          {/* ARRIBADA: the straight dashboard stays a centred 800px column; the free canvas drops
              the cap so it can fill the whole width — otherwise x=0 sits inset from the left edge
              (centring margin) and notes/widgets could only ever be pushed rightward, never left. */}
          <div className={cn("w-full", homeLayout.enabled ? "" : "mx-auto max-w-[800px]")}>
            {currentUser && <UserGreetingsView user={currentUser} />}
            <DashboardWidgets />
          </div>
        </ContentWrapper>
      </>
    </>
  );
});
