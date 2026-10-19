/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The Portfolio timeline that went Oct 2026 → Jun 2026.
 *
 * Reproduces the mount order of a page that owns a gantt: the page resets the
 * store, `GanttChartRoot` hands it the block ids, `ChartViewRoot` generates the
 * weeks around today. The real store and the real week generator; only the three
 * components are stand-ins, each doing exactly what its mount effect does.
 *
 * The `useEffect` case is the bug as it shipped and is asserted to break, so the
 * fixed case cannot pass merely because the check sees nothing.
 */
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { EStartOfTheWeek } from "@plane/types";
import type { ChartDataType } from "@plane/types";
import { currentViewDataWithView } from "@/components/gantt-chart/data";
import type { IWeekBlock } from "@/components/gantt-chart/views";
import { weekView } from "@/components/gantt-chart/views";
import { BaseTimeLineStore } from "@/plane-web/store/timeline/base-timeline.store";
import type { RootStore } from "@/plane-web/store/root.store";
import { useInitGanttBeforeChart } from "./use-init-gantt";

const DAY = 24 * 60 * 60 * 1000;

const mountPage = (resetWith: "layout" | "passive") => {
  const store = new BaseTimeLineStore({} as RootStore);

  // ChartViewRoot: `useEffect(() => handleToday(), [])`
  const Chart = () => {
    useEffect(() => {
      const base = currentViewDataWithView("week") as ChartDataType;
      const generated = weekView.generateChart(base, null, undefined, EStartOfTheWeek.SUNDAY);
      store.updateCurrentViewData(generated.state);
      store.updateRenderView(generated.payload);
    }, []);
    return null;
  };
  // GanttChartRoot: `useEffect(() => setBlockIds(blockIds), [blockIds])`
  const ChartRoot = () => {
    useEffect(() => store.setBlockIds(["project-a"]), []);
    return <Chart />;
  };
  const PageWithLayoutReset = () => {
    useInitGanttBeforeChart(store.initGantt);
    return <ChartRoot />;
  };
  const PageWithPassiveReset = () => {
    useEffect(() => store.initGantt(), []);
    return <ChartRoot />;
  };

  render(resetWith === "layout" ? <PageWithLayoutReset /> : <PageWithPassiveReset />);
  return store;
};

/** What scrolling to the left edge does: generate "left" from the store, prepend it. */
const scrollToLeftEdge = (store: BaseTimeLineStore): IWeekBlock[] => {
  const left = weekView.generateChart(
    store.currentViewData as ChartDataType,
    "left",
    undefined,
    EStartOfTheWeek.SUNDAY
  );
  return weekView.mergeRenderPayloads(left.payload, store.renderView as IWeekBlock[]);
};

/** Indexes where a week does not start seven days after the one before it. */
const gaps = (weeks: IWeekBlock[]) =>
  weeks
    .map((week, i) => (i === 0 ? 0 : Math.round((week.startDate.getTime() - weeks[i - 1].startDate.getTime()) / DAY)))
    .flatMap((step, i) => (i > 0 && step !== 7 ? [i] : []));

describe("resetting the timeline store on page mount", () => {
  it("keeps the store's start date on the first week the chart drew", () => {
    const store = mountPage("layout");
    const weeks = store.renderView as IWeekBlock[];
    expect(weeks.length).toBeGreaterThan(30);
    expect(store.currentViewData?.data.startDate.getTime()).toBe(weeks[0].startDate.getTime());
  });

  it("extends to the left without a jump in the calendar", () => {
    const store = mountPage("layout");
    const before = (store.renderView as IWeekBlock[]).length;
    const merged = scrollToLeftEdge(store);
    expect(merged.length).toBeGreaterThan(before);
    expect(gaps(merged)).toEqual([]);
  });

  it("leaves the block ids the chart was given", () => {
    expect(mountPage("layout").blockIds).toEqual(["project-a"]);
  });

  it("control: a passive-effect reset produces the Oct → Jun jump", () => {
    const store = mountPage("passive");
    const weeks = store.renderView as IWeekBlock[];
    // The store went back to the template while the drawn weeks stayed.
    expect(store.currentViewData?.data.startDate.getTime()).not.toBe(weeks[0].startDate.getTime());
    expect(store.blockIds).toBeUndefined();
    const merged = scrollToLeftEdge(store);
    const at = gaps(merged);
    expect(at).toHaveLength(1);
    // The prepended block ends AFTER the real start: the calendar runs backwards.
    expect(merged[at[0]].startDate.getTime()).toBeLessThan(merged[at[0] - 1].startDate.getTime());
  });
});
