/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a project manager actually asks of a budget: will this hold?
 *
 * A total and a percentage cannot answer it. "60% spent" is healthy at month
 * eight of twelve and a crisis at month three, and every figure above renders
 * those identically. Three readings do answer it — what the work costs, the
 * rate, and what the money went on — so they sit together here rather than
 * being three more accordions.
 *
 * Cost by discipline comes FIRST, and it is the section this panel was missing.
 * Nearly every project here costs people and nothing else: no expense rows, no
 * receipts, and a hundred person-days of plan. Both charts below are built from
 * spend over time, so on such a project both were empty and the panel printed
 * "nothing has been spent yet" directly beneath a figure saying otherwise. The
 * days ARE the information, they need no expense to exist, and a discipline
 * with no hourly rate keeps its row rather than vanishing from the estimate.
 *
 * Monthly bars against the rate that would still fit, because a bar above the
 * line is legible at a glance and a number is not. Composition as a stacked bar
 * because the question is proportion, not magnitude: nobody reads "components
 * are 43%" off a column chart.
 */
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";

export type TSpendRhythm = {
  /** `amount` is labour + expense; the two travel beside it so the chart can
   *  say which is which. Both optional — an older server sends neither. */
  months: { month: string; amount: number; labour?: number; expense?: number }[];
  rate: number | null;
  sustainable: number | null;
  months_left: number | null;
  exhausted_on: string | null;
  over_rate: boolean;
  /** The currency the figures above are in. Absent on an older server. */
  currency?: string;
  /** Rates this reading could not convert; their days are still below. */
  unconvertible?: string[];
};

type TCategory = { category: string; planned: number; actual: number; currency: string };

type TRole = {
  role: string;
  days: number;
  hours: number;
  cost: number;
  currency: string | null;
  rated: boolean;
};

