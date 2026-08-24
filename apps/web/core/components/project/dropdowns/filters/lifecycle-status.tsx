/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The projects-view filter by lifecycle status (Active / On hold / Completed / Cancelled).
 * A project's status lives on its schedule and is surfaced read-only on the list; this lets a
 * person narrow the all-projects view to, say, only what is still active.
 */
import React, { useState } from "react";
import { observer } from "mobx-react";
// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
// plane-web
import { PROJECT_LIFECYCLE_STATUSES } from "@/plane-web/types/arribada";

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  searchQuery: string;
};

export const FilterLifecycleStatus = observer(function FilterLifecycleStatus(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery } = props;
  const [previewEnabled, setPreviewEnabled] = useState(true);

  const appliedFiltersCount = appliedFilters?.length ?? 0;
  const filteredOptions = PROJECT_LIFECYCLE_STATUSES.filter((s) =>
    s.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <FilterHeader
        title={`Status${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((status) => (
              <FilterOption
                key={status.key}
                isChecked={appliedFilters?.includes(status.key) ? true : false}
                onClick={() => handleUpdate(status.key)}
                icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: status.color }} />}
                title={status.label}
              />
            ))
          ) : (
            <p className="text-11 text-placeholder italic">No matches found</p>
          )}
        </div>
      )}
    </>
  );
});
