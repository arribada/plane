/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Maximize2 } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import type { TQuickAddIssueForm } from "../root";

export const GanttQuickAddIssueForm = observer(function GanttQuickAddIssueForm(props: TQuickAddIssueForm) {
  const { ref, projectDetail, hasError, register, onSubmit, isEpic, onOpenFullModal } = props;
  const { t } = useTranslation();
  return (
    <div className={cn("shadow-raised-200", hasError && "border border-danger-strong/20 bg-danger-subtle")}>
      <form
        ref={ref}
        onSubmit={onSubmit}
        className="flex w-full items-center gap-x-3 border-[0.5px] border-subtle bg-surface-1 px-3"
      >
        <div className="flex w-full items-center gap-3">
          <div className="text-11 font-medium text-placeholder">{projectDetail?.identifier ?? "..."}</div>
          <input
            type="text"
            autoComplete="off"
            placeholder={isEpic ? t("epic.title.label") : t("issue.title.label")}
            {...register("name", {
              required: isEpic ? t("epic.title.required") : t("issue.title.required"),
            })}
            className="w-full rounded-md bg-transparent px-2 py-3 text-13 leading-5 font-medium text-secondary outline-none"
          />
        </div>
        {/* ARRIBADA: switch to the full modal, carrying the typed title, to set properties at
            creation. type="button" so it never submits the quick-add form. */}
        {onOpenFullModal && !isEpic && (
          <button
            type="button"
            onClick={onOpenFullModal}
            title="Open the full form — set assignee, state, dates and more at creation"
            aria-label="Open the full create form"
            className="flex-shrink-0 rounded p-1.5 text-tertiary hover:bg-layer-2 hover:text-primary"
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
      </form>
      <div className="bg-surface-1 px-3 py-2 text-11 text-secondary italic">
        {isEpic ? t("epic.add.press_enter") : t("issue.add.press_enter")}
        {onOpenFullModal && !isEpic && (
          <>
            {" · "}
            <button
              type="button"
              onClick={onOpenFullModal}
              className="font-medium text-accent-primary not-italic hover:underline"
            >
              open the full form
            </button>
          </>
        )}
      </div>
    </div>
  );
});
