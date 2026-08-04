/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
// plane imports
import type { IWorkspaceSidebarNavigationItem } from "@plane/constants";
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { joinUrlPath } from "@plane/utils";
// components
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useWorkspaceNavigationPreferences } from "@/hooks/use-navigation-preferences";
// plane web imports
import { getSidebarNavigationItemIcon } from "@/plane-web/components/workspace/sidebar/helper";

type Props = {
  item: IWorkspaceSidebarNavigationItem;
  additionalRender?: (itemKey: string, workspaceSlug: string) => ReactNode;
  additionalStaticItems?: string[];
};

export const SidebarItemBase = observer(function SidebarItemBase({
  item,
  additionalRender,
  additionalStaticItems,
}: Props) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { workspaceSlug } = useParams();
  const { allowPermissions } = useUserPermissions();
  const { isWorkspaceItemPinned } = useWorkspaceNavigationPreferences();
  const { data } = useUser();

  const { toggleSidebar, isExtendedSidebarOpened, toggleExtendedSidebar } = useAppTheme();
  const { toggleRequestExpenseModal } = useCommandPalette();

  const handleLinkClick = () => {
    if (window.innerWidth < 768) toggleSidebar();
    if (isExtendedSidebarOpened) toggleExtendedSidebar(false);
  };

  const handleModalItemClick = (key: string) => {
    handleLinkClick();
    if (key === "request_expense") toggleRequestExpenseModal(true);
  };

  const staticItems = [
    "home",
    "pi_chat",
    "projects",
    "portfolio",
    "github_triage",
    "workload",
    "your_work",
    "stickies",
    "drafts",
    "request_expense",
    ...(additionalStaticItems || []),
  ];
  const slug = workspaceSlug?.toString() || "";

  if (!allowPermissions(item.access, EUserPermissionsLevel.WORKSPACE, slug)) return null;

  const isPinned = isWorkspaceItemPinned(item.key);
  if (!isPinned && !staticItems.includes(item.key)) return null;

  const itemHref =
    item.key === "your_work" && data?.id ? joinUrlPath(slug, item.href, data?.id) : joinUrlPath(slug, item.href);
  const icon = getSidebarNavigationItemIcon(item.key);
  const label = t(item.labelTranslationKey);

  // Entries that open a modal get a button, not a link: an <a> that swallows its
  // own navigation still offers a URL to middle-click and to copy, and there is
  // no page at the other end of this one.
  if (item.opensModal) {
    return (
      <button type="button" className="w-full text-left" onClick={() => handleModalItemClick(item.key)}>
        <SidebarNavItem>
          <div className="flex items-center gap-1.5 py-[1px]">
            {icon}
            <p className="text-13 leading-5 font-medium">{label}</p>
          </div>
          {additionalRender?.(item.key, slug)}
        </SidebarNavItem>
      </button>
    );
  }

  return (
    <Link href={itemHref} onClick={handleLinkClick}>
      <SidebarNavItem isActive={item.highlight(pathname, itemHref)}>
        <div className="flex items-center gap-1.5 py-[1px]">
          {icon}
          <p className="text-13 leading-5 font-medium">{label}</p>
        </div>
        {additionalRender?.(item.key, slug)}
      </SidebarNavItem>
    </Link>
  );
});
