/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Money against time.
 *
 * The budget block could say 60% spent and nothing else. That number is healthy
 * at month 8 of 12 and a crisis at month 3, and the block rendered both
 * identically — its only graphical element was a progress bar whose width is
 * capped at 100, so an overrun could not even escape it.
 *
 * THE SERIES IS COMPUTED ON THE SERVER (`_spend_curve`), and this file only draws
 * it. It used to be built here from the raw expense list, and all three things
 * that were wrong with it needed something this component cannot have:
 *
 * - it summed `expense.total` across currencies, while the ceiling it was drawn
 *   against and the label under it were in the allocation's. €5,000 beside £3,000
 *   became "8000". Converting needs the workspace's recorded EUR/GBP rate.
 * - it OMITTED LABOUR while calling its own series "Committed" and drawing it
 *   against the full allocation. Most projects here are almost entirely people:
 *   £750,000 of work and £15,000 of parts drew a line at about 2% of a full
 *   ceiling. The client has no labour figures at all — they are derived from
 *   effort, discipline and a rate card a guest may not even read.
 * - it clipped the axis to the project's span but not the buckets behind it, so a
 *   receipt dated outside that window contributed to no point and left the chart
 *   without being counted anywhere.
 */
import { useMemo } from "react";
import { useTheme } from "next-themes";
import { AreaChart } from "@plane/propel/charts/area-chart";
import type { TSpendCurve } from "@/plane-web/types/arribada";

type Props = {
  curve: TSpendCurve | undefined;
  money: (amount: number, currency: string) => string;
};

/**
 * Categorical slots 1 and 2, stepped per theme, validated together against both
 * surfaces (CVD ΔE 24.7 protan light / 26.8 dark, normal-vision 33.6 / 31.8,
 * both ≥3:1 on their surface). Blue is the commitment, orange the money actually
 * gone — orange because that is the line a reader is watching.
 *
 * The ceiling is deliberately NOT a third categorical hue: it is a boundary, not
 * an entity, so it takes a neutral and a dash.
 */
const SERIES = {
  light: { planned: "#2a78d6", actual: "#eb6834", ceiling: "#8b8b85" },
  dark: { planned: "#3987e5", actual: "#d95926", ceiling: "#7a7a74" },
};

export function SpendCurve({ curve, money }: Props) {
  const { resolvedTheme } = useTheme();
  const colors = resolvedTheme === "dark" ? SERIES.dark : SERIES.light;

  const allocation = curve?.allocation ?? null;
  const data = useMemo(
    () =>
      (curve?.points ?? []).map((point) => {
        // Built rather than spread: the ceiling is a boundary drawn across the
        // chart, and an allocation the server withheld must leave the key ABSENT
        // rather than present-and-null, which the chart would plot as zero.
        const row: { name: string; committed: number; spent: number; ceiling?: number } = {
          name: point.date,
          committed: point.committed,
          spent: point.spent,
        };
        if (allocation != null) row.ceiling = allocation;
        return row;
      }),
    [curve?.points, allocation]
  );

  // Two points is the minimum that can describe a direction. One draws a dot the
  // eye reads as a flat line.
  if (data.length < 2)
    return (
      <p className="py-6 text-center text-11 text-tertiary">
        {data.length === 0
          ? "Nothing dated yet — a spend curve needs dates to place money on."
          : "Not enough dated figures yet to draw a curve."}
      </p>
    );

  const currency = curve?.currency ?? "EUR";
  const areas = [
    {
      key: "committed",
      label: "Committed",
      strokeColor: colors.planned,
      fill: colors.planned,
      fillOpacity: 0.12,
      strokeOpacity: 1,
      showDot: false,
      // linear, never monotone: money lands on a day. A smoothed curve would draw
      // spending on days nothing was spent, and bulge past the real maximum
      // between two points.
      smoothCurves: false,
      stackId: "committed",
    },
    {
      key: "spent",
      label: "Spent",
      strokeColor: colors.actual,
      fill: colors.actual,
      fillOpacity: 0.16,
      strokeOpacity: 1,
      showDot: false,
      smoothCurves: false,
      stackId: "spent",
    },
    ...(allocation != null
      ? [
          {
            key: "ceiling",
            label: "Budget",
            strokeColor: colors.ceiling,
            fill: colors.ceiling,
            fillOpacity: 0,
            strokeOpacity: 1,
            showDot: false,
            smoothCurves: false,
            stackId: "ceiling",
            style: { strokeDasharray: "4 4" },
          },
        ]
      : []),
  ];

  const undated = curve?.undated_expenses ?? 0;
  const outside = curve?.outside_span ?? 0;
  const unconvertible = curve?.unconvertible ?? [];

  return (
    <div>
      <AreaChart
        className="h-44 w-full"
        data={data}
        areas={areas}
        xAxis={{ key: "name", label: "" }}
        yAxis={{ key: "committed", label: "", offset: -30, dx: -16 }}
        legend={{ align: "left", verticalAlign: "bottom", layout: "horizontal" }}
        showTooltip
      />
      <p className="mt-1 text-10 text-tertiary">
        Cumulative {curve?.converted ? "≈ " : ""}
        {currency}: committed is human time plus every expense line; spent is the lines marked paid.
        {allocation != null && ` Budget ${money(allocation, currency)}.`}
        {/* Every omission is named. A curve that quietly leaves a third of the
            spend off the chart is worse than one that says which third. */}
        {undated > 0 &&
          ` ${undated} ${undated === 1 ? "expense has" : "expenses have"} no date and cannot be placed here.`}
        {outside > 0 &&
          ` ${outside} ${outside === 1 ? "day falls" : "days fall"} outside the project's own window, so the axis runs wider than the plan.`}
        {unconvertible.length > 0 && ` Amounts in ${unconvertible.join(", ")} are left out — they cannot be converted.`}
      </p>
    </div>
  );
}
