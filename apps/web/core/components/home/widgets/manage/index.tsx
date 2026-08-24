/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { FolderPlus, X } from "lucide-react";
// plane types
// plane ui
import { useTranslation } from "@plane/i18n";
import { EModalWidth, ModalCore } from "@plane/ui";
// ARRIBADA: project widgets are added and removed here, in Manage widgets — each is an
// instance pinned to one project, configured (project + Tasks/Budget/Spend) on its own card.
import { projectWidgets } from "@/plane-web/components/home/project-widgets";
import { WidgetList } from "./widget-list";

export type TProps = {
  workspaceSlug: string;
  isModalOpen: boolean;
  handleOnClose?: () => void;
};

export const ManageWidgetsModal = observer(function ManageWidgetsModal(props: TProps) {
  // props
  const { workspaceSlug, isModalOpen, handleOnClose } = props;
  const { t } = useTranslation();

  return (
    <ModalCore isOpen={isModalOpen} handleClose={handleOnClose} width={EModalWidth.MD}>
      <div className="p-4">
        <div className="text-18 font-medium"> {t("home.manage_widgets")}</div>
        <WidgetList workspaceSlug={workspaceSlug} />

        {/* ARRIBADA: project widgets — add as many as you like, each pinned to its own project. */}
        <div className="mt-2 border-t border-subtle pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-13 font-medium text-secondary">Project widgets</span>
            <button
              type="button"
              onClick={() => projectWidgets.add()}
              className="flex items-center gap-1 rounded px-2 py-1 text-12 font-medium text-accent-primary hover:bg-layer-2"
            >
              <FolderPlus className="size-3.5" />
              Add project widget
            </button>
          </div>
          {projectWidgets.ids.length === 0 ? (
            <p className="text-11 text-tertiary">
              A widget pinned to one project — its tasks, budget or spend. Add one and pick its project on the card.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {projectWidgets.ids.map((id, index) => (
                <div
                  key={id}
                  className="flex items-center justify-between rounded-sm px-2 py-1.5 text-13 hover:bg-layer-1"
                >
                  <span className="text-secondary">Project widget {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => projectWidgets.remove(id)}
                    title="Remove this project widget"
                    aria-label="Remove this project widget"
                    className="rounded p-1 text-tertiary hover:bg-danger-primary/10 hover:text-danger-primary"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalCore>
  );
});