type Props = {
  rhythm: TSpendRhythm | null | undefined;
  byCategory: TCategory[];
  byRole: TRole[];
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

/** Days as somebody would say them: 7, not 7.00, but 7.5 stays 7.5. */
const dayCount = (days: number) => `${Number(days.toFixed(2))} d`;

export function SpendAnalysis({ rhythm, byCategory, byRole, money, currency }: Props) {
  const months = rhythm?.months ?? [];
  const spentByCategory = byCategory.filter((row) => row.actual > 0);
  const total = spentByCategory.reduce((sum, row) => sum + row.actual, 0);
  // A discipline with no days at all is nothing to draw; one with days and no
  // rate is the whole point of the section and stays.
  const roles = byRole.filter((row) => row.days > 0);
  // The rhythm is computed in the allocation's currency; older servers did not
  // say so, and this component was assuming it and happening to be right.
  const rhythmCcy = rhythm?.currency ?? currency;

  // Genuinely nothing to say: no plan, no receipts. Not an error and not an
  // empty chart — a sentence.
  if (months.length === 0 && total === 0 && roles.length === 0) {
    return (
      <p className="px-3 py-4 text-13 text-tertiary">
        Nothing recorded yet. The charts appear as soon as the work items carry dates and a discipline, or the first
        expense is entered — a budget is not required for either.
      </p>
    );
  }

  // The tallest bar OR the sustainable line, so the line is never off-chart.
  const ceiling = Math.max(...months.map((m) => m.amount), rhythm?.sustainable ?? 0, 1);
  // Bars are read against each other, so the scale is the biggest costed row.
  const costCeiling = Math.max(...roles.map((r) => r.cost), 1);
  const ratedDays = roles.filter((r) => r.rated).reduce((sum, r) => sum + r.days, 0);
  const unratedDays = roles.filter((r) => !r.rated).reduce((sum, r) => sum + r.days, 0);
  // Two rates in different currencies make two bar lengths incomparable. Rare,
  // and cheaper to say than to pretend.
  const roleCurrencies = [...new Set(roles.filter((r) => r.rated && r.currency).map((r) => r.currency))];

  // Whether each half of a month is present anywhere in the chart. With only one
  // of them there is one series, which needs no legend and no washed-out fill.
  const hasLabour = months.some((m) => (m.labour ?? 0) > 0);
  const hasExpense = months.some((m) => (m.expense ?? 0) > 0 || (m.labour == null && m.amount > 0));
  const bothKinds = hasLabour && hasExpense;

  return (
    <div className="space-y-5 px-3 py-3">
      {roles.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-11 font-medium tracking-wide text-tertiary uppercase">Cost by discipline</h3>
            <span className="text-11 text-tertiary">
              {dayCount(ratedDays + unratedDays)} of planned work
              {unratedDays > 0 ? `, ${dayCount(unratedDays)} of it with no rate` : ""}
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {roles.map((row) => (
              <li key={row.role}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-12 text-secondary capitalize">{row.role}</span>
                  <span className="flex-shrink-0 text-11 text-tertiary tabular-nums">
                    {dayCount(row.days)}
                    {row.rated && row.currency ? (
                      <span className="ml-2 text-primary">{money(row.cost, row.currency)}</span>
                    ) : (
                      // Named, not blank. "No cost shown" and "costs nothing" are
                      // the same picture and opposite facts.
                      <span className="ml-2 text-warning-primary">no hourly rate</span>
                    )}
                  </span>
                </div>
                {row.rated ? (
                  <div className="mt-1 h-1.5 w-full rounded-sm bg-layer-1">
                    <div
                      className="h-full rounded-r-[4px] bg-accent-primary"
                      style={{ width: `${Math.max((row.cost / costCeiling) * 100, 1)}%` }}
                      title={`${row.role} · ${dayCount(row.days)} · ${Math.round(row.hours)} h · ${money(row.cost, row.currency ?? currency)}`}
                    />
                  </div>
                ) : (
                  // An empty dashed track: the days exist, their cost does not.
                  // A filled bar would have to claim a length, and any length
                  // here would be a number nobody entered.
                  <div
                    className="mt-1 h-1.5 w-full rounded-sm border border-dashed border-warning-strong/50"
                    title={`${row.role} · ${dayCount(row.days)} · no hourly rate recorded, so these days are not costed`}
                  />
                )}
              </li>
            ))}
          </ul>

          {roleCurrencies.length > 1 && (
            <p className="mt-2 text-11 text-tertiary">
              Rates are recorded in {roleCurrencies.join(" and ")}, so the bar lengths above are not comparable to each
              other. The figures beside them are.
            </p>
          )}
        </section>
      )}

      {months.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-11 font-medium tracking-wide text-tertiary uppercase">Cost per month</h3>
            {rhythm?.sustainable != null && (
              <span className="text-11 text-tertiary">
                {money(rhythm.sustainable, rhythmCcy)}/month fits the remaining budget
                {rhythm.months_left ? ` (${rhythm.months_left} months left)` : ""}
              </span>
            )}
          </div>

          {/* Two series need a legend; one names itself in the line below. */}
          {bothKinds ? (
            <ul className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1">
              <li className="flex items-center gap-1.5 text-11 text-secondary">
                <span className="size-2.5 flex-shrink-0 rounded-sm bg-accent-primary" aria-hidden />
                Expenses — recorded
              </li>
              <li className="flex items-center gap-1.5 text-11 text-secondary">
                <span className="size-2.5 flex-shrink-0 rounded-sm bg-accent-primary/45" aria-hidden />
                Labour — estimated from the plan
              </li>
            </ul>
          ) : (
            <p className="mb-1.5 text-11 text-tertiary">
              {hasLabour
                ? "Labour, estimated from the plan and placed in the month each task ends."
                : "Expenses, in the month each was incurred."}
            </p>
          )}

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
              // An older server sends neither half; then the whole bar is the
              // one thing it always was.
              const expense = row.expense ?? (row.labour == null ? row.amount : 0);
              const labour = row.labour ?? 0;
              const pct = (value: number) => (value > 0 ? Math.max((value / ceiling) * 100, 2) : 0);
              return (
                <div key={row.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <div
                    // gap-[2px] rather than a border on the segment: a border is
                    // inside the box, and the shortest legible segment here is
                    // ~2px tall, so a 2px border would consume it entirely.
                    className="flex w-full flex-col justify-end gap-[2px]"
                    style={{ height: `${pct(expense) + pct(labour)}%` }}
                    title={
                      bothKinds
                        ? `${row.month} · ${money(labour, rhythmCcy)} labour + ${money(expense, rhythmCcy)} expenses`
                        : `${row.month} · ${money(row.amount, rhythmCcy)}`
                    }
                  >
                    {/* Estimate above the record, and the record on the baseline:
                        the firmer number is the one the bar stands on. Separated
                        by a 2px gap in the surface colour rather than a stroke. */}
                    {labour > 0 && (
                      <div
                        className={cn(
                          "w-full rounded-t",
                          over ? "bg-warning-primary/45" : "bg-accent-primary/45",
                          // A lighter fill only reads as "the other one" when
                          // there is another one.
                          !bothKinds && (over ? "bg-warning-primary" : "bg-accent-primary")
                        )}
                        style={{ height: `${(pct(labour) / (pct(expense) + pct(labour))) * 100}%` }}
                      />
                    )}
                    {expense > 0 && (
                      <div
                        className={cn(
                          "w-full",
                          labour > 0 ? "" : "rounded-t",
                          over ? "bg-warning-primary" : "bg-accent-primary"
                        )}
                        style={{ height: `${(pct(expense) / (pct(expense) + pct(labour))) * 100}%` }}
                      />
                    )}
                  </div>
                  <span className="truncate text-10 text-tertiary">{monthLabel(row.month)}</span>
                </div>
              );
            })}
          </div>

          {rhythm?.exhausted_on && (
            <p className={cn("mt-2 text-11", rhythm.over_rate ? "text-warning-primary" : "text-tertiary")}>
              At {money(rhythm.rate ?? 0, rhythmCcy)}/month — the average of the last three months with cost — the
              budget runs out around {renderFormattedDate(rhythm.exhausted_on)}
              {rhythm.over_rate ? ", which is faster than it can afford." : "."}
            </p>
          )}

          {rhythm?.unconvertible && rhythm.unconvertible.length > 0 && (
            <p className="mt-2 text-11 text-tertiary">
              Rates held in {rhythm.unconvertible.join(", ")} are not on this chart — only euros and sterling convert,
              and a third currency would need a rate nobody here chose. Their days are in the breakdown above.
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
