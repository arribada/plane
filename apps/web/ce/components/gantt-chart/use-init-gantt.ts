/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Reset a timeline store BEFORE the chart inside the page builds itself.
 *
 * Every page that owns a gantt called `initGantt()` from a mount `useEffect`. React
 * runs a child's passive effects before its parent's, so when the chart mounts in
 * the same commit as its page — the Portfolio always, any page whose data is
 * already cached — the order was: `ChartViewRoot` generates the weeks around
 * today and records their start date, `GanttChartRoot` hands the store its block
 * ids, and only then the page's `initGantt()` puts the view template back and
 * clears the block ids. The weeks stayed on screen; the store now believed the
 * chart began today (the template's module-load `new Date()`), not four months
 * earlier. The first scroll to the left then generated "four months before today"
 * and prepended it ahead of the real start: the header read Sept, Oct, w43, and
 * then Jun 2026 w25. Every bar and the today line were placed from that wrong
 * start too.
 *
 * Layout effects all run before any passive effect of the same commit, so doing
 * the reset here puts it ahead of the chart's own mount effects.
 */
import { useLayoutEffect } from "react";

export const useInitGanttBeforeChart = (initGantt: () => void) => {
  useLayoutEffect(() => {
    initGantt();
    // Once per mount, by design: a reset on every render would wipe the chart.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
