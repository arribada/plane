/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// plane imports
import { GROUP_CHOICES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IUserStateDistribution, TStateGroups } from "@plane/types";
import { ContentWrapper } from "@plane/ui";
// components
import { PageHead } from "@/components/core/page-title";
import { ProfileActivity } from "@/components/profile/overview/activity";
import { ProfilePriorityDistribution } from "@/components/profile/overview/priority-distribution";
import { ProfileStateDistribution } from "@/components/profile/overview/state-distribution";
import { ProfileStats } from "@/components/profile/overview/stats";
// ARRIBADA: "Your work" broken down by project (where you work most) and by discipline.
import { ProfileWorkBreakdown } from "@/components/profile/overview/work-breakdown";
import { ProfileWorkload } from "@/components/profile/overview/workload";
import { capitalizeFirstLetter } from "@plane/utils";
// constants
import { USER_PROFILE_DATA } from "@/constants/fetch-keys";
// services
import { UserService } from "@/services/user.service";
import type { Route } from "./+types/page";
const userService = new UserService();

export default function ProfileOverviewPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, userId } = params;

  const { t } = useTranslation();
  const { data: userProfile } = useSWR(USER_PROFILE_DATA(workspaceSlug, userId), () =>
    userService.getUserProfileData(workspaceSlug, userId)
  );

  const stateDistribution: IUserStateDistribution[] = Object.keys(GROUP_CHOICES).map((key) => {
    const group = userProfile?.state_distribution.find((g) => g.state_group === key);

    if (group) return group;
    else return { state_group: key as TStateGroups, state_count: 0 };
  });

  // ARRIBADA: rank the person's assigned work by project and by discipline for "Your work".
  const projectItems = (userProfile?.project_distribution ?? []).map((p) => ({
    key: p.project_id,
    label: p.project__name || p.project__identifier,
    count: p.count,
  }));
  const disciplineItems = (userProfile?.discipline_distribution ?? []).map((d) => ({
    key: d.role,
    label: capitalizeFirstLetter(d.role),
    count: d.count,
  }));

  return (
    <>
      <PageHead title={t("profile.page_label")} />
      <ContentWrapper className="space-y-7">
        <ProfileStats userProfile={userProfile} />
        <ProfileWorkload stateDistribution={stateDistribution} />
        <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
          <ProfilePriorityDistribution userProfile={userProfile} />
          <ProfileStateDistribution stateDistribution={stateDistribution} userProfile={userProfile} />
        </div>
        {/* ARRIBADA: which projects the person works on most, and which disciplines their work needs. */}
        <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
          <ProfileWorkBreakdown
            title="Work by project"
            items={projectItems}
            emptyText="No assigned work items yet."
          />
          <ProfileWorkBreakdown
            title="Work by discipline"
            items={disciplineItems}
            emptyText="No disciplines set on the assigned work items yet."
          />
        </div>
        <ProfileActivity />
      </ContentWrapper>
    </>
  );
}
