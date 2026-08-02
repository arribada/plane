/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
// plane imports
import { AreaChart } from "@plane/propel/charts/area-chart";
import type { TChartData, TModuleCompletionChartDistribution } from "@plane/types";
import { renderFormattedDateWithoutYear } from "@plane/utils";

type Props = {
  distribution: TModuleCompletionChartDistribution;
  totalIssues: number;
  className?: string;
  plotTitle?: string;
};

function ProgressChart({ distribution, totalIssues, className = "", plotTitle = "work items" }: Props) {
  const points = Object.keys(distribution ?? []);
  // The backend writes null for every day after today, on purpose. `?? 0` turned
  // that into a real zero, so on day 3 of a 14-day cycle the remaining-work area
  // dropped to the axis and stayed there — the chart declared the cycle finished
  // for the whole window it exists to report on. null lets the line simply stop.
  //
  // The ideal line is drawn over the elapsed points only, for the same reason,
  // and `index / (points.length - 1)` is division by zero on a one-day cycle.
  const lastPoint = points.length - 1;
  const chartData: TChartData<string, string>[] = points.map((key, index) => ({
    name: renderFormattedDateWithoutYear(key),
    current: distribution[key] ?? null,
    ideal: lastPoint > 0 ? totalIssues * (1 - index / lastPoint) : totalIssues,
  }));

  // Two points is the minimum that can describe a trend. One draws a dot the eye
  // reads as a flat line; zero draws an empty box that looks like a failure.
  if (points.length < 2)
    return (
      <div className={`flex w-full items-center justify-center py-8 ${className}`}>
        <p className="text-13 text-tertiary">Not enough data yet to chart {plotTitle}.</p>
      </div>
    );

  return (
    <div className={`flex w-full items-center justify-center ${className}`}>
      <AreaChart
        data={chartData}
        areas={[
          {
            key: "current",
            label: `Current ${plotTitle}`,
            strokeColor: "#3F76FF",
            fill: "#3F76FF33",
            fillOpacity: 1,
            showDot: true,
            smoothCurves: true,
            strokeOpacity: 1,
            stackId: "bar-one",
          },
          {
            key: "ideal",
            label: `Ideal ${plotTitle}`,
            strokeColor: "#A9BBD0",
            fill: "#A9BBD0",
            fillOpacity: 0,
            showDot: true,
            smoothCurves: true,
            strokeOpacity: 1,
            stackId: "bar-two",
            style: {
              strokeDasharray: "6, 3",
              strokeWidth: 1,
            },
          },
        ]}
        xAxis={{ key: "name", label: "Date" }}
        yAxis={{ key: "current", label: "Completion" }}
        margin={{ bottom: 30 }}
        className="h-[370px] w-full"
        legend={{
          align: "center",
          verticalAlign: "bottom",
          layout: "horizontal",
          wrapperStyles: {
            marginTop: 20,
          },
        }}
      />
    </div>
  );
}

export default ProgressChart;
