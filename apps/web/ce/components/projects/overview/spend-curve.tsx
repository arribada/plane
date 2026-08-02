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
 * capped at 100, so an overrun could not even escape it. The data for a curve was
 * already stored: ProjectExpense.incurred_on is a date, `planned` separates
 * committed from spent, and the project has a start and a target.
 */
import { useMemo } from "react";
import { useTheme } from "next-themes";
import { AreaChart } from "@plane/propel/charts/area-chart";
import type { TProjectExpense } from "@/plane-web/types/arribada";

type Props = {
  expenses: TProjectExpense[];
  /** The project's own span. Undated projects fall back to the expense range. */
  startDate: string | null;
  targetDate: string | null;
  /** The allocation, drawn as a ceiling. Null when no budget is recorded. */
  allocation: number | null;
  /** The currency the expenses below are recorded in. */
  currency: string;
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

const day = (value: string) => value.slice(0, 10);

export function SpendCurve({ expenses, startDate, targetDate, allocation, currency, money }: Props) {
  const { resolvedTheme } = useTheme();
  const colors = resolvedTheme === "dark" ? SERIES.dark : SERIES.light;

  const { data, dated, undatedCount } = useMemo(() => {
    // An expense with no date cannot be placed on a time axis. Counted rather
    // than dropped in silence: a curve missing a third of the spend is worse than
    // a curve that says so.
    const withDates = expenses.filter((e) => !!e.incurred_on);
    const skipped = expenses.length - withDates.length;
    if (withDates.length === 0) return { data: [], dated: 0, undatedCount: skipped };

    // toSorted is ES2023 and this workspace targets below it; the array is this
    // map's own output either way, so sorting in place mutates nothing shared.
    // oxlint-disable-next-line unicorn/no-array-sort -- see above
    const days = withDates.map((e) => day(e.incurred_on as string)).sort();
    const first = startDate ? day(startDate) : days[0];
    const last = targetDate ? day(targetDate) : days[days.length - 1];

    // Every date that changes a total, plus the span's ends, so the curve starts
    // at zero on day one and runs to the project's target rather than stopping at
    // the last receipt — the gap between the two IS the reading.
    // oxlint-disable-next-line unicorn/no-array-sort -- freshly spread from a Set
    const points = [...new Set([first, ...days.filter((d) => d >= first && d <= last), last])].sort();

    let planned = 0;
    let actual = 0;
    const byDay = new Map<string, { planned: number; actual: number }>();
    for (const expense of withDates) {
      const key = day(expense.incurred_on as string);
      const bucket = byDay.get(key) ?? { planned: 0, actual: 0 };
      // `planned` rows are committed, not yet paid. Both curves are cumulative
      // spend against the same allocation, so committed money counts toward the
      // planned line and paid money toward the actual one.
      if (expense.planned) bucket.planned += expense.total;
      else bucket.actual += expense.total;
      byDay.set(key, bucket);
    }

    const rows = points.map((date) => {
      const bucket = byDay.get(date);
      planned += bucket?.planned ?? 0;
      actual += bucket?.actual ?? 0;
      const row: { name: string; committed: number; spent: number; ceiling?: number } = {
        name: date,
        // Committed is planned + actual: an amount already paid is also committed,
        // and a planned line that dropped when a line was marked spent would read
        // as the commitment shrinking.
        committed: Number((planned + actual).toFixed(2)),
        spent: Number(actual.toFixed(2)),
      };
      if (allocation != null) row.ceiling = allocation;
      return row;
    });

    return { data: rows, dated: withDates.length, undatedCount: skipped };
  }, [expenses, startDate, targetDate, allocation]);

  // Two points is the minimum that can describe a direction. One draws a dot the
  // eye reads as a flat line.
  if (data.length < 2)
    return (
      <p className="py-6 text-center text-11 text-tertiary">
        {dated === 0
          ? "No dated expenses yet — a spend curve needs dates to place them on."
          : "Not enough dated expenses yet to draw a curve."}
      </p>
    );

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
        Cumulative, in {currency}, from the date each line was incurred.
        {allocation != null && ` Budget ${money(allocation, currency)}.`}
        {undatedCount > 0 &&
          ` ${undatedCount} ${undatedCount === 1 ? "expense has" : "expenses have"} no date and cannot be placed here.`}
      </p>
    </div>
  );
}
