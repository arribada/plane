/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactElement } from "react";
import { observer } from "mobx-react";
import { AlignJustify, LayoutGrid, Move, Shapes } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { HomeIcon } from "@plane/propel/icons";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { useHome } from "@/hooks/store/use-home";
// ARRIBADA: the straight ⇄ free dashboard switch, next to Manage widgets.
import { homeLayout } from "@/plane-web/components/home/home-layout";
import type { THomeMode } from "@/plane-web/components/home/home-layout";

// ARRIBADA FIX: the button named the CURRENT mode ("Straight dashboard") and
// pressing it switched to the next one, so it read as a label and acted as a
// toggle. It now names the action, and the title says where you are and what
// the press does.
const NEXT_MODE: Record<THomeMode, THomeMode> = { straight: "semi", semi: "free", free: "straight" };
const SWITCH_LABEL: Record<THomeMode, string> = {
  straight: "Switch to straight layout",
  semi: "Switch to semi-free layout",
  free: "Switch to free layout",
};
const MODE_DESCRIPTION: Record<THomeMode, string> = {
  straight: "a straight column",
  semi: "a semi-free layout (snaps to a grid, never overlaps)",
  free: "a free layout (place anything anywhere)",
};
const MODE_ICON: Record<THomeMode, ReactElement> = {
  straight: <AlignJustify />,
  semi: <LayoutGrid />,
  free: <Move />,
};

export const WorkspaceDashboardHeader = observer(function WorkspaceDashboardHeader() {
  // plane hooks
  const { t } = useTranslation();
  // hooks
  const { toggleWidgetSettings } = useHome();

  return (
    <>
      <Header>
        <Header.LeftItem>
          <div className="flex items-center gap-2">
            <Breadcrumbs>
              <Breadcrumbs.Item
                component={
                  <BreadcrumbLink label={t("home.title")} icon={<HomeIcon className="h-4 w-4 text-tertiary" />} />
                }
              />
            </Breadcrumbs>
          </div>
        </Header.LeftItem>
        <Header.RightItem>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => homeLayout.setMode(NEXT_MODE[homeLayout.mode])}
            className="my-auto mb-0"
            // The icon shows where the press takes you, like the label.
            prependIcon={MODE_ICON[NEXT_MODE[homeLayout.mode]]}
            title={`The dashboard is ${MODE_DESCRIPTION[homeLayout.mode]}. Press to switch to ${MODE_DESCRIPTION[NEXT_MODE[homeLayout.mode]]}. Your placements are kept.`}
            aria-label={SWITCH_LABEL[NEXT_MODE[homeLayout.mode]]}
          >
            <div className="hidden sm:hidden md:block">{SWITCH_LABEL[NEXT_MODE[homeLayout.mode]]}</div>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => toggleWidgetSettings(true)}
            className="my-auto mb-0"
            prependIcon={<Shapes />}
          >
            <div className="hidden sm:hidden md:block">{t("home.manage_widgets")}</div>
          </Button>
        </Header.RightItem>
      </Header>
    </>
  );
});
