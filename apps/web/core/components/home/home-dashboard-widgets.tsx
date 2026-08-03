/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams, usePathname } from "next/navigation";
import { useTheme } from "next-themes";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { THomeWidgetKeys, THomeWidgetProps } from "@plane/types";
// assets
import darkWidgetsAsset from "@/app/assets/empty-state/dashboard/widgets-dark.webp?url";
import lightWidgetsAsset from "@/app/assets/empty-state/dashboard/widgets-light.webp?url";
// components
import { SimpleEmptyState } from "@/components/empty-state/simple-empty-state-root";
// hooks
import { useHome } from "@/hooks/store/use-home";
import { useProject } from "@/hooks/store/use-project";
// plane web components
import { HomePageHeader } from "@/plane-web/components/home/header";
import { MyTasksWidget } from "@/plane-web/components/home/my-tasks-widget";
import {
  ConflictsWidget,
  DeliverablesWidget,
  GithubInboxWidget,
  DriftWidget,
  MyApprovalsWidget,
} from "@/plane-web/components/home/arribada-widgets";
// local imports
import { StickiesWidget } from "../stickies/widget";
import { HomeLoader, NoProjectsEmptyState, RecentActivityWidget } from "./widgets";
import { DashboardQuickLinks } from "./widgets/links";
import { ManageWidgetsModal } from "./widgets/manage";

export const HOME_WIDGETS_LIST: {
  [key in THomeWidgetKeys]: {
    component: React.FC<THomeWidgetProps> | null;
    fullWidth: boolean;
    title: string;
  };
} = {
  quick_links: {
    component: DashboardQuickLinks,
    fullWidth: false,
    title: "home.quick_links.title_plural",
  },
  recents: {
    component: RecentActivityWidget,
    fullWidth: false,
    title: "home.recents.title",
  },
  my_stickies: {
    component: StickiesWidget,
    fullWidth: false,
    title: "stickies.title",
  },
  new_at_plane: {
    component: null,
    fullWidth: false,
    title: "home.new_at_plane.title",
  },
  quick_tutorial: {
    component: null,
    fullWidth: false,
    title: "home.quick_tutorial.title",
  },
  // Arribada's own. Each shows something the product already computes and shows
  // nowhere anybody walks past, and each is off until somebody switches it on.
  arribada_deliverables: {
    component: DeliverablesWidget,
    fullWidth: false,
    title: "Upcoming deliverables",
  },
  arribada_github_inbox: {
    component: GithubInboxWidget,
    fullWidth: false,
    title: "GitHub inbox",
  },
  arribada_conflicts: {
    component: ConflictsWidget,
    fullWidth: false,
    title: "Double-booked",
  },
  arribada_approvals: {
    component: MyApprovalsWidget,
    fullWidth: false,
    title: "Waiting on you",
  },
  arribada_drift: {
    component: DriftWidget,
    fullWidth: false,
    title: "Drifting past the plan",
  },
};

export const DashboardWidgets = observer(function DashboardWidgets() {
  // router
  const { workspaceSlug } = useParams();
  // navigation
  const pathname = usePathname();
  // theme hook
  const { resolvedTheme } = useTheme();
  // store hooks
  const { toggleWidgetSettings, widgetsMap, showWidgetSettings, orderedWidgets, isAnyWidgetEnabled, loading } =
    useHome();
  const { loader } = useProject();
  // plane hooks
  const { t } = useTranslation();
  // derived values
  const noWidgetsResolvedPath = resolvedTheme === "light" ? lightWidgetsAsset : darkWidgetsAsset;

  // derived values
  const isWikiApp = pathname.includes(`/${workspaceSlug.toString()}/pages`);
  if (!workspaceSlug) return null;
  if (loading || loader !== "loaded") return <HomeLoader />;

  return (
    <div className="relative flex h-full w-full flex-col gap-7">
      <HomePageHeader />
      <MyTasksWidget />
      <ManageWidgetsModal
        workspaceSlug={workspaceSlug.toString()}
        isModalOpen={showWidgetSettings}
        handleOnClose={() => toggleWidgetSettings(false)}
      />
      {!isWikiApp && <NoProjectsEmptyState />}

      {isAnyWidgetEnabled ? (
        <div className="flex flex-col">
          {orderedWidgets.map((key) => {
            const WidgetComponent = HOME_WIDGETS_LIST[key]?.component;
            const isEnabled = widgetsMap[key]?.is_enabled;
            if (!WidgetComponent || !isEnabled) return null;
            return (
              <div key={key} className="py-4">
                <WidgetComponent workspaceSlug={workspaceSlug.toString()} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid h-full w-full place-items-center">
          <SimpleEmptyState
            title={t("home.empty.widgets.title")}
            description={t("home.empty.widgets.description")}
            assetPath={noWidgetsResolvedPath}
          />
        </div>
      )}
    </div>
  );
});
