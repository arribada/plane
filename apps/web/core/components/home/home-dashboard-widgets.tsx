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
// ARRIBADA: the customisable two-column layout + the configurable per-project widget.
import { HomeWidgetsLayout, type THomeWidgetItem } from "@/plane-web/components/home/home-widgets-layout";
import { ProjectSpotlightWidget } from "@/plane-web/components/home/project-spotlight-widget";
// ARRIBADA: the roster of independent per-project widgets a person has added.
import { projectWidgets } from "@/plane-web/components/home/project-widgets";
// local imports
import { StickiesWidget } from "../stickies/widget";
import { HomeLoader, NoProjectsEmptyState, RecentActivityWidget } from "./widgets";
import { DashboardQuickLinks } from "./widgets/links";
import { ManageWidgetsModal } from "./widgets/manage";

// ARRIBADA: the registry entry is the single, always-there Project widget — it takes no
// instance, so the workspaceSlug the registry hands every widget is simply ignored here. Added
// instances (with their own project + remove button) are wired separately, in layoutItems below.
const ProjectSpotlightRegistryWidget: React.FC<THomeWidgetProps> = () => <ProjectSpotlightWidget />;

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
  // ARRIBADA: the configurable per-project widget now flows through the registry like the
  // rest, so it shows up in Manage widgets with its own toggle and can be reordered. Its
  // preference row is seeded server-side (WorkspaceHomePreference.HomeWidgetKeys).
  arribada_project_spotlight: {
    component: ProjectSpotlightRegistryWidget,
    fullWidth: false,
    title: "Project spotlight",
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

  // ARRIBADA: my-tasks + every enabled widget, as draggable items for the two-column layout.
  // my-tasks leads because it is the one thing everybody wants first; it is now part of the
  // arrangement rather than pinned above it.
  const layoutItems: THomeWidgetItem[] = [
    { key: "my_tasks", node: <MyTasksWidget /> },
    ...orderedWidgets
      .filter((key) => HOME_WIDGETS_LIST[key]?.component && widgetsMap[key]?.is_enabled)
      .map((key) => {
        const WidgetComponent = HOME_WIDGETS_LIST[key].component!;
        return { key, node: <WidgetComponent workspaceSlug={workspaceSlug.toString()} /> };
      }),
    // ARRIBADA: each independent project widget the person added, pinned to its own project and
    // removable on the spot. They live only here (not in Manage) because they are instances, not
    // a fixed registry entry — add as many as you like from the dashboard header.
    ...projectWidgets.ids.map((id) => ({
      key: `arribada_project_widget:${id}`,
      node: <ProjectSpotlightWidget instanceId={id} onRemove={() => projectWidgets.remove(id)} />,
    })),
  ];

  return (
    <div className="relative flex h-full w-full flex-col gap-7">
      <HomePageHeader />
      <ManageWidgetsModal
        workspaceSlug={workspaceSlug.toString()}
        isModalOpen={showWidgetSettings}
        handleOnClose={() => toggleWidgetSettings(false)}
      />
      {!isWikiApp && <NoProjectsEmptyState />}

      <HomeWidgetsLayout items={layoutItems} />

      {!isAnyWidgetEnabled && (
        <div className="grid w-full place-items-center">
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
