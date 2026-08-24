/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Eye, EyeOff, Move } from "lucide-react";
import { useParams } from "next/navigation";

// plane imports
import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";
// hooks
import { useSticky } from "@/hooks/use-stickies";
// ARRIBADA: the "float over the whole page" + "hide all" toggles for the Home stickies.
import { stickiesFloating, stickiesHidden } from "@/plane-web/components/home/stickies-floating";
// local imports
import { StickiesTruncated } from "./layout/stickies-truncated";
import { StickySearch } from "./modal/search";
import { useStickyOperations } from "./sticky/use-operations";

export const StickiesWidget = observer(function StickiesWidget() {
  // params
  const { workspaceSlug } = useParams();
  // store hooks
  const { creatingSticky, toggleShowNewSticky } = useSticky();
  const { t } = useTranslation();
  // sticky operations
  const { stickyOperations } = useStickyOperations({
    workspaceSlug: workspaceSlug?.toString() ?? "",
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-14 font-semibold text-tertiary">{t("stickies.title")}</div>
        {/* actions */}
        <div className="flex items-center gap-2">
          {/* ARRIBADA: hide/show every sticky (the preview here AND the floating overlay). */}
          <button
            type="button"
            onClick={() => stickiesHidden.toggle()}
            title={stickiesHidden.on ? "Show all stickies" : "Hide all stickies"}
            aria-label="Toggle all stickies"
            aria-pressed={stickiesHidden.on}
            className="my-auto rounded p-1 text-tertiary hover:text-primary"
          >
            {stickiesHidden.on ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
          {/* ARRIBADA: toggle the floating-over-the-page layer. Icon-only; highlighted when on. */}
          <button
            type="button"
            onClick={() => stickiesFloating.toggle()}
            title={stickiesFloating.on ? "Stop floating stickies over the page" : "Float stickies over the page"}
            aria-label="Toggle floating stickies"
            aria-pressed={stickiesFloating.on}
            className={cn(
              "my-auto rounded p-1",
              stickiesFloating.on ? "bg-accent-primary/10 text-accent-primary" : "text-tertiary hover:text-primary"
            )}
          >
            <Move className="size-4" />
          </button>
          <StickySearch />
          <button
            onClick={() => {
              toggleShowNewSticky(true);
              stickyOperations.create();
            }}
            className="my-auto flex gap-1 text-13 font-medium text-accent-primary"
            disabled={creatingSticky}
          >
            <PlusIcon className="my-auto size-4" />
            <span>{t("stickies.add")}</span>
            {creatingSticky && (
              <div
                className="size-4 animate-spin rounded-full border-2 border-accent-strong border-t-transparent"
                role="status"
                aria-label="loading"
              />
            )}
          </button>
        </div>
      </div>
      {/* ARRIBADA: hide the preview when hidden, and also when floating — the notes are then
          on the page overlay and showing them here too just duplicates them. */}
      {!stickiesHidden.on && !stickiesFloating.on && (
        <div className="-mx-2">
          <StickiesTruncated />
        </div>
      )}
      {stickiesFloating.on && !stickiesHidden.on && (
        <p className="px-1 py-2 text-11 text-tertiary">Notes are floating on the page. Toggle off to dock them here.</p>
      )}
    </div>
  );
});
