/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane web components
import { observer } from "mobx-react";
import { ANALYTICS_DURATION_FILTER_OPTIONS } from "@plane/constants";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
import { useProject } from "@/hooks/store/use-project";
// components
import { ProjectSelect } from "./select/project";

/**
 * The period control was commented out here, and with it the `date_filter` line
 * in all five analytics fetches — so every figure on the page was an all-time
 * total with nothing on screen saying so. Anyone quoting one in a grant report
 * was quoting the wrong number confidently.
 *
 * It is restored against ANALYTICS_DURATION_FILTER_OPTIONS rather than against
 * the DurationDropdown that used to sit here. That component is the dashboard's,
 * and it speaks a different vocabulary: due-date buckets (`this_week`,
 * `this_year`) where the analytics backend understands elapsed periods
 * (`last_7_days`, `last_3_months`). Wiring it back up would have produced a
 * control that looks like it filters and silently does not, because every one of
 * its values falls through the backend's branches — worse than no control, since
 * a visible filter is believed.
 */
const AnalyticsFilterActions = observer(function AnalyticsFilterActions() {
  const { selectedProjects, updateSelectedProjects, selectedDuration, updateSelectedDuration } = useAnalytics();
  const { joinedProjectIds } = useProject();
  return (
    <div className="flex items-center justify-end gap-2">
      <ProjectSelect
        value={selectedProjects}
        onChange={(val) => {
          updateSelectedProjects(val ?? []);
        }}
        projectIds={joinedProjectIds}
      />
      <select
        aria-label="Reporting period"
        value={selectedDuration}
        onChange={(event) => updateSelectedDuration(event.target.value as typeof selectedDuration)}
        className="h-8 rounded border border-strong bg-surface-1 px-2 text-13 text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
      >
        {ANALYTICS_DURATION_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
});

export default AnalyticsFilterActions;
