/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a project manager actually asks of a budget: will this hold?
 *
 * A total and a percentage cannot answer it. "60% spent" is healthy at month
 * eight of twelve and a crisis at month three, and every figure above renders
 * those identically. Two readings do answer it — the rate, and what the money
 * went on — so they sit together here rather than being two more accordions.
 *
 * Monthly bars against the rate that would still fit, because a bar above the
 * line is legible at a glance and a number is not. Composition as a stacked bar
 * because the question is proportion, not magnitude: nobody reads "components
 * are 43%" off a column chart.
 */
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";

export type TSpendRhythm = {
  months: { month: string; amount: number }[];
  rate: number | null;
  sustainable: number | null;
  months_left: number | null;
  exhausted_on: string | null;
  over_rate: boolean;
};

type TCategory = { category: string; planned: number; actual: number; currency: string };

type Props = {
  rhythm: TSpendRhythm | null | undefined;
  byCategory: TCategory[];
  money: (value: number, currency: string) => string;
  currency: string;
};

/** One hue per category, assigned in fixed order and never cycled — a filter that
 *  drops a category must not repaint the survivors. */
const FILL = ["#2b6cb0", "#2f855a", "#b7791f", "#805ad5", "#c05621", "#4a5568"];

const LABEL: Record<string, string> = {
  hardware: "Hardware",
  components: "Components",
  services: "Services",
  travel: "Travel",
  shipping: "Shipping",
  other: "Other",
};

const monthLabel = (key: string) => {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short" });
};

export function SpendAnalysis({ rhythm, byCategory, money, currency }: Props) {
  const months = rhythm?.months ?? [];
  const spentByCategory = byCategory.filter((row) => row.actual > 0);
  const total = spentByCategory.reduce((sum, row) => sum + row.actual, 0);

  // Nothing spent yet is not an error and not an empty chart: it is a sentence.
  if (months.length === 0 && total === 0) {
    return (
      <p className="px-3 py-4 text-13 text-tertiary">
        Nothing has been spent yet. The rhythm and the breakdown appear with the first recorded expense — a budget is
        not required for either.
      </p>
    );
  }

  // The tallest bar OR the sustainable line, so the line is never off-chart.
  const ceiling = Math.max(...months.map((m) => m.amount), rhythm?.sustainable ?? 0, 1);

  return (
    <div className="space-y-5 px-3 py-3">
      {months.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-11 font-medium tracking-wide text-tertiary uppercase">Spend per month</h3>
            {rhythm?.sustainable != null && (
              <span className="text-11 text-tertiary">
                {money(rhythm.sustainable, currency)}/month fits the remaining budget
                {rhythm.months_left ? ` (${rhythm.months_left} months left)` : ""}
              </span>
            )}
          </div>

          <div className="relative flex h-28 items-end gap-1">
            {/* The line the bars are read against, behind them. */}
            {rhythm?.sustainable != null && rhythm.sustainable > 0 && (
              <div
                className="border-tertiary/60 pointer-events-none absolute inset-x-0 border-t border-dashed"
                style={{ bottom: `${(rhythm.sustainable / ceiling) * 100}%` }}
                aria-hidden
              />
            )}
            {months.map((row) => {
              const over = rhythm?.sustainable != null && rhythm.sustainable > 0 && row.amount > rhythm.sustainable;
              return (
                <div key={row.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <div
                    className={cn("w-full rounded-t", over ? "bg-warning-primary" : "bg-accent-primary")}
                    style={{ height: `${Math.max((row.amount / ceiling) * 100, row.amount > 0 ? 2 : 0)}%` }}
                    title={`${row.month} · ${money(row.amount, currency)}`}
                  />
                  <span className="truncate text-10 text-tertiary">{monthLabel(row.month)}</span>
                </div>
              );
            })}
          </div>

          {rhythm?.exhausted_on && (
            <p className={cn("mt-2 text-11", rhythm.over_rate ? "text-warning-primary" : "text-tertiary")}>
              At {money(rhythm.rate ?? 0, currency)}/month — the average of the last three months with spend — the
              budget runs out around {renderFormattedDate(rhythm.exhausted_on)}
              {rhythm.over_rate ? ", which is faster than it can afford." : "."}
            </p>
          )}
        </section>
      )}

      {total > 0 && (
        <section>
          <h3 className="mb-2 text-11 font-medium tracking-wide text-tertiary uppercase">What it went on</h3>
          <div className="flex h-3 w-full overflow-hidden rounded">
            {spentByCategory.map((row, index) => (
              <div
                key={row.category}
                // A 2px gap between fills, so two adjacent segments never read as one.
                className="border-layer-1 border-r-2 last:border-r-0"
                style={{ width: `${(row.actual / total) * 100}%`, backgroundColor: FILL[index % FILL.length] }}
                title={`${LABEL[row.category] ?? row.category} · ${money(row.actual, row.currency)}`}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {spentByCategory.map((row, index) => (
              <li key={row.category} className="flex items-center gap-1.5 text-11 text-secondary">
                <span
                  className="size-2.5 flex-shrink-0 rounded-sm"
                  style={{ backgroundColor: FILL[index % FILL.length] }}
                  aria-hidden
                />
                {LABEL[row.category] ?? row.category}
                <span className="text-tertiary tabular-nums">
                  {money(row.actual, row.currency)} · {Math.round((row.actual / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
