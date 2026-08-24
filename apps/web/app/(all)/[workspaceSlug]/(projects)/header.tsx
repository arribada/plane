/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlignJustify, LayoutGrid, Shapes } from "lucide-react";
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
            onClick={() => homeLayout.setEnabled(!homeLayout.enabled)}
            className="my-auto mb-0"
            prependIcon={homeLayout.enabled ? <AlignJustify /> : <LayoutGrid />}
            title={
              homeLayout.enabled
                ? "Back to the straight single-column dashboard (your placements are kept)"
                : "Arrange the widgets freely — drag and resize each one"
            }
          >
            <div className="hidden sm:hidden md:block">
              {homeLayout.enabled ? "Straight dashboard" : "Free dashboard"}
            </div>
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
